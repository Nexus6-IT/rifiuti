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

  it('un estratto su cinque anni legge i movimenti una volta per sede, non una per anno', async () => {
    const classifica = async (_t: string, ms: ReadonlyArray<unknown>) =>
      ms.map(() => ({ marcature: [{ consorzio: 'COBAT', origine: 'REGOLA' }] }))
    const servizio = new EstrattoConsorziService(app, { classifica } as never)
    const lettureMovimenti = jest.spyOn(app.wasteMovement, 'findMany')
    const lettureMud = jest.spyOn(app.mUDReport, 'findMany')
    try {
      const esito = await TenantContext.run({ tenantId: az.tenantId }, () =>
        servizio.estratto(az.tenantId, {
          consorzio: 'COBAT',
          da: '2021-01-01',
          a: '2025-12-31',
          unitaLocaleId: az.unitaLocaleId,
        })
      )
      // solo la riga delle 23:30 Roma del 31/12/2025: quella delle 00:30 del 01/01/2026 e' fuori periodo
      expect(esito.righe).toBe(1)
      expect(lettureMovimenti).toHaveBeenCalledTimes(1)
      // MUD del periodo + ripiego sui precedenti (2021-2024 senza MUD): due query, non una per anno
      expect(lettureMud).toHaveBeenCalledTimes(2)
    } finally {
      lettureMovimenti.mockRestore()
      lettureMud.mockRestore()
    }
  })

  const classificaCobat = async (_t: string, ms: ReadonlyArray<unknown>) =>
    ms.map(() => ({ marcature: [{ consorzio: 'COBAT', origine: 'REGOLA' }] }))

  it('anno senza MUD: ripiega sui pesi del MUD precedente piu vicino e lo dichiara', async () => {
    // 2027 non ha MUD: ripiega sul 2026 (2 kg/L), non sul 2025 (0,5 kg/L)
    await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05',
      quantita: 100,
      unita: 'L',
      giorno: '2027-01-10',
      istante: '2027-01-10T10:00:00Z',
    })
    const servizio = new EstrattoConsorziService(app, { classifica: classificaCobat } as never)
    const esito = await TenantContext.run({ tenantId: az.tenantId }, () =>
      servizio.estratto(az.tenantId, {
        consorzio: 'COBAT',
        da: '2027-01-01',
        a: '2027-01-31',
        unitaLocaleId: az.unitaLocaleId,
      })
    )
    expect(esito.righe).toBe(1)
    expect(esito.csv).toMatch(/;"200";"100";"L";/)
    expect(esito.csv).toContain('Stimati con i pesi del MUD 2026')
    expect(esito.kgStimati).toEqual([{ anno: 2027, annoMud: 2026, righe: 1 }])
    expect(esito.avvisi).toHaveLength(1)
  })

  it('senza nessun MUD precedente i kg restano vuoti come prima, senza avviso', async () => {
    const senzaMud = await creaAziendaMud(owner, 'CE')
    tenantCreati.push(senzaMud.tenantId)
    await creaMovimento(owner, senzaMud, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05',
      quantita: 100,
      unita: 'L',
      giorno: '2027-01-10',
      istante: '2027-01-10T10:00:00Z',
    })
    const servizio = new EstrattoConsorziService(app, { classifica: classificaCobat } as never)
    const esito = await TenantContext.run({ tenantId: senzaMud.tenantId }, () =>
      servizio.estratto(senzaMud.tenantId, {
        consorzio: 'COBAT',
        da: '2027-01-01',
        a: '2027-01-31',
        unitaLocaleId: senzaMud.unitaLocaleId,
      })
    )
    expect(esito.righe).toBe(1)
    expect(esito.csv).toMatch(/;"";"100";"L";/)
    expect(esito.csv).not.toContain('Stimati')
    expect(esito.kgStimati).toEqual([])
    expect(esito.avvisi).toEqual([])
  })

  it('MUD dell’anno gia creato ma senza pesi (bozza): ripiega sul precedente con pesi e avvisa', async () => {
    const conBozza = await creaAziendaMud(owner, 'CF')
    tenantCreati.push(conBozza.tenantId)
    await owner.mUDReport.create({
      data: { tenantId: conBozza.tenantId, year: 2026, reportData: pesi(2) },
    })
    await owner.mUDReport.create({
      data: { tenantId: conBozza.tenantId, year: 2027, reportData: {} },
    })
    await creaMovimento(owner, conBozza, {
      type: 'CARICO',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05',
      quantita: 100,
      unita: 'L',
      giorno: '2027-01-10',
      istante: '2027-01-10T10:00:00Z',
    })
    const servizio = new EstrattoConsorziService(app, { classifica: classificaCobat } as never)
    const esito = await TenantContext.run({ tenantId: conBozza.tenantId }, () =>
      servizio.estratto(conBozza.tenantId, {
        consorzio: 'COBAT',
        da: '2027-01-01',
        a: '2027-01-31',
        unitaLocaleId: conBozza.unitaLocaleId,
      })
    )
    expect(esito.csv).toMatch(/;"200";"100";"L";/)
    expect(esito.kgStimati).toEqual([{ anno: 2027, annoMud: 2026, righe: 1 }])
  })
})
