import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { MudAggregazioneService } from './mud-aggregazione.service'
import { limitiAnnoMud } from './mud-regole'

/**
 * Saldo del registro al 31/12 per l'avviso delle giacenze, contro un Postgres reale:
 * il confine dell'anno italiano e le somme Decimal stanno nella query, quindi solo il
 * database vero li prova.
 */
describe('MudAggregazioneService.saldiAl31Dicembre — Postgres reale', () => {
  let prisma: PrismaClient
  let service: any
  let tenantId: string
  let altroTenantId: string
  const registroDi: Record<string, string> = {}
  let contatore = 0

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    const suffisso = Date.now().toString().slice(-9)
    tenantId = (
      await prisma.tenant.create({
        data: { partitaIva: `SA${suffisso}`, ragioneSociale: 'Saldi MUD SRL', country: 'IT' },
      })
    ).id
    altroTenantId = (
      await prisma.tenant.create({
        data: { partitaIva: `SB${suffisso}`, ragioneSociale: 'Saldi MUD Altro SRL', country: 'IT' },
      })
    ).id
    for (const t of [tenantId, altroTenantId]) {
      registroDi[t] = (
        await prisma.registroRifiuti.create({
          data: { tenantId: t, descrizione: 'Registro cronologico' },
        })
      ).id
    }
    const logger: any = { setContext: jest.fn() }
    service = new MudAggregazioneService(prisma as any, {} as any, logger)
  })

  afterAll(async () => {
    await prisma.giacenzaIniziale.deleteMany({
      where: { tenantId: { in: [tenantId, altroTenantId].filter(Boolean) } },
    })
    await prisma.wasteMovement.deleteMany({
      where: { tenantId: { in: [tenantId, altroTenantId].filter(Boolean) } },
    })
    await prisma.registroRifiuti.deleteMany({
      where: { tenantId: { in: [tenantId, altroTenantId].filter(Boolean) } },
    })
    await prisma.tenant.deleteMany({
      where: { id: { in: [tenantId, altroTenantId].filter(Boolean) } },
    })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.giacenzaIniziale.deleteMany({
      where: { tenantId: { in: [tenantId, altroTenantId].filter(Boolean) } },
    })
    await prisma.wasteMovement.deleteMany({
      where: { tenantId: { in: [tenantId, altroTenantId].filter(Boolean) } },
    })
  })

  async function inserisci(
    tipo: 'CARICO' | 'SCARICO',
    data: string,
    quantity: number,
    unit: string,
    cerCode: string,
    tenant = tenantId
  ): Promise<void> {
    const movementDate = new Date(data)
    await prisma.wasteMovement.create({
      data: {
        tenantId: tenant,
        registroId: registroDi[tenant],
        progressiveYear: movementDate.getUTCFullYear(),
        progressiveNumber: ++contatore,
        type: tipo,
        movementDate,
        registrationDate: movementDate,
        causale: tipo === 'CARICO' ? 'ALTRO_CARICO' : 'ALTRO_SCARICO',
        cerCode,
        quantity,
        unit,
      },
    })
  }

  const saldi = () => service.saldiAl31Dicembre(tenantId, limitiAnnoMud(2025).fine, 2025)
  const apertura = (
    data: string,
    quantita: number,
    unita: string,
    cerCode: string,
    tenant = tenantId
  ) =>
    prisma.giacenzaIniziale.create({
      data: {
        tenantId: tenant,
        registroId: registroDi[tenant],
        cerCode,
        quantita,
        unita,
        dataRiferimento: new Date(`${data}T00:00:00Z`),
        impostatoDa: randomUUID(),
      },
    })

  it('confine dell anno italiano: 23:30 italiane del 31/12 dentro, 00:30 del 1/1 fuori', async () => {
    await inserisci('CARICO', '2025-12-31T22:30:00Z', 100, 'KG', '20 03 01')
    await inserisci('CARICO', '2025-12-31T23:30:00Z', 40, 'KG', '20 03 01')
    expect(await saldi()).toEqual([{ cerCode6: '20 03 01', kg: 100 }])
  })

  it('CER in formati diversi, unità KG/kg/t/vuota e somme Decimal, anni precedenti inclusi', async () => {
    await inserisci('CARICO', '2024-05-10T08:00:00Z', 100.25, 'KG', '200301')
    await inserisci('CARICO', '2025-03-10T08:00:00Z', 50.5, 'kg', '20 03 01')
    await inserisci('CARICO', '2025-04-10T08:00:00Z', 0.1, 't', '20 03 01')
    await inserisci('CARICO', '2025-04-11T08:00:00Z', 10, '', '20 03 01')
    await inserisci('SCARICO', '2025-06-10T08:00:00Z', 60.75, 'KG', '200301')
    await inserisci('CARICO', '2025-06-10T08:00:00Z', 5, 'LITRI', '200301')
    expect(await saldi()).toEqual([{ cerCode6: '20 03 01', kg: 200 }])
  })

  it('un altro tenant non entra nel saldo', async () => {
    await inserisci('CARICO', '2025-03-10T08:00:00Z', 70, 'KG', '20 03 01')
    await inserisci('CARICO', '2025-03-10T08:00:00Z', 999, 'KG', '20 03 01', altroTenantId)
    expect(await saldi()).toEqual([{ cerCode6: '20 03 01', kg: 70 }])
  })

  it('le aperture con data fino al 31/12 (incluso) contano, quelle dal 1/1 no', async () => {
    await inserisci('CARICO', '2025-03-10T08:00:00Z', 100, 'KG', '20 03 01')
    await apertura('2025-12-31', 2, 'T', '20 03 01')
    await apertura('2026-01-01', 999, 'KG', '20 03 01')
    expect(await saldi()).toEqual([{ cerCode6: '20 03 01', kg: 2100 }])
  })

  it('un CER con la sola apertura compare; unità non di massa e altri tenant no', async () => {
    await apertura('2025-02-01', 75.5, 'KG', '15 01 10*')
    await apertura('2025-02-01', 300, 'LITRI', '16 01 01')
    await apertura('2025-02-01', 999, 'KG', '20 03 01', altroTenantId)
    expect(await saldi()).toEqual([{ cerCode6: '15 01 10*', kg: 75.5 }])
  })

  it("l'apertura compensa uno scarico dello stesso CER nel saldo", async () => {
    await apertura('2025-01-01', 100, 'KG', '20 03 01')
    await inserisci('SCARICO', '2025-06-10T08:00:00Z', 30, 'KG', '200301')
    expect(await saldi()).toEqual([{ cerCode6: '20 03 01', kg: 70 }])
  })
})
