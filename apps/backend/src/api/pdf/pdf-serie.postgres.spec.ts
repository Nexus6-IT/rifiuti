/**
 * PDF dei FIR (4.7, T7) contro un Postgres reale, collegato COME `wasteflow_app` (RLS attiva) e
 * dentro il `TenantContext`: la serie include solo i FIR dell'azienda, il modello di un'altra
 * azienda non si vede (404), il PDF e' un vero PDF. Pulizia solo per id esatti creati.
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

import { ModelliStampaService } from '../../application/modelli-stampa/modelli-stampa.service'
import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { PDFService } from '../../infrastructure/pdf/pdf.service'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { PdfController } from './pdf.controller'

describe('PdfController — serie di FIR e modelli, Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let controller: PdfController
  const tenantCreati: string[] = []
  let n = 0

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    controller = new PdfController(
      new PDFService(logger),
      app,
      {} as any,
      {} as any,
      new ModelliStampaService(app)
    )
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const filtro = { tenantId: { in: tenantCreati } }
      await owner.fIR.deleteMany({ where: filtro })
      await owner.companyTemplate.deleteMany({ where: filtro })
      await owner.user.deleteMany({ where: filtro })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function azienda() {
    const k = `${Date.now()}${++n}`
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'PDF SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const user = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-pdf-${k}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `pdf-${k}@example.com`,
        role: 'OPERATOR',
      },
    })
    const fir = await owner.fIR.create({
      data: {
        tenantId: t.id,
        producerUserId: user.id,
        producerPartitaIva: '00000000000',
        producerName: 'Produttore',
        producerAddress: 'Via Roma 1',
        carrierPartitaIva: '00000000001',
        carrierName: 'Trasportatore',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: '00000000002',
        receiverName: 'Destinatario',
        receiverAddress: 'Via Roma 2',
        cerCode: '15 01 01',
        wasteDescription: 'Imballaggi di carta',
        wasteCategory: 'Non pericoloso',
        quantity: 60,
        transportDate: new Date('2026-03-05T08:00:00Z'),
        provenienza: 'SPECIALE',
        firNumber: `FIR/PDF/${k}`,
      },
    })
    return { tenantId: t.id, firId: fir.id }
  }

  const req = (tenantId: string) => ({ tenantId, user: { tenantId } }) as any
  const risposta = () => {
    const r: any = { headers: {} as Record<string, unknown>, body: undefined as unknown }
    r.set = (h: Record<string, unknown>) => Object.assign(r.headers, h)
    r.send = (b: unknown) => (r.body = b)
    return r
  }
  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  it('serie: solo i FIR dell’azienda (RLS + filtro), l’altro e’ escluso e contato; PDF vero', async () => {
    const a = await azienda()
    const b = await azienda()
    const res = risposta()
    await nel(a.tenantId, () =>
      controller.downloadFIRSerie({ firIds: [b.firId, a.firId] }, req(a.tenantId), res)
    )
    expect(res.headers['X-Fir-Esclusi']).toBe('1')
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF')
  })

  it('serie con soli FIR altrui: 404', async () => {
    const a = await azienda()
    const b = await azienda()
    await expect(
      nel(a.tenantId, () =>
        controller.downloadFIRSerie({ firIds: [b.firId] }, req(a.tenantId), risposta())
      )
    ).rejects.toMatchObject({ status: 404 })
  })

  it('modello di un’altra azienda: 404 (RLS), anche con FIR proprio', async () => {
    const a = await azienda()
    const b = await azienda()
    const m = await owner.companyTemplate.create({
      data: { tenantId: b.tenantId, name: 'Modello B', ambito: 'FIR' },
    })
    await expect(
      nel(a.tenantId, () => controller.downloadFIR(a.firId, req(a.tenantId), risposta(), m.id))
    ).rejects.toMatchObject({ status: 404 })
  })

  it('modello predefinito FIR dell’azienda: applicato (copie 2 = due pagine in piu’ di una sola)', async () => {
    const a = await azienda()
    const una = risposta()
    await nel(a.tenantId, () => controller.downloadFIR(a.firId, req(a.tenantId), una))
    await owner.companyTemplate.create({
      data: { tenantId: a.tenantId, name: 'FIR x2', ambito: 'FIR', copie: 2, isDefault: true },
    })
    const due = risposta()
    await nel(a.tenantId, () => controller.downloadFIR(a.firId, req(a.tenantId), due))
    const pagine = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length
    expect(pagine(due.body)).toBe(pagine(una.body) * 2)
  })
})
