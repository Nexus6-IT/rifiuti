/**
 * Dashboard (Task 2b) contro un Postgres reale, collegato COME `wasteflow_app` dentro il
 * `TenantContext`: nome della ditta nei piu' frequenti, stati nel periodo, previsione sui mesi.
 * Il proprietario prepara i dati. Pulizia solo per id esatti (`pulisciTenantDiTest`).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { pulisciTenantDiTest } from '../../test-support/legami-di-test'
import { AnalyticsService } from './analytics.service'
import { LoggerService } from '../../core/logger/logger.service'

describe('Analytics dashboard: Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: AnalyticsService
  const tenantCreati: string[] = []
  let n = 0

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    const logger = {
      setContext: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
    } as unknown as LoggerService
    service = new AnalyticsService(app, logger)
  })

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Dashboard SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const u = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-dash-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `dash-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    return { tenantId: t.id, utenteId: u.id }
  }

  async function fir(
    a: { tenantId: string; utenteId: string },
    o: {
      createdAt: Date
      status?: 'DRAFT' | 'COMPLETED' | 'CANCELLED' | 'AWAITING_PRODUCER'
      producerPartitaIva?: string
      producerName?: string
      carrierPartitaIva?: string
      carrierName?: string
    }
  ) {
    return owner.fIR.create({
      data: {
        tenantId: a.tenantId,
        producerUserId: a.utenteId,
        producerPartitaIva: o.producerPartitaIva ?? partitaIvaUnica(),
        producerName: o.producerName ?? 'Produttore',
        producerAddress: 'Via Prova 1, 20100 Milano MI',
        carrierPartitaIva: o.carrierPartitaIva ?? partitaIvaUnica(),
        carrierName: o.carrierName ?? 'Trasportatore',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: partitaIvaUnica(),
        receiverName: 'Destinatario',
        receiverAddress: 'Via Destinazione 1, 20100 Milano MI',
        cerCode: '20 03 01',
        wasteDescription: 'Rifiuto di prova',
        wasteCategory: 'Non pericoloso',
        quantity: 100,
        unit: 'KG',
        status: o.status ?? 'DRAFT',
        transportDate: new Date(),
        createdAt: o.createdAt,
      },
      select: { id: true },
    })
  }

  it('il nome e quello dello snapshot piu recente; un altro tenant con la stessa P. IVA non si vede', async () => {
    const a = await azienda()
    const b = await azienda()
    const piva = partitaIvaUnica()
    await fir(a, {
      createdAt: new Date('2026-01-10T10:00:00Z'),
      producerPartitaIva: piva,
      producerName: 'Vecchio Nome SRL',
    })
    await fir(a, {
      createdAt: new Date('2026-03-10T10:00:00Z'),
      producerPartitaIva: piva,
      producerName: 'Nuovo Nome SRL',
    })
    await fir(b, {
      createdAt: new Date('2026-06-10T10:00:00Z'),
      producerPartitaIva: piva,
      producerName: 'Altro Tenant SRL',
    })

    const top = await nel(a.tenantId, () => service.getTopProducers(a.tenantId, 5))
    expect(top).toEqual([{ partitaIva: piva, nome: 'Nuovo Nome SRL', count: 2 }])
  })

  it('trasportatori: nome vuoto -> null; nome dello snapshot piu recente', async () => {
    const a = await azienda()
    const vuota = partitaIvaUnica()
    const piena = partitaIvaUnica()
    await fir(a, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      carrierPartitaIva: vuota,
      carrierName: '   ',
    })
    await fir(a, {
      createdAt: new Date('2026-02-01T10:00:00Z'),
      carrierPartitaIva: piena,
      carrierName: 'Trasporti Uno',
    })
    await fir(a, {
      createdAt: new Date('2026-02-02T10:00:00Z'),
      carrierPartitaIva: piena,
      carrierName: 'Trasporti Due',
    })

    const top = await nel(a.tenantId, () => service.getTopCarriers(a.tenantId, 5))
    expect(top).toEqual([
      { partitaIva: piena, nome: 'Trasporti Due', count: 2 },
      { partitaIva: vuota, nome: null, count: 1 },
    ])
  })

  it("getFIRsByStatus con l'intervallo di novembre conta solo quelli di novembre", async () => {
    const a = await azienda()
    await fir(a, { createdAt: new Date('2026-10-20T10:00:00Z') })
    await fir(a, { createdAt: new Date('2026-11-03T10:00:00Z') })
    await fir(a, { createdAt: new Date('2026-11-20T10:00:00Z') })

    const intervallo = {
      startDate: new Date('2026-11-01T00:00:00Z'),
      endDate: new Date('2026-11-30T23:59:59.999Z'),
    }
    expect(await nel(a.tenantId, () => service.getFIRsByStatus(a.tenantId, intervallo))).toEqual({
      DRAFT: 2,
    })
    expect(await nel(a.tenantId, () => service.getFIRsByStatus(a.tenantId))).toEqual({ DRAFT: 3 })
  })

  it("previsione: retta sui sei mesi completi, calcolata a mano; l'altro tenant e il mese in corso non contano", async () => {
    const a = await azienda()
    const b = await azienda()
    const oggi = new Date(Date.UTC(2026, 10, 15, 12))
    // maggio..ottobre 2026: 10, 12, 14, 16, 18, 20 FIR -> retta y = 10 + 2x, x = 6 -> 22
    const conteggi = [10, 12, 14, 16, 18, 20]
    for (let i = 0; i < conteggi.length; i++) {
      for (let k = 0; k < conteggi[i]; k++) {
        await fir(a, {
          createdAt: new Date(Date.UTC(2026, 4 + i, 1 + (k % 27), 9)),
          status: 'COMPLETED',
        })
      }
    }
    // mese in corso (parziale) e altro tenant: non cambiano nulla
    for (let k = 0; k < 3; k++) await fir(a, { createdAt: new Date(Date.UTC(2026, 10, 2, 9)) })
    for (let k = 0; k < 50; k++) {
      await fir(b, { createdAt: new Date(Date.UTC(2026, 9, 2, 9)), status: 'COMPLETED' })
    }
    // bozze, in attesa e annullati in ottobre: la previsione parla solo dei FIR compiuti
    for (const status of ['DRAFT', 'AWAITING_PRODUCER', 'CANCELLED'] as const) {
      for (let k = 0; k < 7; k++) {
        await fir(a, { createdAt: new Date(Date.UTC(2026, 9, 3, 9)), status })
      }
    }

    expect(await nel(a.tenantId, () => service.predictNextMonthVolume(a.tenantId, oggi))).toBe(22)
    expect(await nel(b.tenantId, () => service.predictNextMonthVolume(b.tenantId, oggi))).toBe(50)
  }, 60_000)

  it('previsione: nessun mese completo -> null', async () => {
    const a = await azienda()
    await fir(a, { createdAt: new Date(Date.UTC(2026, 10, 2, 9)) })
    const oggi = new Date(Date.UTC(2026, 10, 15, 12))
    expect(await nel(a.tenantId, () => service.predictNextMonthVolume(a.tenantId, oggi))).toBeNull()
  })
})
