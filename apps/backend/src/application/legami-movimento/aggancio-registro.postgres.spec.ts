/**
 * Aggancio del legame alla registrazione (fase 4.3, Task 20) contro un Postgres reale, collegato
 * COME `wasteflow_app` (RLS FORCE). Il movimento si registra SEMPRE: il legame nasce in un
 * SAVEPOINT e un suo errore non annulla la registrazione. Pulizia solo per id esatti.
 */
import { randomUUID } from 'crypto'
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
// Le barriere su pg_stat_activity guardano solo le connessioni del servizio di questo processo.
const NOME_APPLICAZIONE = `legami-t20-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  creaFirDiTest,
  creaMovimentoDiTest,
  creaScenarioProposta,
  pulisciTenantDiTest,
  type ScenarioProposta,
} from '../../test-support/legami-di-test'
import { RegistraMovimentoUseCase } from '../registro/use-cases/registra-movimento.use-case'
import { RegistraMovimentoCommand } from '../registro/commands/registra-movimento.command'
import { RegistriService } from '../registro/registri.service'
import { VerificaCatenaRegistroService } from '../registro/verifica-catena-registro.service'
import {
  AVVISO_LEGAME_INCOMPLETO,
  AVVISO_LEGAME_NON_RIUSCITO,
  agganciaLegameSenzaFallire,
  type DatiLegameRegistrazione,
} from './aggancio-registro'
import { LOCK_TIMEOUT_AGGANCIO } from './lock-legame'
import { PropostaLegameService } from './proposta-legame.service'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }
const ANNO = new Date().getUTCFullYear()

describe('Aggancio del legame alla registrazione — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let useCase: RegistraMovimentoUseCase
  let proposta: PropostaLegameService
  let verifica: VerificaCatenaRegistroService
  const tenantCreati: string[] = []
  let cerCreato = false

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    useCase = new RegistraMovimentoUseCase(
      app,
      loggerStub as never,
      new RegistriService(app, loggerStub as never)
    )
    proposta = new PropostaLegameService(app)
    verifica = new VerificaCatenaRegistroService(app)
    cerCreato = (await owner.cERCode.count({ where: { code: '20 03 01' } })) === 0
    await owner.cERCode.upsert({
      where: { code: '20 03 01' },
      create: { code: '20 03 01', description: 'CER di test', category: '20', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    // Gli abbinamenti citano i movimenti (FK): per primi, per id esatti.
    await owner.abbinamentoCaricoScarico.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await pulisciTenantDiTest(owner, tenantCreati)
    if (cerCreato) await owner.cERCode.deleteMany({ where: { code: '20 03 01' } })
    await app?.onModuleDestroy()
    await owner.$disconnect()
  }, 180_000)

  afterEach(() => jest.restoreAllMocks())

  // ---------------------------------------------------------------------------------------
  // Fixture
  // ---------------------------------------------------------------------------------------

  /** Scenario con cliente, contratto, elenco, riga CER (prezzo 1) e «fatturazione da» 2026-01-01. */
  async function scenario(
    o: { fatturazioneDa?: string | null; righeV?: number } = {}
  ): Promise<ScenarioProposta> {
    const s = await creaScenarioProposta(owner, {
      righeV: o.righeV ?? 0,
      onTenantCreato: id => tenantCreati.push(id),
    })
    if (o.fatturazioneDa !== null) {
      await owner.impostazioneFatturazione.create({
        data: {
          tenantId: s.tenantId,
          fatturazioneDa: new Date(`${o.fatturazioneDa ?? '2026-01-01'}T00:00:00Z`),
        },
      })
    }
    return s
  }

  /** FIR emesso, con o senza il produttore (e quindi il cliente) dello scenario. */
  async function nuovoFir(s: ScenarioProposta, conCliente = true): Promise<string> {
    const base = await owner.fIR.findUniqueOrThrow({ where: { id: s.firId } })
    const f = await creaFirDiTest(owner, s.tenantId, s.utenteId, {
      producerId: conCliente ? base.producerId : null,
      producerSedeId: conCliente ? base.producerSedeId : null,
    })
    await owner.fIR.update({ where: { id: f.id }, data: { status: 'AWAITING_CARRIER' } })
    return f.id
  }

  function comando(
    s: ScenarioProposta,
    o: {
      type?: 'CARICO' | 'SCARICO'
      causale?: string
      data?: string
      firId?: string
      quantita?: number
      operationCode?: string
      legame?: DatiLegameRegistrazione
    } = {}
  ): RegistraMovimentoCommand {
    return new RegistraMovimentoCommand(
      s.tenantId,
      s.utenteId,
      o.type ?? 'CARICO',
      new Date(`${o.data ?? '2026-03-10'}T10:00:00Z`),
      new Date(),
      o.causale ?? 'INGRESSO_ESTERNO',
      '20 03 01',
      undefined,
      o.quantita ?? 100,
      'KG',
      undefined,
      undefined,
      o.operationCode,
      undefined,
      undefined,
      o.firId,
      undefined,
      s.registroId,
      o.legame
    )
  }

  const registra = (s: ScenarioProposta, c: RegistraMovimentoCommand) =>
    nel(s.tenantId, () => useCase.execute(c))

  async function registraOk(s: ScenarioProposta, c: RegistraMovimentoCommand) {
    const r = await registra(s, c)
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
    return r.value
  }

  const legamiDi = (s: ScenarioProposta) =>
    owner.legameMovimento.findMany({
      where: { tenantId: s.tenantId },
      include: { righe: { orderBy: { ordine: 'asc' } } },
    })

  /** I movimenti registrati dal caso d'uso (il movimento di partenza dello scenario escluso). */
  const movimentiNuovi = (s: ScenarioProposta) =>
    owner.wasteMovement.findMany({
      where: { tenantId: s.tenantId, id: { not: s.movimentoId } },
      orderBy: { progressiveNumber: 'asc' },
    })

  const auditDi = (s: ScenarioProposta, azione: string) =>
    owner.activityLog.findMany({ where: { tenantId: s.tenantId, action: azione } })

  async function inAttesaDiLock(): Promise<number> {
    const r = await owner.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
        AND wait_event_type = 'Lock'`
    return r[0].n
  }

  /** Attende, con il poll della vista (mai sleep come sincronizzazione), `n` sessioni su un lock. */
  async function attendiLock(n: number, finita: () => boolean = () => false): Promise<void> {
    const scadenza = Date.now() + 30_000
    for (;;) {
      if ((await inAttesaDiLock()) >= n) return
      if (finita()) throw new Error('la registrazione e` finita senza attendere il lock')
      if (Date.now() > scadenza) throw new Error(`nessuna sessione in attesa di lock (attese ${n})`)
      await new Promise(r => setTimeout(r, 20))
    }
  }

  /** Transazione del proprietario che esegue `prendi` e tiene i lock finche' non si chiama `rilascia`. */
  function tenitore(prendi: (tx: PrismaClient) => Promise<unknown>) {
    let rilascia!: () => void
    const barriera = new Promise<void>(r => (rilascia = r))
    let segnala!: () => void
    const pronta = new Promise<void>(r => (segnala = r))
    const fine = owner.$transaction(
      async tx => {
        await prendi(tx as unknown as PrismaClient)
        segnala()
        await barriera
      },
      { timeout: 120_000, maxWait: 30_000 }
    )
    fine.catch(() => segnala())
    return { pronta, rilascia, fine }
  }

  const completo = (o: Partial<DatiLegameRegistrazione> = {}): DatiLegameRegistrazione => ({
    azione: 'CONFERMA',
    ...o,
  })

  // ---------------------------------------------------------------------------------------
  // Percorso normale
  // ---------------------------------------------------------------------------------------

  it('azione PROPOSTA con dati completi: movimento e legame PROPOSTO nella stessa transazione', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    const m = await registraOk(s, comando(s, { firId: fir, legame: { azione: 'PROPOSTA' } }))
    expect(m.fatturazione).toMatchObject({ esito: 'COLLEGATO', stato: 'PROPOSTO', motivi: [] })
    const [l] = await legamiDi(s)
    expect(l).toMatchObject({
      id: m.fatturazione!.legameId,
      movimentoOriginaleId: m.id,
      movimentoVigenteId: m.id,
      stato: 'PROPOSTO',
      clienteId: s.clienteId,
      contrattoId: s.contrattoId,
      elencoId: s.elencoId,
      confermatoIl: null,
      versione: 1,
    })
    expect(l.righe).toHaveLength(1)
    expect(l.righe[0]).toMatchObject({ congelataIl: null, quantitaOrigine: 'DA_MOVIMENTO' })
    expect(l.righe[0].quantita?.toString()).toBe('100')
  })

  it('azione CONFERMA con dati completi: legame CONFERMATO, righe congelate, audit', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    const m = await registraOk(s, comando(s, { firId: fir, legame: completo() }))
    expect(m.fatturazione).toMatchObject({ esito: 'COLLEGATO', stato: 'CONFERMATO' })
    expect(m.avvisi).toEqual([])
    const [l] = await legamiDi(s)
    expect(l.stato).toBe('CONFERMATO')
    expect(l.confermatoIl).not.toBeNull()
    expect(l.confermatoDa).toBe(s.utenteId)
    expect(l.righe.every(r => r.congelataIl !== null)).toBe(true)
    expect(await auditDi(s, 'LEGAME_MOVIMENTO_CONFERMATO')).toHaveLength(1)
  })

  it('senza blocco legame: proposta calcolata e salvata, mai confermata', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    const m = await registraOk(s, comando(s, { firId: fir }))
    expect(m.fatturazione).toMatchObject({ esito: 'COLLEGATO', stato: 'PROPOSTO' })
    const [l] = await legamiDi(s)
    expect(l.stato).toBe('PROPOSTO')
    expect(l.confermatoIl).toBeNull()
  })

  it('CONFERMA con dati incompleti (FIR senza cliente): movimento registrato, DA_COLLEGARE, avviso', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s, false)
    const m = await registraOk(s, comando(s, { firId: fir, legame: completo() }))
    expect(m.progressiveNumber).toBeGreaterThan(0)
    expect(m.fatturazione).toMatchObject({
      esito: 'COLLEGATO',
      stato: 'DA_COLLEGARE',
      motivi: ['SENZA_CLIENTE'],
    })
    expect(m.avvisi).toContain(AVVISO_LEGAME_INCOMPLETO)
    const [l] = await legamiDi(s)
    expect(l).toMatchObject({ stato: 'DA_COLLEGARE', confermatoIl: null })
  })

  it('contratto scelto SOSPESO: DA_COLLEGARE con CONTRATTO_NON_ATTIVO, nessuna eccezione', async () => {
    const s = await scenario()
    await owner.contrattoCliente.update({
      where: { id: s.contrattoId },
      data: { stato: 'SOSPESO' },
    })
    const fir = await nuovoFir(s)
    const m = await registraOk(
      s,
      comando(s, { firId: fir, legame: completo({ contrattoId: s.contrattoId }) })
    )
    expect(m.fatturazione?.stato).toBe('DA_COLLEGARE')
    expect(m.fatturazione?.motivi).toContain('CONTRATTO_NON_ATTIVO')
    expect(m.avvisi).toContain(AVVISO_LEGAME_INCOMPLETO)
  })

  it('quantita, prezzo e sconto scritti a mano: riga MANUALE, prezzo manuale con avviso, righe congelate', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    const m = await registraOk(
      s,
      comando(s, {
        firId: fir,
        legame: completo({
          righe: [{ rigaAddebitoId: s.rigaCerId, quantita: '2.5', prezzo: '12.5', sconto: '10' }],
        }),
      })
    )
    expect(m.fatturazione).toMatchObject({ stato: 'CONFERMATO', avvisi: ['PREZZO_MANUALE'] })
    const [l] = await legamiDi(s)
    expect(l.avvisi).toEqual(['PREZZO_MANUALE'])
    expect(l.righe[0]).toMatchObject({
      quantitaOrigine: 'MANUALE',
      prezzoManuale: true,
      sconto: '10',
    })
    expect(l.righe[0].quantita?.toString()).toBe('2.5')
    expect(l.righe[0].prezzo?.toString()).toBe('12.5')
    expect(l.righe[0].congelataIl).not.toBeNull()
  })

  it('quantita manuale non valida (0): 400 prima di scrivere, nessun movimento', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    const r = await registra(
      s,
      comando(s, {
        firId: fir,
        legame: completo({ righe: [{ rigaAddebitoId: s.rigaCerId, quantita: '0' }] }),
      })
    )
    expect(r.isFailure).toBe(true)
    expect(await movimentiNuovi(s)).toHaveLength(0)
    expect(await legamiDi(s)).toHaveLength(0)
  })

  it('riga non fra quelle proposte: la registrazione resta, il legame no, con avviso', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    const m = await registraOk(
      s,
      comando(s, {
        firId: fir,
        legame: completo({ righe: [{ rigaAddebitoId: randomUUID(), quantita: '1' }] }),
      })
    )
    expect(m.fatturazione?.esito).toBe('NON_RIUSCITO')
    expect(m.avvisi).toContain(AVVISO_LEGAME_NON_RIUSCITO)
    expect(await legamiDi(s)).toHaveLength(0)
  })

  it('quantita passata come quantity.toFixed() (M9)', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    const spia = jest.spyOn(PropostaLegameService.prototype, 'proponiEScrivi')
    await registraOk(s, comando(s, { firId: fir, quantita: 100.5 }))
    expect(spia).toHaveBeenCalledTimes(1)
    expect(spia.mock.calls[0][1].input.quantity).toBe('100.5')
    expect(typeof spia.mock.calls[0][1].input.quantity).toBe('string')
  })

  // ---------------------------------------------------------------------------------------
  // Nessun legame
  // ---------------------------------------------------------------------------------------

  it('causale non fatturabile: nessun legame e nessun blocco Fatturazione', async () => {
    const s = await scenario()
    const spia = jest.spyOn(PropostaLegameService.prototype, 'proponiEScrivi')
    const m = await registraOk(s, comando(s, { causale: 'PRODUZIONE_INTERNA', legame: completo() }))
    expect(m.fatturazione).toBeUndefined()
    expect(spia).not.toHaveBeenCalled()
    expect(await legamiDi(s)).toHaveLength(0)
  })

  it('data prima di «fatturazione da»: nessun legame', async () => {
    const s = await scenario({ fatturazioneDa: '2026-06-01' })
    const fir = await nuovoFir(s)
    const m = await registraOk(s, comando(s, { firId: fir, data: '2026-03-10' }))
    expect(m.fatturazione).toBeUndefined()
    expect(await legamiDi(s)).toHaveLength(0)
    // Lo stesso giorno di «fatturazione da» entra.
    const fir2 = await nuovoFir(s)
    const m2 = await registraOk(s, comando(s, { firId: fir2, data: '2026-06-01' }))
    expect(m2.fatturazione?.esito).toBe('COLLEGATO')
  })

  it('fatturazione spenta: nessun legame', async () => {
    const s = await scenario({ fatturazioneDa: null })
    const fir = await nuovoFir(s)
    const m = await registraOk(s, comando(s, { firId: fir, legame: completo() }))
    expect(m.fatturazione).toBeUndefined()
    expect(await legamiDi(s)).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------------------
  // Un errore nel legame non annulla la registrazione
  // ---------------------------------------------------------------------------------------

  it('errore SQL dentro il savepoint: movimento registrato (hash e progressivo corretti), nessun legame, transazione viva, audit', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    jest
      .spyOn(PropostaLegameService.prototype, 'proponiEScrivi')
      .mockImplementationOnce(async tx => {
        await tx.$executeRaw`SELECT 1/0`
        throw new Error('irraggiungibile')
      })
    const m = await registraOk(s, comando(s, { firId: fir, legame: completo() }))
    expect(m.fatturazione).toMatchObject({ esito: 'NON_RIUSCITO', legameId: null })
    expect(m.avvisi).toContain(AVVISO_LEGAME_NON_RIUSCITO)
    expect(await legamiDi(s)).toHaveLength(0)
    expect(m.progressiveNumber).toBe(2) // il 1 è il movimento di partenza dello scenario
    // L'audit si e` scritto dopo l'errore SQL: la transazione non era in abort.
    const audit = await auditDi(s, 'LEGAME_NON_RIUSCITO')
    expect(audit).toHaveLength(1)
    expect(audit[0].metadata).toMatchObject({ tipoErrore: expect.any(String), codice: '22012' })
    expect(JSON.stringify(audit[0].metadata)).not.toMatch(/division/i)
    // La catena continua: un secondo movimento si concatena e la verifica dell'anno e` integra.
    const fir2 = await nuovoFir(s)
    const m2 = await registraOk(s, comando(s, { firId: fir2 }))
    expect(m2.progressiveNumber).toBe(3)
    const esito = await nel(s.tenantId, () => verifica.verifica(s.tenantId, s.registroId, ANNO))
    expect(esito.primoErrore).toBeNull()
    expect(esito.verificate).toBeGreaterThanOrEqual(2)
  })

  it("lock del listino tenuto da un'altra sessione: attesa al massimo 2 s, poi il movimento resta e il legame manca", async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    const blocco = tenitore(async tx => {
      await tx.$queryRaw`SELECT id FROM righe_addebito WHERE id = ${s.rigaCerId}::uuid FOR UPDATE`
    })
    await blocco.pronta
    try {
      let finita = false
      const inCorso = registra(s, comando(s, { firId: fir, legame: completo() })).finally(
        () => (finita = true)
      )
      await attendiLock(1, () => finita)
      const t0 = Date.now()
      const r = await inCorso
      expect(Date.now() - t0).toBeLessThan(8000)
      expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
      expect(r.value.fatturazione).toMatchObject({ esito: 'NON_RIUSCITO' })
      expect(r.value.avvisi).toContain(AVVISO_LEGAME_NON_RIUSCITO)
      expect(await legamiDi(s)).toHaveLength(0)
      expect((await movimentiNuovi(s)).map(x => x.id)).toEqual([r.value.id])
      const audit = await auditDi(s, 'LEGAME_NON_RIUSCITO')
      expect((audit[0].metadata as { codice: string }).codice).toMatch(/^(55P03|P2010|P2028)$/)
    } finally {
      blocco.rilascia()
      await blocco.fine
    }
  }, 60_000)

  it('registrazione parallela a una modifica del listino: attende il lock e legge il prezzo nuovo', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    const blocco = tenitore(async tx => {
      await tx.$executeRaw`UPDATE righe_addebito SET prezzo = 7 WHERE id = ${s.rigaCerId}::uuid`
      // Il listino reale scrive anche i prezzi storici: qui basta il valore corrente della riga.
    })
    await blocco.pronta
    let finita = false
    const inCorso = registra(s, comando(s, { firId: fir, legame: completo() })).finally(
      () => (finita = true)
    )
    await attendiLock(1, () => finita)
    blocco.rilascia()
    await blocco.fine
    const r = await inCorso
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
    expect(r.value.fatturazione?.stato).toBe('CONFERMATO')
    const [l] = await legamiDi(s)
    expect(l.righe[0].prezzo?.toString()).toBe('7')
  }, 60_000)

  it('il lock_timeout si ripristina dopo il legame, a buon fine e in errore', async () => {
    const s = await scenario()
    const dati = async (movimentoId: string, firId: string, legame?: DatiLegameRegistrazione) => ({
      tenantId: s.tenantId,
      userId: s.utenteId,
      registroId: s.registroId,
      type: 'CARICO' as const,
      movimentoId,
      fatturabile: true,
      causale: 'INGRESSO_ESTERNO',
      causaleAziendaId: null,
      cerCode: '20 03 01',
      movementDate: new Date('2026-03-10T10:00:00Z'),
      unit: 'KG',
      quantity: '100',
      firId,
      legame,
      proposta,
    })
    const timeoutDopo = async (
      movimentoId: string,
      firId: string,
      prepara?: () => void
    ): Promise<{ prima: string; dopo: string; esito: string | undefined }> =>
      nel(s.tenantId, () =>
        app.$transaction(async tx => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '7s'`)
          const prima = (
            await tx.$queryRaw<{ v: string }[]>`SELECT current_setting('lock_timeout') AS v`
          )[0].v
          prepara?.()
          const e = await agganciaLegameSenzaFallire(tx, await dati(movimentoId, firId))
          const dopo = (
            await tx.$queryRaw<{ v: string }[]>`SELECT current_setting('lock_timeout') AS v`
          )[0].v
          return { prima, dopo, esito: e.fatturazione?.esito }
        })
      )
    const fir = await nuovoFir(s)
    const m1 = await creaMovimentoDiTest(owner, s.tenantId, { firId: fir })
    const bene = await timeoutDopo(m1.movimentoId, fir)
    expect(bene).toEqual({ prima: '7s', dopo: '7s', esito: 'COLLEGATO' })
    expect(LOCK_TIMEOUT_AGGANCIO).toBe('2s')

    const fir2 = await nuovoFir(s)
    const m2 = await creaMovimentoDiTest(owner, s.tenantId, { firId: fir2 })
    const male = await timeoutDopo(m2.movimentoId, fir2, () =>
      jest
        .spyOn(PropostaLegameService.prototype, 'proponiEScrivi')
        .mockImplementationOnce(async tx => {
          // Dentro il savepoint il tetto e` quello dell'aggancio.
          const v = (
            await tx.$queryRaw<{ v: string }[]>`SELECT current_setting('lock_timeout') AS v`
          )[0].v
          expect(v).toBe('2s')
          await tx.$executeRaw`SELECT 1/0`
          return undefined as never
        })
    )
    expect(male).toEqual({ prima: '7s', dopo: '7s', esito: 'NON_RIUSCITO' })
  })

  // ---------------------------------------------------------------------------------------
  // Retry e concorrenza
  // ---------------------------------------------------------------------------------------

  it('ricopia del FIR registrata due volte (retry): giaRegistrato, un solo movimento, un solo legame', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    const primo = await registraOk(s, comando(s, { firId: fir, legame: completo() }))
    const secondo = await registraOk(s, comando(s, { firId: fir, legame: completo() }))
    expect(primo.giaRegistrato).toBe(false)
    expect(secondo.giaRegistrato).toBe(true)
    expect(secondo.id).toBe(primo.id)
    expect(secondo.fatturazione).toBeUndefined()
    expect(await movimentiNuovi(s)).toHaveLength(1)
    expect(await legamiDi(s)).toHaveLength(1)
  })

  it('due richieste parallele sulla stessa ricopia (barriera sul lock del FIR): un solo movimento e un solo legame', async () => {
    const s = await scenario()
    const fir = await nuovoFir(s)
    const chiave = `fir-registro|${s.tenantId}|${fir}`
    const blocco = tenitore(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
    })
    await blocco.pronta
    let finite = 0
    const una = () =>
      registra(s, comando(s, { firId: fir, legame: completo() })).finally(() => finite++)
    const richieste = [una(), una()]
    // Le due richieste sono entrambe ferme sul lock del FIR, nello stesso istante.
    await attendiLock(2, () => finite > 0)
    blocco.rilascia()
    await blocco.fine
    const esiti = await Promise.all(richieste)
    expect(esiti.every(e => e.isSuccess)).toBe(true)
    expect(esiti.map(e => e.value.giaRegistrato).sort()).toEqual([false, true])
    expect(new Set(esiti.map(e => e.value.id)).size).toBe(1)
    expect(await movimentiNuovi(s)).toHaveLength(1)
    expect(await legamiDi(s)).toHaveLength(1)
  }, 60_000)

  it('due registrazioni in parallelo (stesso registro, CER e cliente): progressivi distinti, due legami, nessun deadlock', async () => {
    const s = await scenario()
    const firA = await nuovoFir(s)
    const firB = await nuovoFir(s)
    const [a, b] = await Promise.all([
      registra(s, comando(s, { firId: firA, legame: completo() })),
      registra(s, comando(s, { firId: firB, legame: completo() })),
    ])
    expect(a.isSuccess ? 'ok' : a.error).toBe('ok')
    expect(b.isSuccess ? 'ok' : b.error).toBe('ok')
    expect(a.value.fatturazione?.esito).toBe('COLLEGATO')
    expect(b.value.fatturazione?.esito).toBe('COLLEGATO')
    expect(new Set([a.value.progressiveNumber, b.value.progressiveNumber]).size).toBe(2)
    const legami = await legamiDi(s)
    expect(legami).toHaveLength(2)
    expect(new Set(legami.map(l => l.id)).size).toBe(2)
    expect(await auditDi(s, 'LEGAME_NON_RIUSCITO')).toHaveLength(0)
  }, 60_000)

  it('scarico con abbinamento FIFO e legame insieme: i due savepoint non interferiscono', async () => {
    const s = await scenario()
    // Causale propria di scarico fatturabile (di sistema nessuno scarico lo e`).
    await owner.$executeRawUnsafe(
      `INSERT INTO causali_registro_azienda
         (tenant_id, natura, codice, verso, descrizione, ruolo_mud, valida_dal, creato_da, fatturabile, updated_at)
       VALUES ($1::uuid, 'PROPRIA', 'AZ_SCARICO_FATT', 'SCARICO'::waste_movement_type, 'Scarico fatturabile',
               'ESCLUSO'::ruolo_mud_causale, '2026-01-01'::date, $2::uuid, true, now())`,
      s.tenantId,
      randomUUID()
    )
    await registraOk(
      s,
      comando(s, {
        causale: 'PRODUZIONE_INTERNA',
        data: '2026-03-01',
        operationCode: 'R13',
        quantita: 500,
      })
    )
    const fir = await nuovoFir(s)
    const m = await registraOk(
      s,
      comando(s, {
        type: 'SCARICO',
        causale: 'AZ_SCARICO_FATT',
        data: '2026-03-10',
        firId: fir,
        quantita: 100,
        legame: completo(),
      })
    )
    expect(m.fatturazione).toMatchObject({ esito: 'COLLEGATO', stato: 'CONFERMATO' })
    const abbinamenti = await owner.abbinamentoCaricoScarico.count({
      where: { tenantId: s.tenantId },
    })
    expect(abbinamenti).toBeGreaterThan(0)
    expect(await legamiDi(s)).toHaveLength(1)
    expect(await auditDi(s, 'LEGAME_NON_RIUSCITO')).toHaveLength(0)
    expect(await auditDi(s, 'ABBINAMENTO_NON_RIUSCITO')).toHaveLength(0)
  }, 60_000)
})
