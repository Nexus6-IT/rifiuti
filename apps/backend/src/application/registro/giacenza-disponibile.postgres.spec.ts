import { PrismaClient } from '@prisma/client'
import { giacenzaDisponibileAl } from './giacenza-disponibile'

/**
 * Saldo complessivo e saldo dalla data del movimento, contro un Postgres reale:
 * il raggruppamento per giorno italiano, il fuso e la conversione t -> kg stanno
 * nell'SQL, quindi solo il database vero li prova.
 */
describe('giacenzaDisponibileAl — Postgres reale', () => {
  let prisma: PrismaClient
  let tenantId: string
  let altroTenantId: string
  /** Registro principale di ogni azienda e un secondo registro del primo tenant (un'altra sede). */
  const registroDi: Record<string, string> = {}
  let secondoRegistroId: string
  let contatore = 0

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    const suffisso = Date.now().toString().slice(-9)
    const tenant = await prisma.tenant.create({
      data: { partitaIva: `GD${suffisso}`, ragioneSociale: 'Giacenza Test SRL', country: 'IT' },
    })
    tenantId = tenant.id
    const altro = await prisma.tenant.create({
      data: { partitaIva: `GE${suffisso}`, ragioneSociale: 'Giacenza Altro SRL', country: 'IT' },
    })
    altroTenantId = altro.id
    for (const t of [tenantId, altroTenantId]) {
      registroDi[t] = (
        await prisma.registroRifiuti.create({
          data: { tenantId: t, descrizione: 'Registro cronologico' },
        })
      ).id
    }
    const sede = await prisma.rentriUnitaLocale.create({
      data: {
        tenantId,
        numIscrSito: `OP0001GD${Date.now().toString().slice(-6)}-MI0001`,
        denominazione: 'Sede B',
      },
    })
    secondoRegistroId = (
      await prisma.registroRifiuti.create({
        data: { tenantId, unitaLocaleId: sede.id, descrizione: 'Registro Sede B' },
      })
    ).id
  })

  afterAll(async () => {
    await prisma.wasteMovement.deleteMany({
      where: { tenantId: { in: [tenantId, altroTenantId].filter(Boolean) } },
    })
    await prisma.registroRifiuti.deleteMany({
      where: { tenantId: { in: [tenantId, altroTenantId].filter(Boolean) } },
    })
    await prisma.rentriUnitaLocale.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({
      where: { id: { in: [tenantId, altroTenantId].filter(Boolean) } },
    })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
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
    tenant: string,
    registroId = registroDi[tenant]
  ): Promise<void> {
    const movementDate = new Date(data)
    await prisma.wasteMovement.create({
      data: {
        tenantId: tenant,
        registroId,
        progressiveYear: 2026,
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
  const carico = (
    data: string,
    qty: number,
    unit = 'KG',
    cer = '99 99 01',
    tenant = tenantId,
    registroId?: string
  ) => inserisci('CARICO', data, qty, unit, cer, tenant, registroId)
  const scarico = (
    data: string,
    qty: number,
    unit = 'KG',
    cer = '99 99 01',
    tenant = tenantId,
    registroId?: string
  ) => inserisci('SCARICO', data, qty, unit, cer, tenant, registroId)
  const disp = (alla: Date, cer = '99 99 01', registroId = registroDi[tenantId]) =>
    prisma.$transaction(tx =>
      giacenzaDisponibileAl(tx, { tenantId, registroId, cerCode: cer, alla })
    )

  it('la giacenza conta solo i movimenti del registro richiesto', async () => {
    // Carichi e scarichi della sede B non entrano nel saldo della sede A, e viceversa; vale anche
    // per l'elenco delle unita' non di massa caricate.
    await carico('2026-03-01', 100)
    await carico('2026-03-01', 500, 'KG', '99 99 01', tenantId, secondoRegistroId)
    await scarico('2026-03-02', 30, 'KG', '99 99 01', tenantId, secondoRegistroId)
    await carico('2026-03-01', 7, 'LITRI', '99 99 01', tenantId, secondoRegistroId)
    expect(await disp(new Date('2026-03-05'))).toEqual({
      saldoComplessivoKg: 100,
      disponibileAllaDataKg: 100,
      vincoloAl: new Date('2026-03-05T00:00:00Z'),
      unitaNonDiMassaCaricate: [],
    })
    expect(await disp(new Date('2026-03-05'), '99 99 01', secondoRegistroId)).toMatchObject({
      saldoComplessivoKg: 470,
      unitaNonDiMassaCaricate: ['LITRI'],
    })
  })

  it('saldo semplice: carichi meno scarichi fino alla data', async () => {
    await carico('2026-03-01', 100)
    await scarico('2026-03-02', 30)
    expect(await disp(new Date('2026-03-05'))).toMatchObject({
      saldoComplessivoKg: 70,
      disponibileAllaDataKg: 70,
    })
  })

  it('non consuma carichi successivi alla data dello scarico', async () => {
    await carico('2026-03-10', 100)
    expect(await disp(new Date('2026-03-05'))).toEqual({
      saldoComplessivoKg: 100,
      disponibileAllaDataKg: 0,
      vincoloAl: new Date('2026-03-05T00:00:00Z'),
      unitaNonDiMassaCaricate: [],
    })
  })

  it('non rompe il saldo di uno scarico successivo già registrato', async () => {
    await carico('2026-03-01', 100)
    await scarico('2026-03-03', 100)
    expect(await disp(new Date('2026-03-02'))).toEqual({
      saldoComplessivoKg: 0,
      disponibileAllaDataKg: 0,
      vincoloAl: new Date('2026-03-03T00:00:00Z'),
      unitaNonDiMassaCaricate: [],
    })
  })

  it('il saldo complessivo conta anche i movimenti successivi alla data', async () => {
    await carico('2026-03-10', 100)
    await scarico('2026-03-12', 30)
    expect((await disp(new Date('2026-03-05'))).saldoComplessivoKg).toBe(70)
  })

  it('carico e scarico nello stesso giorno italiano si compensano', async () => {
    await carico('2026-03-01T10:00:00Z', 50) // client API con l'ora
    expect((await disp(new Date('2026-03-01T00:00:00Z'))).disponibileAllaDataKg).toBe(50) // data senza ora
  })

  it('un movimento delle 00:30 italiane appartiene al giorno dopo', async () => {
    await carico('2026-03-01T23:30:00Z', 50) // 02/03 00:30 a Roma
    expect((await disp(new Date('2026-03-01T00:00:00Z'))).disponibileAllaDataKg).toBe(0)
  })

  it('somma kg e tonnellate e ignora le unità non di massa', async () => {
    await carico('2026-03-01', 1, 'T')
    await scarico('2026-03-02', 600, 'kg')
    await carico('2026-03-02', 30, 'LITRI')
    await scarico('2026-03-02', 5, 'M3')
    expect(await disp(new Date('2026-03-05'))).toMatchObject({
      saldoComplessivoKg: 400,
      disponibileAllaDataKg: 400,
    })
  })

  it('riporta le unità non di massa dei carichi', async () => {
    await carico('2026-03-01', 5000, 'LITRI')
    await carico('2026-03-01', 2, ' m3 ')
    await carico('2026-03-01', 10, 'KG')
    await scarico('2026-03-02', 5, 'GALLONI')
    expect((await disp(new Date('2026-03-05'))).unitaNonDiMassaCaricate).toEqual(['LITRI', 'M3'])
  })

  it("l'unità vuota vale kg", async () => {
    await carico('2026-03-01', 70, '')
    expect((await disp(new Date('2026-03-05'))).disponibileAllaDataKg).toBe(70)
  })

  it('CER con e senza asterisco sono lo stesso rifiuto', async () => {
    await carico('2026-03-01', 80, 'KG', '99 99 01*')
    expect((await disp(new Date('2026-03-05'), '99 99 01')).saldoComplessivoKg).toBe(80)
  })

  it('conta i movimenti storici col CER scritto senza spazi', async () => {
    // Righe scritte prima della normalizzazione "NN NN NN": il CER è lo stesso.
    await carico('2026-03-01', 70, 'KG', '999901')
    await carico('2026-03-01', 5, 'KG', '99 99 02')
    expect((await disp(new Date('2026-03-05'), '99 99 01')).saldoComplessivoKg).toBe(70)
  })

  it('ignora i movimenti di un altro tenant', async () => {
    await carico('2026-03-01', 500, 'KG', '99 99 01', altroTenantId)
    await scarico('2026-03-02', 20, 'KG', '99 99 01', altroTenantId)
    expect(await disp(new Date('2026-03-05'))).toMatchObject({
      saldoComplessivoKg: 0,
      disponibileAllaDataKg: 0,
    })
  })
})
