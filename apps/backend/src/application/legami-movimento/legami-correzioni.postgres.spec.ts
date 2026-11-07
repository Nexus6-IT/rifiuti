/**
 * Il legame segue rettifiche e annulli del movimento (fase 4.3b, Task 21, spec §7.5) contro un
 * Postgres reale, collegato COME `wasteflow_app` (RLS FORCE). La correzione del registro riesce
 * SEMPRE: il legame si riallinea in un SAVEPOINT con un tetto di attesa e un budget di tempo.
 * Pulizia solo per id esatti.
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
// Le barriere su pg_stat_activity guardano solo le connessioni del servizio di questo processo.
const NOME_APPLICAZIONE = `legami-t21-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { ConflictException } from '@nestjs/common'
import { TenantContext } from '../../core/context/tenant-context'
import * as giacenza from '../registro/giacenza-disponibile'
import * as segnalazione from '../../core/monitoring/segnala-errore-job'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaContrattoConElenco, creaRiga } from '../../test-support/listino-di-test'
import { annoSolareItaliano } from '../../core/time/anno-italiano'
import { randomUUID } from 'crypto'
import {
  creaDocumentoMinimoPerLegame,
  creaFirDiTest,
  creaScenarioProposta,
  pulisciTenantDiTest,
  type ScenarioProposta,
} from '../../test-support/legami-di-test'
import {
  MOTIVO_ESCLUSIONE_CAUSALE,
  MOTIVO_ESCLUSIONE_DATA,
  AVVISO_SCOSTAMENTO,
} from '../../domain/legami-movimento/codici'
import { RegistraMovimentoUseCase } from '../registro/use-cases/registra-movimento.use-case'
import {
  CorreggiMovimentoUseCase,
  type DatiRettifica,
} from '../registro/use-cases/correggi-movimento.use-case'
import { RegistraMovimentoCommand } from '../registro/commands/registra-movimento.command'
import { RegistriService } from '../registro/registri.service'
import { VerificaCatenaRegistroService } from '../registro/verifica-catena-registro.service'
import { type DatiLegameRegistrazione } from './aggancio-registro'
import {
  AVVISO_LEGAME_CONFERMA_NON_POSSIBILE,
  AVVISO_LEGAME_CORREZIONE_NON_RIUSCITO,
  AVVISO_LEGAME_DA_RIALLINEARE,
  AVVISO_LEGAME_SCELTE_NON_APPLICATE,
} from './legami-correzioni'
import { joinLineari } from '../listino/lock-listino'
import { LegamiService } from './conferma-legame.service'
import { ListaLegamiService } from './lista-legami.service'
import { PropostaLegameService } from './proposta-legame.service'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }
const ANNO = new Date().getUTCFullYear()
const CER_B = '15 01 01'

describe('Il legame segue la correzione del movimento — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let registra: RegistraMovimentoUseCase
  let correggi: CorreggiMovimentoUseCase
  let legami: LegamiService
  let lista: ListaLegamiService
  let verifica: VerificaCatenaRegistroService
  const tenantCreati: string[] = []
  const cerCreati: string[] = []

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    registra = new RegistraMovimentoUseCase(
      app,
      loggerStub as never,
      new RegistriService(app, loggerStub as never)
    )
    correggi = new CorreggiMovimentoUseCase(app, loggerStub as never)
    legami = new LegamiService(app, new PropostaLegameService(app))
    lista = new ListaLegamiService(app)
    verifica = new VerificaCatenaRegistroService(app)
    for (const code of ['20 03 01', CER_B]) {
      if ((await owner.cERCode.count({ where: { code } })) === 0) cerCreati.push(code)
      await owner.cERCode.upsert({
        where: { code },
        create: { code, description: 'CER di test', category: code.slice(0, 2), subcategory: '' },
        update: {},
      })
    }
  })

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    if (cerCreati.length) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await app?.onModuleDestroy()
    await owner.$disconnect()
  }, 180_000)

  afterEach(() => jest.restoreAllMocks())

  // ---------------------------------------------------------------------------------------
  // Fixture
  // ---------------------------------------------------------------------------------------

  async function scenario(
    o: { fatturazioneDa?: string | null; righeV?: number } = {}
  ): Promise<ScenarioProposta> {
    const s = await creaScenarioProposta(owner, {
      righeV: o.righeV ?? 0,
      onTenantCreato: id => tenantCreati.push(id),
    })
    // Seconda riga CER dell'elenco: serve alla rettifica che cambia il CER.
    await creaRiga(owner, s.tenantId, s.elencoId, {
      tipo: 'CER',
      cerCode: CER_B,
      codiceIvaId: s.ivaId,
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

  async function nuovoFir(s: ScenarioProposta): Promise<string> {
    const base = await owner.fIR.findUniqueOrThrow({ where: { id: s.firId } })
    const f = await creaFirDiTest(owner, s.tenantId, s.utenteId, {
      producerId: base.producerId,
      producerSedeId: base.producerSedeId,
    })
    await owner.fIR.update({ where: { id: f.id }, data: { status: 'AWAITING_CARRIER' } })
    return f.id
  }

  async function registraMovimento(
    s: ScenarioProposta,
    o: {
      causale?: string
      data?: string
      quantita?: number
      cer?: string
      legame?: DatiLegameRegistrazione | null
      senzaFir?: boolean
    } = {}
  ) {
    const firId = o.senzaFir ? undefined : await nuovoFir(s)
    const r = await nel(s.tenantId, () =>
      registra.execute(
        new RegistraMovimentoCommand(
          s.tenantId,
          s.utenteId,
          'CARICO',
          new Date(`${o.data ?? '2026-03-10'}T10:00:00Z`),
          new Date(),
          o.causale ?? 'INGRESSO_ESTERNO',
          o.cer ?? '20 03 01',
          undefined,
          o.quantita ?? 100,
          'KG',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          firId,
          undefined,
          s.registroId,
          o.legame === null ? undefined : (o.legame ?? { azione: 'CONFERMA' })
        )
      )
    )
    expect(r.isSuccess ? 'ok' : r.error).toBe('ok')
    return r.value
  }

  const datiRettifica = (over: Partial<DatiRettifica> = {}): DatiRettifica => ({
    movementDate: new Date('2026-03-10T10:00:00Z'),
    causale: 'INGRESSO_ESTERNO',
    cerCode: '20 03 01',
    quantity: 100,
    unit: 'KG',
    ...over,
  })

  const rettifica = (
    s: ScenarioProposta,
    movimentoId: string,
    over: Partial<DatiRettifica> = {},
    legame?: DatiLegameRegistrazione
  ) =>
    nel(s.tenantId, () =>
      correggi.rettifica({
        tenantId: s.tenantId,
        userId: s.utenteId,
        movimentoId,
        motivo: 'errore di battitura',
        dati: datiRettifica(over),
        legame,
      })
    )

  const annulla = (s: ScenarioProposta, movimentoId: string) =>
    nel(s.tenantId, () =>
      correggi.annulla({
        tenantId: s.tenantId,
        userId: s.utenteId,
        movimentoId,
        motivo: 'inserito per errore',
      })
    )

  const legameDi = (radiceId: string) =>
    owner.legameMovimento.findFirst({
      where: { movimentoOriginaleId: radiceId },
      include: { righe: { orderBy: { ordine: 'asc' } } },
    })

  const legamiDi = (s: ScenarioProposta) =>
    owner.legameMovimento.findMany({ where: { tenantId: s.tenantId } })

  const auditDi = (s: ScenarioProposta, azione: string) =>
    owner.activityLog.findMany({ where: { tenantId: s.tenantId, action: azione } })

  const dataIso = (d: Date) => d.toISOString().slice(0, 10)

  async function inAttesaDiLock(): Promise<number> {
    const r = await owner.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
        AND wait_event_type = 'Lock'`
    return r[0].n
  }

  /** Attende, con il poll della vista (mai sleep come sincronizzazione), `n` sessioni su un lock. */
  async function attendiLock(n: number): Promise<void> {
    const scadenza = Date.now() + 30_000
    for (;;) {
      if ((await inAttesaDiLock()) >= n) return
      if (Date.now() > scadenza) throw new Error(`nessuna sessione in attesa di lock (attese ${n})`)
      await new Promise(r => setTimeout(r, 15))
    }
  }

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

  async function portaAFatturato(legameId: string, stato: 'FATTURATO' | 'IMPORTATO_FATTURATO') {
    // 4.4a: FATTURATO vuole il documento (CHECK `legami_movimento_documento_se_fatturato`).
    let documentoId: string | null = null
    if (stato === 'FATTURATO') {
      const l = await owner.legameMovimento.findUniqueOrThrow({ where: { id: legameId } })
      documentoId = await creaDocumentoMinimoPerLegame(owner, l.tenantId, {
        clienteId: l.clienteId as string,
        contrattoId: l.contrattoId as string,
        elencoId: l.elencoId,
      })
    }
    await owner.legameMovimento.update({
      where: { id: legameId },
      data: { stato, fatturatoIl: new Date(), riferimentoFattura: 'F-1', documentoId },
    })
  }

  // ---------------------------------------------------------------------------------------
  // Tabella §7.5
  // ---------------------------------------------------------------------------------------

  it('rettifica di quantità, stesso CER, CONFERMATO: vigente nuovo, quantità DA_MOVIMENTO ricalcolata, prezzo congelato e stato invariati', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    const prima = (await legameDi(m.id))!
    expect(prima.stato).toBe('CONFERMATO')
    const r = await rettifica(s, m.id, { quantity: 90 })
    const l = (await legameDi(m.id))!
    expect(l.movimentoVigenteId).toBe(r.movimento.id)
    expect(l.stato).toBe('CONFERMATO')
    expect(l.confermatoIl).toEqual(prima.confermatoIl)
    expect(l.righe).toHaveLength(1)
    expect(l.righe[0].quantita?.toFixed()).toBe('90')
    expect(l.righe[0].prezzo?.toFixed()).toBe(prima.righe[0].prezzo?.toFixed())
    expect(l.righe[0].congelataIl).toEqual(prima.righe[0].congelataIl)
    expect(r.avvisi).toEqual([])
    expect(r.fatturazione).toEqual({
      esito: 'COLLEGATO',
      legameId: prima.id,
      stato: 'CONFERMATO',
      motivi: [],
      avvisi: [],
    })
    expect(await legamiDi(s)).toHaveLength(1)
  })

  it('rettifica di quantità su un PROPOSTO: resta PROPOSTO, data e vigente allineati', async () => {
    const s = await scenario()
    const m = await registraMovimento(s, { legame: { azione: 'PROPOSTA' } })
    const r = await rettifica(s, m.id, {
      quantity: 80,
      movementDate: new Date('2026-03-12T10:00:00Z'),
    })
    const l = (await legameDi(m.id))!
    expect(l).toMatchObject({ stato: 'PROPOSTO', movimentoVigenteId: r.movimento.id })
    expect(dataIso(l.dataMovimento)).toBe('2026-03-12')
    expect(l.righe[0].quantita?.toFixed()).toBe('80')
  })

  it("la vista del legame porta documentoId: null se non fatturato, l'id del documento se FATTURATO", async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    const l0 = (await legameDi(m.id))!
    expect((await legami.dettaglio(s.tenantId, l0.id)).documentoId).toBeNull()
    expect((await legami.perMovimento(s.tenantId, m.id)).documentoId).toBeNull()
    await portaAFatturato(l0.id, 'FATTURATO')
    const documentoId = (await owner.legameMovimento.findUniqueOrThrow({ where: { id: l0.id } }))
      .documentoId
    expect(documentoId).not.toBeNull()
    expect((await legami.dettaglio(s.tenantId, l0.id)).documentoId).toBe(documentoId)
    expect((await legami.perMovimento(s.tenantId, m.id)).documentoId).toBe(documentoId)
  })

  it('quantità MANUALE resta e compare QUANTITA_MANUALE_NON_DERIVATA', async () => {
    const s = await scenario()
    const m = await registraMovimento(s, { legame: { azione: 'PROPOSTA' } })
    const l0 = (await legameDi(m.id))!
    await legami.modifica(s.tenantId, s.utenteId, l0.id, l0.versione, {
      righe: [{ rigaAddebitoId: s.rigaCerId, quantita: '55' }],
    })
    await rettifica(s, m.id, { quantity: 90 })
    const l = (await legameDi(m.id))!
    expect(l.avvisi).toContain('QUANTITA_MANUALE_NON_DERIVATA')
    expect(l.righe[0].quantita?.toFixed()).toBe('55')
    expect(l.righe[0].quantitaOrigine).toBe('MANUALE')
  })

  it('rettifica che cambia il CER: da CONFERMATO torna PROPOSTO con CAMBIO_CER_DA_CONFERMARE', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    const r = await rettifica(s, m.id, { cerCode: CER_B })
    const l = (await legameDi(m.id))!
    expect(l).toMatchObject({ stato: 'PROPOSTO', movimentoVigenteId: r.movimento.id })
    expect(l.avvisi).toContain('CAMBIO_CER_DA_CONFERMARE')
    expect(l.confermatoIl).toBeNull()
    expect(l.righe).toHaveLength(1)
  })

  it('causale che diventa non fatturabile: ESCLUSO col testo fisso, righe conservate', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    const r = await rettifica(s, m.id, { causale: 'PRODUZIONE_INTERNA' })
    const l = (await legameDi(m.id))!
    expect(l).toMatchObject({
      stato: 'ESCLUSO',
      motivoEsclusione: MOTIVO_ESCLUSIONE_CAUSALE,
      movimentoVigenteId: r.movimento.id,
    })
    expect(l.righe).toHaveLength(1)
  })

  it('da non fatturabile a fatturabile: il legame nasce sulla radice, con la nuova testa come vigente', async () => {
    const s = await scenario()
    const m = await registraMovimento(s, { causale: 'PRODUZIONE_INTERNA', legame: null })
    expect(await legamiDi(s)).toHaveLength(0)
    const r = await rettifica(s, m.id, { causale: 'INGRESSO_ESTERNO' }, { azione: 'PROPOSTA' })
    const legamiS = await legamiDi(s)
    expect(legamiS).toHaveLength(1)
    expect(legamiS[0]).toMatchObject({
      movimentoOriginaleId: m.id,
      movimentoVigenteId: r.movimento.id,
      stato: 'PROPOSTO',
    })
    expect(r.avvisi).toEqual([])
    expect(r.fatturazione).toMatchObject({
      esito: 'COLLEGATO',
      legameId: legamiS[0].id,
      stato: 'PROPOSTO',
    })
  })

  it('il blocco legame della rettifica con azione CONFERMA fa nascere un legame CONFERMATO', async () => {
    const s = await scenario()
    const m = await registraMovimento(s, { causale: 'PRODUZIONE_INTERNA', legame: null })
    await rettifica(s, m.id, { causale: 'INGRESSO_ESTERNO' }, { azione: 'CONFERMA' })
    expect((await legameDi(m.id))!.stato).toBe('CONFERMATO')
  })

  it('ESCLUSO a mano con la causale che torna fatturabile: resta ESCLUSO (I2)', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    const l0 = (await legameDi(m.id))!
    await legami.escludi(s.tenantId, s.utenteId, l0.id, l0.versione, 'cliente non fatturabile')
    const r1 = await rettifica(s, m.id, { causale: 'PRODUZIONE_INTERNA' })
    const r2 = await rettifica(s, r1.movimento.id, { causale: 'INGRESSO_ESTERNO' })
    const l = (await legameDi(m.id))!
    expect(l).toMatchObject({
      stato: 'ESCLUSO',
      motivoEsclusione: 'cliente non fatturabile',
      movimentoVigenteId: r2.movimento.id,
    })
  })

  it('ESCLUSO col testo fisso con la causale che torna fatturabile: riammesso', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    const r1 = await rettifica(s, m.id, { causale: 'PRODUZIONE_INTERNA' })
    expect((await legameDi(m.id))!.stato).toBe('ESCLUSO')
    const r2 = await rettifica(s, r1.movimento.id, { causale: 'INGRESSO_ESTERNO' })
    const l = (await legameDi(m.id))!
    expect(l.stato).toBe('PROPOSTO')
    expect(l.motivoEsclusione).toBeNull()
    expect(l.movimentoVigenteId).toBe(r2.movimento.id)
    expect(await legamiDi(s)).toHaveLength(1)
  })

  it('solo la data cambia e l’elenco non è più valido: DA_COLLEGARE con ELENCO_SCADUTO, contratto ed elenco invariati', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    await owner.elencoAddebiti.update({
      where: { id: s.elencoId },
      data: {
        validoDal: new Date('2026-01-01T00:00:00Z'),
        validoAl: new Date('2026-03-31T00:00:00Z'),
      },
    })
    await rettifica(s, m.id, { movementDate: new Date('2026-04-15T10:00:00Z') })
    const l = (await legameDi(m.id))!
    expect(l.stato).toBe('DA_COLLEGARE')
    expect(l.motivi).toContain('ELENCO_SCADUTO')
    expect(dataIso(l.dataMovimento)).toBe('2026-04-15')
    expect(l.contrattoId).toBe(s.contrattoId)
    expect(l.elencoId).toBe(s.elencoId)
  })

  it('solo la data cambia e il contratto non è più attivo: DA_COLLEGARE con CONTRATTO_NON_ATTIVO', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    await owner.contrattoCliente.update({
      where: { id: s.contrattoId },
      data: { dataFine: new Date('2026-03-31T00:00:00Z') },
    })
    await rettifica(s, m.id, { movementDate: new Date('2026-04-15T10:00:00Z') })
    const l = (await legameDi(m.id))!
    expect(l.stato).toBe('DA_COLLEGARE')
    expect(l.motivi).toContain('CONTRATTO_NON_ATTIVO')
    expect(l.contrattoId).toBe(s.contrattoId)
  })

  it('annullamento non fatturato: ANNULLATO, righe conservate, vigente = annullo', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    const r = await annulla(s, m.id)
    const l = (await legameDi(m.id))!
    expect(l).toMatchObject({ stato: 'ANNULLATO', movimentoVigenteId: r.movimento.id })
    expect(l.righe).toHaveLength(1)
    expect(await legamiDi(s)).toHaveLength(1)
    expect(r.fatturazione).toMatchObject({ esito: 'COLLEGATO', stato: 'ANNULLATO' })
  })

  it.each(['FATTURATO', 'IMPORTATO_FATTURATO'] as const)(
    'rettifica con legame %s: stato, righe, prezzi e data identici; scostamento e vigente aggiornati; avviso in risposta, non persistito',
    async stato => {
      const s = await scenario()
      const m = await registraMovimento(s)
      const l0 = (await legameDi(m.id))!
      await portaAFatturato(l0.id, stato)
      const prima = (await legameDi(m.id))!
      const r = await rettifica(s, m.id, {
        quantity: 70,
        movementDate: new Date('2026-06-01T10:00:00Z'),
      })
      const l = (await legameDi(m.id))!
      expect(l).toMatchObject({
        stato,
        movimentoVigenteId: r.movimento.id,
        scostamentoDopoFattura: true,
        clienteId: prima.clienteId,
        contrattoId: prima.contrattoId,
        elencoId: prima.elencoId,
        fatturatoIl: prima.fatturatoIl,
      })
      expect(l.scostamentoIl).not.toBeNull()
      expect(l.dataMovimento).toEqual(prima.dataMovimento)
      expect(l.righe[0].quantita?.toFixed()).toBe('100')
      expect(l.righe[0].prezzo?.toFixed()).toBe(prima.righe[0].prezzo?.toFixed())
      expect(l.avvisi).toEqual(prima.avvisi)
      expect(r.avvisi).toContain(AVVISO_SCOSTAMENTO)
    }
  )

  it('annullo con legame FATTURATO: stesso scostamento, il registro si corregge', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    await portaAFatturato((await legameDi(m.id))!.id, 'FATTURATO')
    const r = await annulla(s, m.id)
    const l = (await legameDi(m.id))!
    expect(l).toMatchObject({
      stato: 'FATTURATO',
      scostamentoDopoFattura: true,
      movimentoVigenteId: r.movimento.id,
    })
    expect(r.avvisi).toContain(AVVISO_SCOSTAMENTO)
    expect(r.movimento.tipoAnnotazione).toBe('ANNULLAMENTO')
  })

  it('un FATTURATO indietro compare DA_RIALLINEARE e il riallineamento fallito non fa perdere la correzione', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    await portaAFatturato((await legameDi(m.id))!.id, 'FATTURATO')
    jest.spyOn(LegamiService.prototype, 'allineaAlVigente').mockImplementation(async () => {
      throw new Error('guasto simulato')
    })
    const r = await rettifica(s, m.id, { quantity: 70 })
    expect(r.movimento.tipoAnnotazione).toBe('RETTIFICA')
    expect((await legameDi(m.id))!.movimentoVigenteId).toBe(m.id)
    // Decisione 21: un FATTURATO rimasto indietro si vede in lista come DA_RIALLINEARE.
    const elenco = await nel(s.tenantId, () =>
      lista.lista(s.tenantId, { stati: ['DA_RIALLINEARE'] })
    )
    expect(elenco.elementi.map(e => e.stato)).toEqual(['DA_RIALLINEARE'])
  })

  // ---------------------------------------------------------------------------------------
  // Review Focus 4: catene lunghe e «fatturazione da»
  // ---------------------------------------------------------------------------------------

  it('rettifica, seconda rettifica, annullo: un solo legame per radice, vigente = ultima testa a ogni passo, data ricalcolata', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    const r1 = await rettifica(s, m.id, {
      quantity: 90,
      movementDate: new Date('2026-03-11T10:00:00Z'),
    })
    let l = (await legameDi(m.id))!
    expect(l.movimentoVigenteId).toBe(r1.movimento.id)
    expect(dataIso(l.dataMovimento)).toBe('2026-03-11')
    const r2 = await rettifica(s, r1.movimento.id, {
      quantity: 85,
      movementDate: new Date('2026-03-12T10:00:00Z'),
    })
    l = (await legameDi(m.id))!
    expect(l.movimentoVigenteId).toBe(r2.movimento.id)
    expect(dataIso(l.dataMovimento)).toBe('2026-03-12')
    expect(l.righe[0].quantita?.toFixed()).toBe('85')
    const r3 = await annulla(s, r2.movimento.id)
    l = (await legameDi(m.id))!
    expect(l).toMatchObject({ stato: 'ANNULLATO', movimentoVigenteId: r3.movimento.id })
    expect(await legamiDi(s)).toHaveLength(1)
    const esito = await nel(s.tenantId, () => verifica.verifica(s.tenantId, s.registroId, ANNO))
    expect(esito.primoErrore).toBeNull()
  })

  it('rettifica che porta la data da dopo a prima di «fatturazione da»: ESCLUSO col testo fisso; poi di nuovo dopo: riammesso', async () => {
    const s = await scenario({ fatturazioneDa: '2026-03-01' })
    const m = await registraMovimento(s, { data: '2026-03-10' })
    const r1 = await rettifica(s, m.id, { movementDate: new Date('2026-02-15T10:00:00Z') })
    let l = (await legameDi(m.id))!
    expect(l).toMatchObject({
      stato: 'ESCLUSO',
      motivoEsclusione: MOTIVO_ESCLUSIONE_DATA,
      movimentoVigenteId: r1.movimento.id,
    })
    const r2 = await rettifica(s, r1.movimento.id, {
      movementDate: new Date('2026-03-20T10:00:00Z'),
    })
    l = (await legameDi(m.id))!
    expect(l.stato).toBe('PROPOSTO')
    expect(l.motivoEsclusione).toBeNull()
    expect(l.movimentoVigenteId).toBe(r2.movimento.id)
    expect(dataIso(l.dataMovimento)).toBe('2026-03-20')
    expect(await legamiDi(s)).toHaveLength(1)
  })

  it('rettifica che porta la data da prima a dopo «fatturazione da»: il legame nasce', async () => {
    const s = await scenario({ fatturazioneDa: '2026-03-01' })
    const m = await registraMovimento(s, { data: '2026-02-10', legame: null })
    expect(await legamiDi(s)).toHaveLength(0)
    const r = await rettifica(
      s,
      m.id,
      { movementDate: new Date('2026-03-10T10:00:00Z') },
      {
        azione: 'PROPOSTA',
      }
    )
    const l = (await legameDi(m.id))!
    expect(l).toMatchObject({ movimentoVigenteId: r.movimento.id, stato: 'PROPOSTO' })
    expect(dataIso(l.dataMovimento)).toBe('2026-03-10')
  })

  // ---------------------------------------------------------------------------------------
  // Movimenti senza legame
  // ---------------------------------------------------------------------------------------

  it('fatturazione spenta: nessun legame, nessun avviso, nessun errore (rettifica e annullo)', async () => {
    const s = await scenario({ fatturazioneDa: null })
    const m = await registraMovimento(s, { legame: null, senzaFir: true })
    const r = await rettifica(s, m.id, { quantity: 90 })
    expect(r.avvisi).toEqual([])
    const a = await annulla(s, r.movimento.id)
    expect(a.avvisi).toEqual([])
    expect(await legamiDi(s)).toHaveLength(0)
    expect(await auditDi(s, 'LEGAME_NON_RIUSCITO')).toHaveLength(0)
  })

  it('movimento storico senza legame, causale non fatturabile: nessun legame', async () => {
    const s = await scenario()
    const m = await registraMovimento(s, { causale: 'PRODUZIONE_INTERNA', legame: null })
    const r = await rettifica(s, m.id, { causale: 'PRODUZIONE_INTERNA', quantity: 5 })
    expect(r.avvisi).toEqual([])
    expect(r.fatturazione).toBeUndefined()
    await annulla(s, r.movimento.id)
    expect(await legamiDi(s)).toHaveLength(0)
  })

  it('annullo di un movimento senza legame (mancante): nessun legame nasce', async () => {
    const s = await scenario()
    const m = await registraMovimento(s, { legame: null })
    await owner.legameMovimento.deleteMany({ where: { tenantId: s.tenantId } })
    await annulla(s, m.id)
    expect(await legamiDi(s)).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------------------
  // Il legame non fa mai fallire la correzione
  // ---------------------------------------------------------------------------------------

  it('errore SQL dentro il savepoint: la correzione resta valida, il legame resta indietro (DA_RIALLINEARE), audit e segnalazione', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    const segnala = jest.spyOn(segnalazione, 'segnalaErroreJob').mockImplementation(() => {})
    jest.spyOn(LegamiService.prototype, 'allineaAlVigente').mockImplementation(async (tx: any) => {
      await tx.$executeRaw`SELECT 1/0`
      throw new Error('non raggiungibile')
    })
    const r = await rettifica(s, m.id, { quantity: 90 })
    expect(r.movimento.tipoAnnotazione).toBe('RETTIFICA')
    expect(r.avvisi).toContain(AVVISO_LEGAME_DA_RIALLINEARE)
    expect(r.fatturazione).toMatchObject({
      esito: 'DA_RIALLINEARE',
      legameId: (await legameDi(m.id))!.id,
      stato: null,
    })
    // La transazione NON e' in abort: la riga della correzione e l'audit sono stati scritti.
    expect(await auditDi(s, 'REGISTRO_MOVIMENTO_RETTIFICATO')).toHaveLength(1)
    const audit = await auditDi(s, 'LEGAME_NON_RIUSCITO')
    expect(audit).toHaveLength(1)
    expect(audit[0].metadata).toMatchObject({ correzione: true, tipo: 'RETTIFICA' })
    expect(segnala).toHaveBeenCalledTimes(1)
    const l = (await legameDi(m.id))!
    expect(l.movimentoVigenteId).toBe(m.id)
    expect(l.righe[0].quantita?.toFixed()).toBe('100')
    const elenco = await nel(s.tenantId, () =>
      lista.lista(s.tenantId, { stati: ['DA_RIALLINEARE'] })
    )
    expect(elenco.elementi.map(e => e.stato)).toEqual(['DA_RIALLINEARE'])
    const esito = await nel(s.tenantId, () => verifica.verifica(s.tenantId, s.registroId, ANNO))
    expect(esito.primoErrore).toBeNull()
  })

  it('il lock_timeout del legame (2 s) è ripristinato prima dei saldi della correzione', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    const visti: string[] = []
    const originale = giacenza.saldiRegistroCer
    jest
      .spyOn(giacenza, 'saldiRegistroCer')
      .mockImplementation(async (db: any, ...resto: any[]) => {
        const v = await db.$queryRaw`SELECT current_setting('lock_timeout') AS v`
        visti.push(v[0].v)
        return (originale as any)(db, ...resto)
      })
    await rettifica(s, m.id, { quantity: 90 })
    expect(visti.length).toBeGreaterThan(0)
    expect(visti.every(v => v !== '2s')).toBe(true)
  })

  it('enable_nestloop (joinLineari) e` ripristinato prima dei saldi della correzione', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    const visti: string[] = []
    const originale = giacenza.saldiRegistroCer
    jest
      .spyOn(giacenza, 'saldiRegistroCer')
      .mockImplementation(async (db: any, ...resto: any[]) => {
        const v = await db.$queryRaw`SELECT current_setting('enable_nestloop') AS v`
        visti.push(v[0].v)
        return (originale as any)(db, ...resto)
      })
    const orig = LegamiService.prototype.allineaAlVigente
    jest.spyOn(LegamiService.prototype, 'allineaAlVigente').mockImplementation(async function (
      this: LegamiService,
      tx: any,
      ...resto: any[]
    ) {
      await joinLineari(tx)
      return (orig as any).call(this, tx, ...resto)
    })
    await rettifica(s, m.id, { quantity: 90 })
    expect(visti.length).toBeGreaterThan(0)
    expect(visti.every(v => v === 'on')).toBe(true)
  })

  it('M2: il legame doveva nascere e non ci riesce: la rettifica dice NON_RIUSCITO (come la lista: MANCANTE)', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    await owner.$executeRaw`DELETE FROM legami_movimento WHERE tenant_id = ${s.tenantId}::uuid AND movimento_originale_id = ${m.id}::uuid`
    jest.spyOn(segnalazione, 'segnalaErroreJob').mockImplementation(() => {})
    jest
      .spyOn(PropostaLegameService.prototype, 'proponiEScrivi')
      .mockImplementation(async (tx: any) => {
        await tx.$executeRaw`SELECT 1/0`
        throw new Error('non raggiungibile')
      })
    const r = await rettifica(s, m.id, { quantity: 90 })
    expect(r.fatturazione).toMatchObject({ esito: 'NON_RIUSCITO', legameId: null })
    expect(r.avvisi).toContain(AVVISO_LEGAME_CORREZIONE_NON_RIUSCITO)
    expect(r.avvisi).not.toContain(AVVISO_LEGAME_DA_RIALLINEARE)
    expect(await legameDi(m.id)).toBeNull()
  })

  it('12 correzioni parallele sullo stesso registro col listino bloccato: TUTTE riescono, i legami scadono senza effetto', async () => {
    const s = await scenario()
    const movimenti: { id: string }[] = []
    for (let i = 0; i < 12; i++) {
      movimenti.push(await registraMovimento(s, { legame: { azione: 'PROPOSTA' } }))
    }
    const blocco = tenitore(async tx => {
      await tx.$queryRaw`SELECT id FROM righe_addebito WHERE id = ${s.rigaCerId}::uuid FOR UPDATE`
    })
    await blocco.pronta
    try {
      const esiti = await Promise.all(
        movimenti.map(m =>
          rettifica(s, m.id, { quantity: 90 }).then(
            r => ({ ok: true as const, r }),
            (e: Error) => ({ ok: false as const, e })
          )
        )
      )
      // Un P2028 (transazione scaduta) o un 40P01 farebbe fallire la correzione.
      expect(esiti.filter(e => !e.ok).map(e => (e as { e: Error }).e.message)).toEqual([])
      const progressivi = esiti.map(e => (e as any).r.movimento.progressiveNumber)
      expect(new Set(progressivi).size).toBe(12)
      const audit = await auditDi(s, 'LEGAME_NON_RIUSCITO')
      const codici = audit.map(a => (a.metadata as { codice: string }).codice)
      expect(codici.every(c => /^(55P03|P2010|BUDGET_ESAURITO)$/.test(c))).toBe(true)
      // Le prime attendono i 2 s del tetto, le ultime trovano il budget gia' esaurito.
      expect(codici.some(c => /^(55P03|P2010)$/.test(c))).toBe(true)
      expect(codici).toContain('BUDGET_ESAURITO')
      // Il listino era bloccato: nessun legame e' stato riallineato.
      const legamiS = await legamiDi(s)
      expect(legamiS).toHaveLength(12)
      const vigentiIndietro = legamiS.filter(l =>
        movimenti.some(m => m.id === l.movimentoVigenteId)
      )
      expect(vigentiIndietro).toHaveLength(12)
      const esito = await nel(s.tenantId, () => verifica.verifica(s.tenantId, s.registroId, ANNO))
      expect(esito.primoErrore).toBeNull()
    } finally {
      blocco.rilascia()
      await blocco.fine
    }
  }, 180_000)

  // ---------------------------------------------------------------------------------------
  // Giro di correzione 1 (revisione del Task 21)
  // ---------------------------------------------------------------------------------------

  /** Secondo contratto del cliente con un elenco che ha la riga del CER indicato. */
  async function secondoContratto(s: ScenarioProposta, cer: string) {
    const c = await creaContrattoConElenco(owner, s.tenantId, { clienteId: s.clienteId })
    await creaRiga(owner, s.tenantId, c.elencoId, {
      tipo: 'CER',
      cerCode: cer,
      codiceIvaId: s.ivaId,
    })
    return c
  }

  it('I2: cambio di CER con azione CONFERMA e proposta completa: il legame torna CONFERMATO', async () => {
    const s = await scenario()
    const m = await registraMovimento(s, { legame: { azione: 'PROPOSTA' } })
    const r = await rettifica(s, m.id, { cerCode: CER_B }, { azione: 'CONFERMA' })
    const l = (await legameDi(m.id))!
    expect(l).toMatchObject({ stato: 'CONFERMATO', movimentoVigenteId: r.movimento.id })
    expect(l.confermatoIl).not.toBeNull()
    expect(l.avvisi).not.toContain('CAMBIO_CER_DA_CONFERMARE')
    expect(r.avvisi).toEqual([])
    expect(r.fatturazione).toMatchObject({ esito: 'COLLEGATO', stato: 'CONFERMATO' })
  })

  it('I2: da CONFERMATO, cambio di CER con azione CONFERMA: riconfermato sui prezzi nuovi', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    await rettifica(s, m.id, { cerCode: CER_B }, { azione: 'CONFERMA' })
    const l = (await legameDi(m.id))!
    expect(l.stato).toBe('CONFERMATO')
    expect(l.righe).toHaveLength(1)
    expect(l.righe[0].congelataIl).not.toBeNull()
  })

  it("I2: il contratto scelto dall'utente nel blocco legame è applicato (cambio di CER con due contratti)", async () => {
    const s = await scenario()
    const c2 = await secondoContratto(s, CER_B)
    const m = await registraMovimento(s, { legame: { azione: 'PROPOSTA' } })
    const r = await rettifica(
      s,
      m.id,
      { cerCode: CER_B },
      { azione: 'CONFERMA', contrattoId: c2.contrattoId, elencoId: c2.elencoId }
    )
    const l = (await legameDi(m.id))!
    expect(l).toMatchObject({
      contrattoId: c2.contrattoId,
      elencoId: c2.elencoId,
      stato: 'CONFERMATO',
      movimentoVigenteId: r.movimento.id,
    })
    expect(r.avvisi).toEqual([])
  })

  it('I2: CONFERMA con legame non completo: resta come il dominio dice, con i motivi e un avviso', async () => {
    const s = await scenario()
    const sconosciuto = '20 01 01'
    if ((await owner.cERCode.count({ where: { code: sconosciuto } })) === 0)
      cerCreati.push(sconosciuto)
    await owner.cERCode.upsert({
      where: { code: sconosciuto },
      create: { code: sconosciuto, description: 'CER di test', category: '20', subcategory: '' },
      update: {},
    })
    const m = await registraMovimento(s, { legame: { azione: 'PROPOSTA' } })
    const r = await rettifica(s, m.id, { cerCode: sconosciuto }, { azione: 'CONFERMA' })
    const l = (await legameDi(m.id))!
    expect(l.stato).toBe('DA_COLLEGARE')
    expect(l.motivi).toContain('SENZA_RIGA_CER')
    expect(l.movimentoVigenteId).toBe(r.movimento.id)
    expect(r.avvisi).toContain(AVVISO_LEGAME_CONFERMA_NON_POSSIBILE)
    expect(r.fatturazione).toMatchObject({ esito: 'COLLEGATO', stato: 'DA_COLLEGARE' })
    expect(r.fatturazione?.motivi).toContain('SENZA_RIGA_CER')
  })

  it('I3: blocco legame non valido (cliente inesistente): il legame si riallinea comunque, con un avviso', async () => {
    const s = await scenario()
    const m = await registraMovimento(s, { legame: { azione: 'PROPOSTA' } })
    const r = await rettifica(
      s,
      m.id,
      { quantity: 90 },
      { azione: 'PROPOSTA', clienteId: randomUUID() }
    )
    const l = (await legameDi(m.id))!
    expect(l.movimentoVigenteId).toBe(r.movimento.id)
    expect(l.righe[0].quantita?.toFixed()).toBe('90')
    expect(r.avvisi).toEqual([AVVISO_LEGAME_SCELTE_NON_APPLICATE])
    expect(r.avvisi).not.toContain(AVVISO_LEGAME_DA_RIALLINEARE)
    expect(await auditDi(s, 'LEGAME_NON_RIUSCITO')).toHaveLength(0)
    const elenco = await nel(s.tenantId, () =>
      lista.lista(s.tenantId, { stati: ['DA_RIALLINEARE'] })
    )
    expect(elenco.elementi).toHaveLength(0)
  })

  it('I2/I3: contratto inesistente sul cambio di CER: non applicato, mai in silenzio, legame allineato', async () => {
    const s = await scenario()
    const m = await registraMovimento(s, { legame: { azione: 'PROPOSTA' } })
    const r = await rettifica(
      s,
      m.id,
      { cerCode: CER_B },
      { azione: 'PROPOSTA', contrattoId: randomUUID() }
    )
    expect(r.avvisi).toContain(AVVISO_LEGAME_SCELTE_NON_APPLICATE)
    expect((await legameDi(m.id))!.movimentoVigenteId).toBe(r.movimento.id)
  })

  it('blocco legame con scelte su un legame FATTURATO: non applicate, con avviso (oltre allo scostamento)', async () => {
    const s = await scenario()
    const m = await registraMovimento(s)
    await portaAFatturato((await legameDi(m.id))!.id, 'FATTURATO')
    const r = await rettifica(
      s,
      m.id,
      { quantity: 70 },
      { azione: 'CONFERMA', clienteId: s.clienteId }
    )
    expect(r.avvisi).toEqual(
      expect.arrayContaining([AVVISO_SCOSTAMENTO, AVVISO_LEGAME_SCELTE_NON_APPLICATE])
    )
    expect((await legameDi(m.id))!.stato).toBe('FATTURATO')
  })

  it('I1: fatturazione spenta e progressivo tenuto oltre il budget: nessun avviso, audit o blocco fatturazione', async () => {
    const s = await scenario({ fatturazioneDa: null })
    const m = await registraMovimento(s, { legame: null, senzaFir: true })
    const segnala = jest.spyOn(segnalazione, 'segnalaErroreJob').mockImplementation(() => {})
    const blocco = tenitore(async tx => {
      const chiave = `${s.registroId}-${annoSolareItaliano(new Date())}`
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${chiave}))`
    })
    await blocco.pronta
    try {
      const correzione = rettifica(s, m.id, { quantity: 90 })
      await attendiLock(1)
      // Il budget del legame si misura dall'inizio della transazione: va fatto scadere davvero.
      await new Promise(r => setTimeout(r, 16_000))
      blocco.rilascia()
      const r = await correzione
      expect(r.avvisi).toEqual([])
      expect(r.fatturazione).toBeUndefined()
    } finally {
      blocco.rilascia()
      await blocco.fine
    }
    expect(await auditDi(s, 'LEGAME_NON_RIUSCITO')).toHaveLength(0)
    expect(segnala).not.toHaveBeenCalled()
    expect(await legamiDi(s)).toHaveLength(0)
  }, 90_000)

  it('m6: 8 rettifiche parallele che fanno nascere il legame, listino bloccato: tutte riescono', async () => {
    const s = await scenario()
    const movimenti: { id: string }[] = []
    for (let i = 0; i < 8; i++) {
      movimenti.push(await registraMovimento(s, { causale: 'PRODUZIONE_INTERNA', legame: null }))
    }
    const blocco = tenitore(async tx => {
      await tx.$queryRaw`SELECT id FROM righe_addebito WHERE id = ${s.rigaCerId}::uuid FOR UPDATE`
    })
    await blocco.pronta
    try {
      const esiti = await Promise.all(
        movimenti.map(m =>
          rettifica(s, m.id, { causale: 'INGRESSO_ESTERNO' }, { azione: 'PROPOSTA' }).then(
            r => ({ ok: true as const, r }),
            (e: Error) => ({ ok: false as const, e })
          )
        )
      )
      expect(esiti.filter(e => !e.ok).map(e => (e as { e: Error }).e.message)).toEqual([])
      const ok = esiti.map(e => (e as { r: Awaited<ReturnType<typeof rettifica>> }).r)
      expect(new Set(ok.map(r => r.movimento.progressiveNumber)).size).toBe(8)
      // Il listino era bloccato: nessun legame e' nato, ogni correzione lo dice.
      expect(await legamiDi(s)).toHaveLength(0)
      expect(ok.every(r => r.avvisi.includes(AVVISO_LEGAME_CORREZIONE_NON_RIUSCITO))).toBe(true)
      expect(ok.every(r => r.fatturazione?.esito === 'NON_RIUSCITO')).toBe(true)
      const codici = (await auditDi(s, 'LEGAME_NON_RIUSCITO')).map(
        a => (a.metadata as { codice: string }).codice
      )
      expect(codici).toHaveLength(8)
      expect(codici.every(c => /^(55P03|P2010|BUDGET_ESAURITO)$/.test(c))).toBe(true)
      const esito = await nel(s.tenantId, () => verifica.verifica(s.tenantId, s.registroId, ANNO))
      expect(esito.primoErrore).toBeNull()
    } finally {
      blocco.rilascia()
      await blocco.fine
    }
  }, 180_000)

  // ---------------------------------------------------------------------------------------
  // Concorrenza con una conferma (barriera su pg_stat_activity)
  // ---------------------------------------------------------------------------------------

  it('conferma in corso, poi la rettifica: si serializzano sul lock di radice, il riallineamento vede il CONFERMATO', async () => {
    const s = await scenario()
    const m = await registraMovimento(s, { legame: { azione: 'PROPOSTA' } })
    const l0 = (await legameDi(m.id))!
    // La conferma resta ferma sul listino (riga FOR UPDATE di un altro) tenendo il lock di radice.
    const blocco = tenitore(async tx => {
      await tx.$queryRaw`SELECT id FROM righe_addebito WHERE id = ${s.rigaCerId}::uuid FOR UPDATE`
    })
    await blocco.pronta
    const conferma = legami.conferma(s.tenantId, s.utenteId, l0.id, l0.versione)
    await attendiLock(1)
    const correzione = rettifica(s, m.id, { quantity: 90 })
    await attendiLock(2)
    blocco.rilascia()
    await blocco.fine
    const [c, r] = await Promise.all([conferma, correzione])
    expect(c.stato).toBe('CONFERMATO')
    const l = (await legameDi(m.id))!
    expect(l).toMatchObject({ stato: 'CONFERMATO', movimentoVigenteId: r.movimento.id })
    expect(l.righe[0].quantita?.toFixed()).toBe('90')
    expect(await auditDi(s, 'LEGAME_NON_RIUSCITO')).toHaveLength(0)
  }, 60_000)

  it('rettifica in corso, poi la conferma: la conferma con la versione vecchia è respinta, con quella nuova riesce sui dati nuovi', async () => {
    const s = await scenario()
    const m = await registraMovimento(s, { legame: { azione: 'PROPOSTA' } })
    const l0 = (await legameDi(m.id))!
    let sblocca!: () => void
    const barriera = new Promise<void>(r => (sblocca = r))
    let dentro!: () => void
    const inRiallineamento = new Promise<void>(r => (dentro = r))
    const originale = LegamiService.prototype.allineaAlVigente
    jest.spyOn(LegamiService.prototype, 'allineaAlVigente').mockImplementation(async function (
      this: LegamiService,
      ...a: any[]
    ) {
      dentro()
      await barriera
      return (originale as any).apply(this, a)
    })
    const correzione = rettifica(s, m.id, { quantity: 90 })
    // La rettifica tiene il lock di radice dentro il riallineamento; solo ora arriva la conferma.
    await inRiallineamento
    const conferma = legami.conferma(s.tenantId, s.utenteId, l0.id, l0.versione).then(
      () => 'ok',
      (e: unknown) => (e instanceof ConflictException ? 'conflitto' : String(e))
    )
    await attendiLock(1)
    sblocca()
    const r = await correzione
    expect(await conferma).toBe('conflitto')
    const dopo = (await legameDi(m.id))!
    expect(dopo.stato).toBe('PROPOSTO')
    expect(dopo.movimentoVigenteId).toBe(r.movimento.id)
    const c = await legami.conferma(s.tenantId, s.utenteId, dopo.id, dopo.versione)
    expect(c.stato).toBe('CONFERMATO')
    const fine = (await legameDi(m.id))!
    expect(fine.righe[0].quantita?.toFixed()).toBe('90')
    expect(await auditDi(s, 'LEGAME_NON_RIUSCITO')).toHaveLength(0)
  }, 60_000)
})
