import { PrismaClient } from '@prisma/client'
import { RegistraMovimentoUseCase } from './registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'
import * as giacenzaModulo from '../giacenza-disponibile'
import { FIRPrismaRepository } from '../../../infrastructure/persistence/fir-prisma.repository'
import { FIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { FirGiaRegistratoError } from '../../../core/domain/errors'
import type {
  CausaleMovimento,
  WasteMovementType,
} from '../../../domain/waste-movement/waste-movement.entity'

/**
 * Controllo di giacenza contro un Postgres reale: il lock della giacenza e la
 * serializzazione degli scarichi concorrenti si vedono solo con un database vero
 * (un mock non prende lock).
 */
describe('RegistraMovimentoUseCase — giacenza su Postgres reale', () => {
  const CER = '99 99 01'
  // recorded_by_user_id ha una FK verso users: nei test il movimento non ha autore.
  const USER = undefined as unknown as string
  const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }
  let prisma: PrismaClient
  let useCase: RegistraMovimentoUseCase
  let tenantId: string
  let cerCreato = false

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
    useCase = new RegistraMovimentoUseCase(prisma as any, loggerStub as any)
    const suffisso = Date.now().toString().slice(-9)
    const tenant = await prisma.tenant.create({
      data: { partitaIva: `RM${suffisso}`, ragioneSociale: 'Registro Giacenza SRL', country: 'IT' },
    })
    tenantId = tenant.id
    cerCreato = (await prisma.cERCode.count({ where: { code: CER } })) === 0
    await prisma.cERCode.upsert({
      where: { code: CER },
      create: { code: CER, description: 'CER di test', category: '99', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    await prisma.wasteMovement.deleteMany({ where: { tenantId } })
    await prisma.tenant.deleteMany({ where: { id: tenantId } })
    if (cerCreato) await prisma.cERCode.deleteMany({ where: { code: CER } })
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    await prisma.wasteMovement.deleteMany({ where: { tenantId } })
  })

  function cmd(
    type: WasteMovementType,
    causale: string,
    qty: number,
    data: string,
    unit = 'KG',
    firId?: string,
    dataRegistrazione = data
  ): RegistraMovimentoCommand {
    return new RegistraMovimentoCommand(
      tenantId,
      USER,
      type,
      new Date(data),
      new Date(dataRegistrazione),
      causale as CausaleMovimento,
      CER,
      undefined,
      qty,
      unit,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      firId,
      undefined
    )
  }

  /** Movimento scritto senza use case (storico), con progressivi lontani da quelli assegnati. */
  function movimentoDiretto(type: WasteMovementType, qty: number, data: string, n: number) {
    return {
      tenantId,
      progressiveYear: 2025,
      progressiveNumber: 900 + n,
      type,
      movementDate: new Date(data),
      registrationDate: new Date(data),
      causale: type === 'CARICO' ? 'ALTRO_CARICO' : 'ALTRO_SCARICO',
      cerCode: CER,
      quantity: qty,
      unit: 'KG',
    }
  }

  it('due scarichi concorrenti in anni di registrazione diversi: ne passa uno solo', async () => {
    // Il lock del progressivo è <tenant>-<anno>: con anni diversi non li serializza.
    // Solo il lock della giacenza può farlo, ed è quello che questo test prova.
    expect(
      (await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 100, '2025-12-20'))).isSuccess
    ).toBe(true)
    // Barriera: ogni lettura della giacenza aspetta l'altra (al massimo 500 ms). Senza il
    // lock della giacenza le due letture avvengono insieme, prima di qualunque scrittura,
    // e passano entrambe; con il lock la seconda arriva solo dopo il commit della prima.
    // Senza barriera l'esito dipenderebbe dai tempi del pool di connessioni.
    const reale = giacenzaModulo.giacenzaDisponibileAl
    let arrivate = 0
    let sblocca!: () => void
    const entrambe = new Promise<void>(r => (sblocca = r))
    const spia = jest
      .spyOn(giacenzaModulo, 'giacenzaDisponibileAl')
      .mockImplementation(async (tx, p) => {
        if (++arrivate === 2) sblocca()
        let timer: NodeJS.Timeout | undefined
        await Promise.race([entrambe, new Promise(r => (timer = setTimeout(r, 500)))])
        clearTimeout(timer)
        return reale(tx, p)
      })
    const [a, b] = await Promise.all([
      useCase.execute(
        cmd('SCARICO', 'AVVIO_RECUPERO', 100, '2025-12-30', 'KG', undefined, '2025-12-31')
      ),
      useCase.execute(
        cmd('SCARICO', 'AVVIO_RECUPERO', 100, '2025-12-30', 'KG', undefined, '2026-01-02')
      ),
    ]).finally(() => spia.mockRestore())
    expect(arrivate).toBe(2)
    expect([a, b].filter(e => e.isSuccess)).toHaveLength(1)
    expect([a, b].find(e => e.isFailure)!.error).toContain('Giacenza insufficiente')
    expect(await prisma.wasteMovement.count({ where: { tenantId, type: 'SCARICO' } })).toBe(1)
  })

  it("cinque scarichi concorrenti dell'intera giacenza nello stesso anno: ne passa uno solo", async () => {
    expect(
      (await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 100, '2026-03-01'))).isSuccess
    ).toBe(true)
    const esiti = await Promise.all(
      Array.from({ length: 5 }, () =>
        useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 100, '2026-03-02'))
      )
    )
    expect(esiti.filter(e => e.isSuccess)).toHaveLength(1)
    expect(
      esiti.filter(e => e.isFailure).every(e => e.error.includes('Giacenza insufficiente'))
    ).toBe(true)
  })

  it("uno scarico retrodatato prima dell'unico carico si registra con un avviso", async () => {
    await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 100, '2026-03-10'))
    const r = await useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 50, '2026-03-05'))
    expect(r.isSuccess).toBe(true)
    expect(r.value.avvisi[0]).toContain('Lo scarico è datato 05/03/2026')
  })

  it('uno scarico oltre il saldo complessivo è rifiutato, a qualunque data', async () => {
    await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 100, '2026-03-10'))
    expect(
      (await useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 150, '2026-03-20'))).isFailure
    ).toBe(true)
  })

  it('con uno storico incoerente conta il saldo complessivo', async () => {
    // storico scritto senza use case: carico 100, scarico 200 (saldo -100)
    await prisma.wasteMovement.createMany({
      data: [
        movimentoDiretto('CARICO', 100, '2026-02-01', 1),
        movimentoDiretto('SCARICO', 200, '2026-02-02', 2),
      ],
    })
    // complessivo già -100
    expect(
      (await useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 10, '2026-02-11'))).isFailure
    ).toBe(true)
    await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 300, '2026-02-10'))
    // complessivo 200
    expect(
      (await useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 150, '2026-02-11'))).isSuccess
    ).toBe(true)
    // complessivo 50, ma prima del buco
    const r = await useCase.execute(cmd('SCARICO', 'AVVIO_RECUPERO', 10, '2026-02-01'))
    expect(r.isSuccess).toBe(true)
    expect(r.value.avvisi).toHaveLength(1)
  })

  describe('ricopia FIR idempotente', () => {
    let firId: string

    beforeAll(async () => {
      const user = await prisma.user.create({
        data: {
          tenantId,
          keycloakId: `keycloak-ricopia-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `ricopia-${Date.now()}@example.com`,
          role: 'OPERATOR',
        },
      })
      const repo = new FIRPrismaRepository(Object.assign(prisma, { db: prisma }) as any)
      const fir = FIR.create({
        produttoreId: '11111111-1111-4111-8111-111111111111',
        rifiuto: { cerCode: '999901', quantita: 100 },
        trasportatoreId: '22222222-2222-4222-8222-222222222222',
        destinatarioId: '33333333-3333-4333-8333-333333333333',
        tenantId,
        creatoDaUserId: user.id,
      })
      await repo.save(fir)
      firId = fir.id
      // FIR emesso: in attesa del trasportatore.
      await prisma.fIR.update({ where: { id: firId }, data: { status: 'AWAITING_CARRIER' } })
    })

    afterAll(async () => {
      await prisma.wasteMovement.deleteMany({ where: { tenantId } })
      await prisma.fIR.deleteMany({ where: { tenantId } })
      await prisma.user.deleteMany({ where: { tenantId } })
    })

    /** Movimento collegato al FIR scritto senza use case. */
    function ricopiaDiretta(n: number, firIdRicopia?: string) {
      return {
        ...movimentoDiretto('CARICO', 100, '2026-03-01', n),
        firId,
        firIdRicopia,
      }
    }

    it('la stessa ricopia ripetuta restituisce il movimento esistente', async () => {
      await useCase.execute(cmd('CARICO', 'INGRESSO_ESTERNO', 1.005, '2026-03-01', 'KG', firId))
      const a = await useCase.execute(
        cmd('CARICO', 'INGRESSO_ESTERNO', 1.005, '2026-03-01', 'KG', firId)
      )
      expect(a.value.giaRegistrato).toBe(true)
      expect(await prisma.wasteMovement.count({ where: { tenantId, firId } })).toBe(1)
    })

    it('due ricopie concorrenti dello stesso FIR producono un solo movimento', async () => {
      const [x, y] = await Promise.all([
        useCase.execute(cmd('CARICO', 'INGRESSO_ESTERNO', 100, '2026-03-01', 'KG', firId)),
        useCase.execute(cmd('CARICO', 'INGRESSO_ESTERNO', 100, '2026-03-01', 'KG', firId)),
      ])
      expect(x.isSuccess && y.isSuccess).toBe(true)
      expect(x.value.id).toBe(y.value.id)
      expect([x.value.giaRegistrato, y.value.giaRegistrato].sort()).toEqual([false, true])
    })

    it('il retry di uno scarico che ha consumato tutta la giacenza non è respinto', async () => {
      await useCase.execute(cmd('CARICO', 'PRODUZIONE_INTERNA', 100, '2026-03-01'))
      const primo = await useCase.execute(
        cmd('SCARICO', 'CONFERIMENTO_TRASPORTATORE', 100, '2026-03-02', 'KG', firId)
      )
      expect(primo.isSuccess).toBe(true)
      const retry = await useCase.execute(
        cmd('SCARICO', 'CONFERIMENTO_TRASPORTATORE', 100, '2026-03-02', 'KG', firId)
      )
      expect(retry.isSuccess).toBe(true)
      expect(retry.value).toMatchObject({ id: primo.value.id, giaRegistrato: true })
    })

    it('una seconda ricopia con dati diversi è rifiutata', async () => {
      const primo = await useCase.execute(
        cmd('CARICO', 'INGRESSO_ESTERNO', 100, '2026-03-01', 'KG', firId)
      )
      const r = await useCase.execute(
        cmd('CARICO', 'INGRESSO_ESTERNO', 90, '2026-03-01', 'KG', firId)
      )
      expect(r.error).toBe(
        new FirGiaRegistratoError(primo.value.progressiveNumber, primo.value.progressiveYear)
          .message
      )
      expect(await prisma.wasteMovement.count({ where: { tenantId, firId } })).toBe(1)
    })

    it("l'indice unico rifiuta un doppio scritto senza passare dallo use case", async () => {
      await prisma.wasteMovement.create({ data: ricopiaDiretta(1, firId) })
      const err = await prisma.wasteMovement
        .create({ data: ricopiaDiretta(2, firId) })
        .then(() => null)
        .catch(e => e)
      expect(err).toMatchObject({ code: 'P2002' })
      // Il target del P2002 nomina la colonna: la rete di sicurezza dello use case lo riconosce così.
      expect(JSON.stringify(err.meta?.target)).toMatch(/fir_?id_?ricopia/i)
    })

    it('i doppi storici (fir_id_ricopia NULL) restano ammessi', async () => {
      await prisma.wasteMovement.create({ data: ricopiaDiretta(1) })
      await prisma.wasteMovement.create({ data: ricopiaDiretta(2) })
      expect(await prisma.wasteMovement.count({ where: { tenantId, firId, type: 'CARICO' } })).toBe(
        2
      )
    })
  })
})
