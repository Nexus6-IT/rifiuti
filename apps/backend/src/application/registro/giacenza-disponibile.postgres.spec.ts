import { randomUUID } from 'crypto'
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
    await prisma.giacenzaIniziale.deleteMany({
      where: { tenantId: { in: [tenantId, altroTenantId].filter(Boolean) } },
    })
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
  const apertura = (
    data: string,
    quantita: number,
    unita = 'KG',
    cer = '99 99 01',
    registroId = registroDi[tenantId],
    tenant = tenantId
  ) =>
    prisma.giacenzaIniziale.create({
      data: {
        tenantId: tenant,
        registroId,
        cerCode: cer,
        quantita,
        unita,
        dataRiferimento: new Date(`${data}T00:00:00Z`),
        impostatoDa: randomUUID(),
      },
    })
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

  describe('aperture del registro', () => {
    it('lo scarico è bloccato senza apertura e accettato con', async () => {
      expect((await disp(new Date('2026-03-05'))).saldoComplessivoKg).toBe(0)
      await apertura('2026-03-01', 100)
      expect(await disp(new Date('2026-03-05'))).toEqual({
        saldoComplessivoKg: 100,
        disponibileAllaDataKg: 100,
        vincoloAl: new Date('2026-03-05T00:00:00Z'),
        unitaNonDiMassaCaricate: [],
      })
    })

    it('si somma ai movimenti: apertura in t e scarico in kg', async () => {
      await apertura('2026-03-01', 2, 'T')
      await scarico('2026-03-02', 500)
      await carico('2026-03-03', 100)
      expect(await disp(new Date('2026-03-05'))).toMatchObject({
        saldoComplessivoKg: 1600,
        disponibileAllaDataKg: 1600,
      })
    })

    it("un'apertura datata dopo lo scarico non lo copre alla data precedente", async () => {
      await apertura('2026-03-10', 100)
      // Come un carico successivo: nessun blocco (saldo complessivo 100), ma alla data dello
      // scarico non c'è ancora nulla, quindi scatta solo l'avviso sull'ordine delle date.
      expect(await disp(new Date('2026-03-05'))).toEqual({
        saldoComplessivoKg: 100,
        disponibileAllaDataKg: 0,
        vincoloAl: new Date('2026-03-05T00:00:00Z'),
        unitaNonDiMassaCaricate: [],
      })
    })

    it("l'apertura di un altro registro o di un altro tenant non conta", async () => {
      await apertura('2026-03-01', 300, 'KG', '99 99 01', secondoRegistroId)
      await apertura('2026-03-01', 400, 'KG', '99 99 01', registroDi[altroTenantId], altroTenantId)
      expect((await disp(new Date('2026-03-05'))).saldoComplessivoKg).toBe(0)
    })

    it('CER confrontato sulle sole cifre (apertura con asterisco)', async () => {
      await apertura('2026-03-01', 80, 'KG', '99 99 01*')
      expect((await disp(new Date('2026-03-05'), '99 99 01')).saldoComplessivoKg).toBe(80)
      expect((await disp(new Date('2026-03-05'), '99 99 02')).saldoComplessivoKg).toBe(0)
    })

    it("un'apertura in litri non entra nei kg ma compare fra le unità non di massa", async () => {
      await apertura('2026-03-01', 50, 'LITRI')
      await apertura('2026-03-01', 10)
      expect(await disp(new Date('2026-03-05'))).toMatchObject({
        saldoComplessivoKg: 10,
        unitaNonDiMassaCaricate: ['LITRI'],
      })
    })

    it('il giorno è quello della data, qualunque sia il fuso della sessione', async () => {
      await apertura('2026-03-05', 40)
      for (const fuso of ['UTC', 'Europe/Rome', 'Pacific/Auckland', 'America/Los_Angeles']) {
        const r = await prisma.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE '${fuso}'`)
          const base = { tenantId, registroId: registroDi[tenantId], cerCode: '99 99 01' }
          return {
            prima: await giacenzaDisponibileAl(tx, {
              ...base,
              alla: new Date('2026-03-04T12:00:00Z'),
            }),
            stesso: await giacenzaDisponibileAl(tx, {
              ...base,
              alla: new Date('2026-03-05T12:00:00Z'),
            }),
          }
        })
        expect(r.prima.disponibileAllaDataKg).toBe(0)
        expect(r.stesso.disponibileAllaDataKg).toBe(40)
      }
    })
  })
})
