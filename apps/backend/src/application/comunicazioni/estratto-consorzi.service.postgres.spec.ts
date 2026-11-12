/**
 * Estratto consorzi contro un Postgres reale, al confine del capodanno di Roma: i pesi specifici
 * del MUD sono per anno solare italiano, quindi un movimento alle 23:30 del 31/12 e uno alle 00:30
 * del 01/01 (ora di Roma) usano pesi di anni diversi, senza movimenti persi o doppi.
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
import {
  creaAziendaMud,
  creaMovimento,
  pulisciAziendeMud,
  type AziendaMud,
} from '../mud/aggregazione/mud-seed.postgres-spec'
import { EstrattoConsorziService } from './estratto-consorzi.service'

const pesi = (kg: number) => ({
  integrazioni: {
    pesiSpecifici: { '130205|L': { cerCode: '13 02 05', unita: 'L', kgPerUnita: kg } },
  },
})

describe('EstrattoConsorziService — capodanno di Roma, Postgres reale', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const tenantCreati: string[] = []
  let az: AziendaMud

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(process.env.DATABASE_URL)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    az = await creaAziendaMud(owner, 'CD')
    tenantCreati.push(az.tenantId)
    await owner.mUDReport.create({
      data: { tenantId: az.tenantId, year: 2025, reportData: pesi(0.5) },
    })
    await owner.mUDReport.create({
      data: { tenantId: az.tenantId, year: 2026, reportData: pesi(2) },
    })
  })

  afterAll(async () => {
    await pulisciAziendeMud(owner, tenantCreati)
    await app.onModuleDestroy?.()
    await owner.$disconnect()
  })

  it('ogni movimento prende i pesi del proprio anno solare di Roma, nessuno perso o doppio', async () => {
    const base = {
      type: 'CARICO' as const,
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05',
      quantita: 100,
      unita: 'L',
    }
    // 23:30 del 31/12 a Roma (22:30Z) e 00:30 del 01/01 a Roma (23:30Z)
    await creaMovimento(owner, az, {
      ...base,
      giorno: '2025-12-31',
      istante: '2025-12-31T22:30:00Z',
    })
    await creaMovimento(owner, az, {
      ...base,
      giorno: '2025-12-31',
      istante: '2025-12-31T23:30:00Z',
    })
    const classifica = async (_t: string, ms: ReadonlyArray<unknown>) =>
      ms.map(() => ({ marcature: [{ consorzio: 'COBAT', origine: 'REGOLA' }] }))
    const servizio = new EstrattoConsorziService(app, { classifica } as never)

    const esito = await TenantContext.run({ tenantId: az.tenantId }, () =>
      servizio.estratto(az.tenantId, {
        consorzio: 'COBAT',
        da: '2025-12-31',
        a: '2026-01-01',
        unitaLocaleId: az.unitaLocaleId,
      })
    )

    expect(esito.righe).toBe(2)
    const righe = esito.csv.split('\n').filter(r => r.includes('2025') || r.includes('2026'))
    const del31 = righe.find(r => r.includes('31/12/2025') || r.includes('2025-12-31'))
    const del01 = righe.find(r => r.includes('01/01/2026') || r.includes('2026-01-01'))
    expect(del31).toMatch(/\b50\b/)
    expect(del01).toMatch(/\b200\b/)
  })
})
