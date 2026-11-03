/**
 * «Aggiorna prezzi» (fase 4.3, Task 17, spec §7.4, decisioni 2 e 16) contro un Postgres reale,
 * collegato COME `wasteflow_app`. Il proprietario prepara lo scenario e legge lo stato finale.
 * Pulizia solo per id esatti: l'id di ogni azienda si registra in `tenantCreati` appena esiste
 * (`onTenantCreato`), prima di ogni altra operazione che puo' fallire. Le barriere guardano
 * `pg_stat_activity` (sessioni di QUESTO processo, `wait_event_type = 'Lock'`): niente `sleep`
 * come sincronizzazione.
 */
import { HttpException } from '@nestjs/common'
import { Prisma, PrismaClient } from '@prisma/client'
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
const NOME_APPLICAZIONE = `legami-t17-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { creaRiga } from '../../test-support/listino-di-test'
import {
  creaLegameDiTest,
  creaMovimentoDiTest,
  creaScenarioProposta,
  pulisciLegamiDiTest,
  type OpzioniLegameDiTest,
  type ScenarioProposta,
} from '../../test-support/legami-di-test'
import { AggiornaPrezziService } from './aggiorna-prezzi.service'

interface Eccezione {
  status: number
  body: Record<string, unknown>
}

describe('AggiornaPrezziService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: AggiornaPrezziService
  const tenantCreati: string[] = []

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    service = new AggiornaPrezziService(app)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await pulisciLegamiDiTest(owner, tenantCreati)
      for (const tabella of [
        'righe_addebito',
        'elenchi_addebiti',
        'contratti_cliente',
        'addebiti',
        'codifiche_addebito',
        'codici_iva',
      ]) {
        await owner.$executeRawUnsafe(
          `DELETE FROM ${tabella} WHERE tenant_id = ANY($1::uuid[])`,
          tenantCreati
        )
      }
      await owner.fIR.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.user.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await owner.$disconnect()
    await app?.$disconnect()
  })

  async function scenario(righeV = 0): Promise<ScenarioProposta> {
    return creaScenarioProposta(owner, { righeV, onTenantCreato: id => tenantCreati.push(id) })
  }

  /** Un legame CONFERMATO (di default) sulla riga CER a prezzo 10, quantita' 100, IVA 22. */
  async function nuovoLegame(
    s: ScenarioProposta,
    o: Partial<OpzioniLegameDiTest> = {}
  ): Promise<{ legameId: string; righeIds: string[]; movimentoId: string }> {
    const m = await creaMovimentoDiTest(owner, s.tenantId, {
      cerCode: '20 03 01',
      movementDate: o.dataMovimento,
    })
    const l = await creaLegameDiTest(owner, s.tenantId, {
      movimentoOriginaleId: m.movimentoId,
      registroId: m.registroId,
      verso: 'CARICO',
      stato: 'CONFERMATO',
      clienteId: s.clienteId,
      contrattoId: s.contrattoId,
      elencoId: s.elencoId,
      righe: [
        { rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100', prezzo: '10.000000' },
      ],
      ...o,
    })
    return { ...l, movimentoId: m.movimentoId }
  }

  const prezzoListino = (rigaId: string, prezzo: string | null, sconto: string | null = null) =>
    owner.$executeRaw`
      UPDATE righe_addebito SET prezzo = ${prezzo}::numeric, sconto = ${sconto},
        versione = versione + 1 WHERE id = ${rigaId}::uuid`

  const anteprima = (s: ScenarioProposta, p: object = { contrattoId: s.contrattoId }) =>
    nel(s.tenantId, () => service.anteprima(s.tenantId, p))
  const applica = (
    s: ScenarioProposta,
    firma: string,
    p: object = { contrattoId: s.contrattoId }
  ) => nel(s.tenantId, () => service.applica(s.tenantId, s.utenteId, p, firma))

  async function errore(p: Promise<unknown>): Promise<Eccezione> {
    try {
      await p
    } catch (e) {
      if (e instanceof HttpException) {
        return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> }
      }
      throw e
    }
    throw new Error('attesa un’eccezione, la chiamata e’ riuscita')
  }

  interface RigaDb {
    id: string
    prezzo: string | null
    sconto: string | null
    quantita: string | null
    ivaId: string
    aliquota: string
    natura: string | null
    congelataIl: Date | null
    manuale: boolean
  }
  const righeDb = (legameId: string) =>
    owner.$queryRaw<RigaDb[]>`
      SELECT id::text AS id, prezzo::text AS prezzo, sconto, quantita::text AS quantita,
             codice_iva_id::text AS "ivaId", aliquota_iva::text AS aliquota,
             natura_iva AS natura, congelata_il AS "congelataIl", prezzo_manuale AS manuale
      FROM righe_legame_movimento WHERE legame_id = ${legameId}::uuid ORDER BY ordine`
  const legameDb = (id: string) => owner.legameMovimento.findUniqueOrThrow({ where: { id } })
  const saltati = (a: { saltati: { motivo: string; numero: number }[] }, motivo: string) =>
    a.saltati.find(x => x.motivo === motivo)?.numero ?? 0

  // -------------------------------------------------------------------------------------------
  // Barriere su pg_stat_activity
  // -------------------------------------------------------------------------------------------
  async function inAttesaDiLock(): Promise<number> {
    const r = await owner.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND application_name = ${NOME_APPLICAZIONE}
        AND wait_event_type = 'Lock'`
    return r[0].n
  }
  async function attendiLock(n: number, finita: () => boolean): Promise<void> {
    const scadenza = Date.now() + 30_000
    for (;;) {
      if ((await inAttesaDiLock()) >= n) return
      if (finita()) throw new Error('le transazioni sono finite senza attendere il lock')
      if (Date.now() > scadenza) throw new Error(`nessuna sessione in attesa di lock (attese ${n})`)
      await new Promise(r => setTimeout(r, 20))
    }
  }
  function tenitore(prendi: (tx: Prisma.TransactionClient) => Promise<unknown>) {
    let rilascia!: () => void
    const barriera = new Promise<void>(r => (rilascia = r))
    let segnala!: () => void
    const pronta = new Promise<void>(r => (segnala = r))
    const fine = owner.$transaction(
      async tx => {
        await prendi(tx)
        segnala()
        await barriera
      },
      { timeout: 60_000, maxWait: 30_000 }
    )
    return { pronta: Promise.race([pronta, fine]), rilascia, fine }
  }
  function osserva<R>(p: Promise<R>) {
    const stato = { finita: false }
    const esito = p.finally(() => (stato.finita = true))
    return { stato, esito }
  }

  // -------------------------------------------------------------------------------------------
  describe('aggiornamento dei prezzi', () => {
    it('prezzo di listino da 10 a 12: anteprima cambiano 1, applica riscrive prezzo, sconto e IVA e aggiorna congelata_il', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s)
      const ieri = new Date(Date.now() - 86_400_000)
      await owner.$executeRaw`
        UPDATE righe_legame_movimento SET congelata_il = ${ieri} WHERE legame_id = ${l.legameId}::uuid`
      const ivaN61 = (
        await owner.codiceIva.findFirstOrThrow({ where: { tenantId: s.tenantId, codice: 'N61' } })
      ).id
      await prezzoListino(s.rigaCerId, '12.000000', '10')
      await owner.$executeRaw`
        UPDATE righe_addebito SET codice_iva_id = ${ivaN61}::uuid WHERE id = ${s.rigaCerId}::uuid`

      const a = await anteprima(s)
      expect(a.cambiano).toBe(1)
      expect(a.invariati).toBe(0)
      expect(a.daCollegare).toBe(0)
      expect(a.righeEscluseManuali).toBe(0)
      expect(a.differenze).toEqual([
        {
          legameId: l.legameId,
          movimentoId: l.movimentoId,
          prezzoPrima: '10.000000',
          prezzoDopo: '12.000000',
          scontoPrima: null,
          scontoDopo: '10',
        },
      ])
      // L'anteprima non scrive.
      expect((await righeDb(l.legameId))[0].prezzo).toBe('10.000000')

      const esito = await applica(s, a.firma)
      expect(esito).toEqual({ aggiornati: 1, saltati: 0, daCollegare: 0 })
      const [r] = await righeDb(l.legameId)
      expect(r.prezzo).toBe('12.000000')
      expect(r.sconto).toBe('10')
      expect(r.ivaId).toBe(ivaN61)
      expect(r.aliquota).toBe('0.00')
      expect(r.natura).toBe('N6.1')
      expect(r.congelataIl!.getTime()).toBeGreaterThan(ieri.getTime() + 3_600_000)
      expect(r.quantita).toBe('100.000')
      const dopo = await legameDb(l.legameId)
      expect(dopo.stato).toBe('CONFERMATO')
      expect(dopo.versione).toBe(2)
      const audit = await owner.activityLog.findMany({
        where: { tenantId: s.tenantId, action: 'LEGAMI_PREZZI_AGGIORNATI' },
      })
      expect(audit).toHaveLength(1)
      expect(audit[0].userId).toBe(s.utenteId)
      expect(JSON.stringify(audit[0].metadata)).not.toMatch(/Proposta SRL|@example/)
    })

    it('righe invariate non scritte: prezzo gia’ allineato, nessun UPDATE e versione ferma', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s)
      await prezzoListino(s.rigaCerId, '10.000000')
      const a = await anteprima(s)
      expect(a.cambiano).toBe(0)
      expect(a.invariati).toBe(1)
      expect(a.differenze).toEqual([])
      const esito = await applica(s, a.firma)
      expect(esito.aggiornati).toBe(0)
      expect((await legameDb(l.legameId)).versione).toBe(1)
      expect(
        await owner.activityLog.count({
          where: { tenantId: s.tenantId, action: 'LEGAMI_PREZZI_AGGIORNATI' },
        })
      ).toBe(1)
    })

    it('legami FATTURATO e IMPORTATO_FATTURATO: mai toccati, contati come saltati; ESCLUSO e ANNULLATO saltati', async () => {
      const s = await scenario()
      const stati = ['FATTURATO', 'IMPORTATO_FATTURATO', 'ESCLUSO', 'ANNULLATO'] as const
      const ids: string[] = []
      for (const stato of stati) ids.push((await nuovoLegame(s, { stato })).legameId)
      const attivo = await nuovoLegame(s)
      await prezzoListino(s.rigaCerId, '12.000000')

      const a = await anteprima(s)
      expect(a.cambiano).toBe(1)
      for (const stato of stati) expect(saltati(a, stato)).toBe(1)
      const esito = await applica(s, a.firma)
      expect(esito.aggiornati).toBe(1)
      expect(esito.saltati).toBe(4)
      for (const id of ids) {
        expect((await righeDb(id))[0].prezzo).toBe('10.000000')
        expect((await legameDb(id)).versione).toBe(1)
      }
      expect((await righeDb(attivo.legameId))[0].prezzo).toBe('12.000000')
    })

    it('riga a prezzo speciale saltata (anche IVA e congelata_il invariati)', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s, {
        righe: [
          {
            rigaAddebitoId: s.rigaCerId,
            codiceIvaId: s.ivaId,
            quantita: '100',
            prezzoSpeciale: true,
          },
        ],
      })
      await prezzoListino(s.rigaCerId, '12.000000')
      const a = await anteprima(s)
      expect(a.cambiano).toBe(0)
      expect(saltati(a, 'PREZZO_SPECIALE')).toBe(1)
      await applica(s, a.firma)
      const [r] = await righeDb(l.legameId)
      expect(r.prezzo).toBeNull()
    })

    it('quantità MANUALE intatta', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s)
      await owner.$executeRaw`
        UPDATE righe_legame_movimento SET quantita = 7.5, quantita_origine = 'MANUALE'
        WHERE legame_id = ${l.legameId}::uuid`
      await prezzoListino(s.rigaCerId, '12.000000')
      const a = await anteprima(s)
      await applica(s, a.firma)
      const [r] = await righeDb(l.legameId)
      expect(r.prezzo).toBe('12.000000')
      expect(r.quantita).toBe('7.500')
      const q = await owner.$queryRaw<{ o: string }[]>`
        SELECT quantita_origine::text AS o FROM righe_legame_movimento WHERE id = ${r.id}::uuid`
      expect(q[0].o).toBe('MANUALE')
    })

    it('perimetro per periodo: solo data_movimento fra dal e al', async () => {
      const s = await scenario()
      const marzo = await nuovoLegame(s, { dataMovimento: '2026-03-10' })
      const maggio = await nuovoLegame(s, { dataMovimento: '2026-05-10' })
      const luglio = await nuovoLegame(s, { dataMovimento: '2026-07-10' })
      await prezzoListino(s.rigaCerId, '12.000000')
      const p = { contrattoId: s.contrattoId, dal: '2026-04-01', al: '2026-06-30' }
      const a = await anteprima(s, p)
      expect(a.cambiano).toBe(1)
      await applica(s, a.firma, p)
      expect((await righeDb(maggio.legameId))[0].prezzo).toBe('12.000000')
      expect((await righeDb(marzo.legameId))[0].prezzo).toBe('10.000000')
      expect((await righeDb(luglio.legameId))[0].prezzo).toBe('10.000000')
    })

    it('perimetro per elenco: un altro elenco dello stesso contratto non si tocca', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s)
      const e2 = await owner.elencoAddebiti.create({
        data: {
          tenantId: s.tenantId,
          contrattoId: s.contrattoId,
          codice: '002',
          descrizione: 'Secondo elenco',
        },
      })
      const r2 = await creaRiga(owner, s.tenantId, e2.id, {
        tipo: 'CER',
        cerCode: '20 03 01',
        codiceIvaId: s.ivaId,
      })
      const m = await creaMovimentoDiTest(owner, s.tenantId, { cerCode: '20 03 01' })
      const l2 = await creaLegameDiTest(owner, s.tenantId, {
        movimentoOriginaleId: m.movimentoId,
        registroId: m.registroId,
        verso: 'CARICO',
        stato: 'CONFERMATO',
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: e2.id,
        righe: [
          { rigaAddebitoId: r2.id, codiceIvaId: s.ivaId, quantita: '1', prezzo: '10.000000' },
        ],
      })
      await prezzoListino(s.rigaCerId, '12.000000')
      await prezzoListino(r2.id, '15.000000')
      const p = { elencoId: s.elencoId }
      const a = await anteprima(s, p)
      expect(a.cambiano).toBe(1)
      await applica(s, a.firma, p)
      expect((await righeDb(l.legameId))[0].prezzo).toBe('12.000000')
      expect((await righeDb(l2.legameId))[0].prezzo).toBe('10.000000')
    })

    it('perimetro non valido: 400; contratto o elenco di un altro: 404', async () => {
      const s = await scenario()
      const altra = await scenario()
      expect((await errore(anteprima(s, {}))).body.error).toBe('PERIMETRO_NON_VALIDO')
      expect((await errore(anteprima(s, { contrattoId: 'non-uuid' }))).status).toBe(400)
      expect(
        (await errore(anteprima(s, { contrattoId: s.contrattoId, dal: '2026-13-01' }))).status
      ).toBe(400)
      expect(
        (
          await errore(
            anteprima(s, { contrattoId: s.contrattoId, dal: '2026-05-01', al: '2026-04-01' })
          )
        ).status
      ).toBe(400)
      expect((await errore(anteprima(s, { contrattoId: altra.contrattoId }))).status).toBe(404)
      expect((await errore(anteprima(s, { elencoId: altra.elencoId }))).status).toBe(404)
      expect(
        (await errore(anteprima(s, { contrattoId: s.contrattoId, elencoId: altra.elencoId })))
          .status
      ).toBe(404)
    })
  })

  // -------------------------------------------------------------------------------------------
  describe('decisione 16: prezzo modificato a mano', () => {
    it('riga con prezzo_manuale: mai riscritta (prezzo, sconto, IVA e congelata_il invariati), contata in saltati e in righeEscluseManuali', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s, {
        righe: [
          {
            rigaAddebitoId: s.rigaCerId,
            codiceIvaId: s.ivaId,
            quantita: '100',
            prezzo: '5.500000',
            prezzoManuale: true,
          },
        ],
      })
      await owner.$executeRaw`
        UPDATE legami_movimento SET avvisi = ARRAY['PREZZO_MANUALE'] WHERE id = ${l.legameId}::uuid`
      const prima = (await righeDb(l.legameId))[0]
      await prezzoListino(s.rigaCerId, '12.000000', '10')

      const a = await anteprima(s)
      expect(a.cambiano).toBe(0)
      expect(a.righeEscluseManuali).toBe(1)
      expect(saltati(a, 'PREZZO_MANUALE')).toBe(1)
      expect(a.differenze).toEqual([])
      const esito = await applica(s, a.firma)
      expect(esito.aggiornati).toBe(0)
      expect(esito.saltati).toBe(1)
      const dopo = (await righeDb(l.legameId))[0]
      expect(dopo).toEqual(prima)
      expect(dopo.prezzo).toBe('5.500000')
      const lg = await legameDb(l.legameId)
      expect(lg.versione).toBe(1)
      // L'avviso PREZZO_MANUALE resta allineato alle righe.
      expect(lg.avvisi).toEqual(['PREZZO_MANUALE'])
    })

    it('legame con una riga manuale e una no: si aggiorna solo la riga non manuale; l’avviso resta', async () => {
      const s = await scenario(1)
      const l = await nuovoLegame(s, {
        righe: [
          {
            rigaAddebitoId: s.rigaCerId,
            codiceIvaId: s.ivaId,
            quantita: '100',
            prezzo: '5.500000',
            prezzoManuale: true,
          },
          {
            rigaAddebitoId: s.righeVIds[0],
            codiceIvaId: s.ivaId,
            quantita: '1',
            prezzo: '2.000000',
          },
        ],
      })
      await owner.$executeRaw`
        UPDATE legami_movimento SET avvisi = ARRAY['PREZZO_MANUALE'] WHERE id = ${l.legameId}::uuid`
      await prezzoListino(s.rigaCerId, '12.000000')
      await prezzoListino(s.righeVIds[0], '3.000000')
      const a = await anteprima(s)
      expect(a.cambiano).toBe(1)
      expect(a.righeEscluseManuali).toBe(1)
      expect(a.differenze.map(d => [d.prezzoPrima, d.prezzoDopo])).toEqual([
        ['2.000000', '3.000000'],
      ])
      await applica(s, a.firma)
      const [cer, v] = await righeDb(l.legameId)
      expect(cer.prezzo).toBe('5.500000')
      expect(v.prezzo).toBe('3.000000')
      expect((await legameDb(l.legameId)).avvisi).toEqual(['PREZZO_MANUALE'])
    })

    it('la firma dell’anteprima cambia se una riga diventa manuale fra anteprima e applica: 409 ANTEPRIMA_SUPERATA', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s)
      await prezzoListino(s.rigaCerId, '12.000000')
      const a = await anteprima(s)
      await owner.$executeRaw`
        UPDATE righe_legame_movimento SET prezzo_manuale = true, prezzo = 9
        WHERE legame_id = ${l.legameId}::uuid`
      const e = await errore(applica(s, a.firma))
      expect(e.status).toBe(409)
      expect(e.body.error).toBe('ANTEPRIMA_SUPERATA')
      expect((await righeDb(l.legameId))[0].prezzo).toBe('9.000000')
    })

    it('riga manuale con la riga di listino cambiata di famiglia: il legame passa a DA_COLLEGARE con SENZA_RIGA_CER e il prezzo manuale resta scritto', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s, {
        righe: [
          {
            rigaAddebitoId: s.rigaCerId,
            codiceIvaId: s.ivaId,
            quantita: '100',
            prezzo: '5.500000',
            prezzoManuale: true,
          },
        ],
      })
      await owner.$executeRaw`
        UPDATE legami_movimento SET confermato_il = now(), confermato_da = ${s.utenteId}::uuid
        WHERE id = ${l.legameId}::uuid`
      await owner.$executeRaw`
        UPDATE righe_addebito SET cer_code = '15 01 01' WHERE id = ${s.rigaCerId}::uuid`
      const a = await anteprima(s)
      expect(a.cambiano).toBe(1)
      expect(a.daCollegare).toBe(1)
      const esito = await applica(s, a.firma)
      expect(esito).toEqual({ aggiornati: 1, saltati: 1, daCollegare: 1 })
      const lg = await legameDb(l.legameId)
      expect(lg.stato).toBe('DA_COLLEGARE')
      expect(lg.motivi).toEqual(['SENZA_RIGA_CER'])
      expect(lg.confermatoIl).toBeNull()
      expect(lg.confermatoDa).toBeNull()
      expect(lg.versione).toBe(2)
      expect((await righeDb(l.legameId))[0].prezzo).toBe('5.500000')
      // Idempotente: una seconda anteprima non trova altro da fare.
      const b = await anteprima(s)
      expect(b.cambiano).toBe(0)
      expect(b.invariati).toBe(1)
    })

    it('riga di listino cambiata di famiglia (CER diverso) su riga non manuale: DA_COLLEGARE col motivo, prezzo non riscritto', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s)
      await prezzoListino(s.rigaCerId, '12.000000')
      await owner.$executeRaw`
        UPDATE righe_addebito SET cer_code = '15 01 01' WHERE id = ${s.rigaCerId}::uuid`
      const a = await anteprima(s)
      await applica(s, a.firma)
      const lg = await legameDb(l.legameId)
      expect(lg.stato).toBe('DA_COLLEGARE')
      expect(lg.motivi).toEqual(['SENZA_RIGA_CER'])
      expect((await righeDb(l.legameId))[0].prezzo).toBe('10.000000')
    })

    it('riga di listino usata da un legame: non si elimina (FK), quindi non esiste il caso «riga sparita»', async () => {
      const s = await scenario()
      await nuovoLegame(s)
      await expect(
        owner.$executeRaw`DELETE FROM righe_addebito WHERE id = ${s.rigaCerId}::uuid`
      ).rejects.toMatchObject({ meta: { code: '23503' } })
    })

    it('riga di listino diventata a prezzo speciale (senza prezzo): SENZA_PREZZO, il legame passa a DA_COLLEGARE; tornato il prezzo, ritorna PROPOSTO', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s)
      await owner.$executeRaw`
        UPDATE righe_addebito SET prezzo_speciale = true, prezzo = NULL
        WHERE id = ${s.rigaCerId}::uuid`
      const a = await anteprima(s)
      expect(a.daCollegare).toBe(1)
      expect(a.differenze[0]).toMatchObject({ prezzoPrima: '10.000000', prezzoDopo: null })
      await applica(s, a.firma)
      const lg = await legameDb(l.legameId)
      expect(lg.stato).toBe('DA_COLLEGARE')
      expect(lg.motivi).toEqual(['SENZA_PREZZO'])
      expect((await righeDb(l.legameId))[0].prezzo).toBeNull()

      await owner.$executeRaw`
        UPDATE righe_addebito SET prezzo_speciale = false, prezzo = 8 WHERE id = ${s.rigaCerId}::uuid`
      const b = await anteprima(s)
      await applica(s, b.firma)
      const lg2 = await legameDb(l.legameId)
      expect(lg2.stato).toBe('PROPOSTO')
      expect(lg2.motivi).toEqual([])
      expect((await righeDb(l.legameId))[0].prezzo).toBe('8.000000')
    })
  })

  // -------------------------------------------------------------------------------------------
  describe('firma e concorrenza', () => {
    it('anteprima vecchia dopo un cambio di listino: 409 ANTEPRIMA_SUPERATA, nessuna riga scritta', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s)
      await prezzoListino(s.rigaCerId, '12.000000')
      const a = await anteprima(s)
      await prezzoListino(s.rigaCerId, '13.000000')
      const e = await errore(applica(s, a.firma))
      expect(e.status).toBe(409)
      expect(e.body.error).toBe('ANTEPRIMA_SUPERATA')
      expect((await righeDb(l.legameId))[0].prezzo).toBe('10.000000')
      expect((await legameDb(l.legameId)).versione).toBe(1)
    })

    it('firma di un altro perimetro o inventata: 409 ANTEPRIMA_SUPERATA', async () => {
      const s = await scenario()
      await nuovoLegame(s)
      await prezzoListino(s.rigaCerId, '12.000000')
      const a = await anteprima(s)
      const e = await errore(applica(s, a.firma, { elencoId: s.elencoId }))
      expect(e.body.error).toBe('ANTEPRIMA_SUPERATA')
      const f = await errore(applica(s, 'x'.repeat(64)))
      expect(f.body.error).toBe('ANTEPRIMA_SUPERATA')
    })

    it('un altro tenant non compare e non si tocca', async () => {
      const s = await scenario()
      const altra = await scenario()
      const mio = await nuovoLegame(s)
      const loro = await nuovoLegame(altra)
      await prezzoListino(s.rigaCerId, '12.000000')
      await prezzoListino(altra.rigaCerId, '12.000000')
      const a = await anteprima(s)
      expect(a.cambiano).toBe(1)
      await applica(s, a.firma)
      expect((await righeDb(mio.legameId))[0].prezzo).toBe('12.000000')
      expect((await righeDb(loro.legameId))[0].prezzo).toBe('10.000000')
    })

    it('una transazione tiene FOR UPDATE le righe del legame e lo segna FATTURATO, poi commit: applica() rilegge e salta quel legame', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s)
      const libero = await nuovoLegame(s)
      await prezzoListino(s.rigaCerId, '12.000000')
      const a = await anteprima(s)
      expect(a.cambiano).toBe(2)

      const t = tenitore(async tx => {
        await tx.$queryRaw`SELECT id FROM legami_movimento WHERE id = ${l.legameId}::uuid FOR UPDATE`
        await tx.$queryRaw`SELECT id FROM righe_legame_movimento WHERE legame_id = ${l.legameId}::uuid FOR UPDATE`
        await tx.$executeRaw`
          UPDATE legami_movimento SET stato = 'FATTURATO', fatturato_il = now()
          WHERE id = ${l.legameId}::uuid`
      })
      await t.pronta
      const scrive = osserva(applica(s, a.firma))
      await attendiLock(1, () => scrive.stato.finita)
      expect(scrive.stato.finita).toBe(false)
      t.rilascia()
      await t.fine
      const esito = await scrive.esito
      expect(esito.aggiornati).toBe(1)
      expect(esito.saltati).toBeGreaterThanOrEqual(1)
      expect((await legameDb(l.legameId)).stato).toBe('FATTURATO')
      expect((await righeDb(l.legameId))[0].prezzo).toBe('10.000000')
      expect((await righeDb(libero.legameId))[0].prezzo).toBe('12.000000')
    })

    it('listino modificato mentre applica aspetta (FOR UPDATE sulla riga): applica non scrive un prezzo che l’utente non ha visto, 409; rifatta l’anteprima legge il prezzo nuovo', async () => {
      const s = await scenario()
      const l = await nuovoLegame(s)
      await prezzoListino(s.rigaCerId, '12.000000')
      const a = await anteprima(s)
      const t = tenitore(async tx => {
        await tx.$queryRaw`SELECT id FROM righe_addebito WHERE id = ${s.rigaCerId}::uuid FOR UPDATE`
        await tx.$executeRaw`UPDATE righe_addebito SET prezzo = 13 WHERE id = ${s.rigaCerId}::uuid`
      })
      await t.pronta
      const scrive = osserva(errore(applica(s, a.firma)))
      await attendiLock(1, () => scrive.stato.finita)
      expect(scrive.stato.finita).toBe(false)
      t.rilascia()
      await t.fine
      const e = await scrive.esito
      expect(e.status).toBe(409)
      expect(e.body.error).toBe('ANTEPRIMA_SUPERATA')
      expect((await righeDb(l.legameId))[0].prezzo).toBe('10.000000')

      const b = await anteprima(s)
      expect(b.differenze[0].prezzoDopo).toBe('13.000000')
      await applica(s, b.firma)
      expect((await righeDb(l.legameId))[0].prezzo).toBe('13.000000')
    })
  })

  // -------------------------------------------------------------------------------------------
  describe('liste grandi e piano generico', () => {
    const N = 5000
    /** Piano generico per il ruolo applicativo e statistiche che stimano una riga sola. */
    async function conPianoGenerico<R>(tabelle: string[], fn: () => Promise<R>): Promise<R> {
      await owner.$executeRaw`ALTER ROLE wasteflow_app SET plan_cache_mode = force_generic_plan`
      try {
        for (const t of tabelle) {
          await owner.$executeRawUnsafe(
            `DELETE FROM pg_statistic WHERE starelid = '${t}'::regclass`
          )
          await owner.$executeRawUnsafe(
            `UPDATE pg_class SET reltuples = 1, relpages = 100000 WHERE oid = '${t}'::regclass`
          )
        }
        await app.$disconnect()
        await app.$connect()
        return await fn()
      } finally {
        await owner.$executeRaw`ALTER ROLE wasteflow_app RESET plan_cache_mode`
        for (const t of tabelle) await owner.$executeRawUnsafe(`ANALYZE ${t}`)
        await app.$disconnect()
        await app.$connect()
      }
    }

    it('5000 legami con piano generico forzato: anteprima e applica sotto 10 s, una UPDATE sulle righe e una sui legami (versione)', async () => {
      const s = await scenario()
      await owner.wasteMovement.createMany({
        data: Array.from({ length: N }, (_, i) => ({
          tenantId: s.tenantId,
          registroId: s.registroId,
          progressiveYear: 2027,
          progressiveNumber: i + 1,
          type: 'CARICO' as const,
          movementDate: new Date('2027-03-01T10:00:00Z'),
          registrationDate: new Date('2027-03-01T10:00:00Z'),
          causale: 'INGRESSO_ESTERNO',
          cerCode: '20 03 01',
          quantity: '10',
          unit: 'KG',
          tipoAnnotazione: 'ORDINARIA' as const,
        })),
      })
      await owner.$executeRaw`
        INSERT INTO legami_movimento
          (tenant_id, registro_id, verso, movimento_originale_id, movimento_vigente_id, stato,
           data_movimento, cliente_id, contratto_id, elenco_id, updated_at)
        SELECT m.tenant_id, m.registro_id, m.type, m.id, m.id, 'CONFERMATO'::stato_legame_movimento,
               '2027-03-01'::date, ${s.clienteId}::uuid, ${s.contrattoId}::uuid, ${s.elencoId}::uuid, now()
        FROM waste_movements m
        WHERE m.tenant_id = ${s.tenantId}::uuid AND m.progressive_year = 2027`
      await owner.$executeRaw`
        INSERT INTO righe_legame_movimento
          (tenant_id, legame_id, elenco_id, riga_addebito_id, ordine, origine, tipo, descrizione,
           tipo_quantita, unita_misura, quantita, quantita_origine, prezzo_speciale, prezzo,
           prezzo_manuale, codice_iva_id, aliquota_iva, natura_iva, updated_at)
        SELECT l.tenant_id, l.id, ra.elenco_id, ra.id, 1, 'PRINCIPALE'::origine_riga_legame, ra.tipo,
               ra.descrizione, ra.tipo_quantita, ra.unita_misura, 10, 'DA_MOVIMENTO'::origine_quantita_legame,
               false, 10, false, ci.id, ci.aliquota, ci.natura, now()
        FROM legami_movimento l, righe_addebito ra, codici_iva ci
        WHERE l.tenant_id = ${s.tenantId}::uuid AND ra.id = ${s.rigaCerId}::uuid
          AND ci.id = ${s.ivaId}::uuid`
      expect(await owner.legameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(N)
      await prezzoListino(s.rigaCerId, '12.000000')

      let msAnteprima = -1
      let msApplica = -1
      const aggiornamentiRighe: string[] = []
      const aggiornamentiLegami: string[] = []
      const originale = app.$transaction.bind(app) as (...a: unknown[]) => Promise<unknown>
      const spia = jest.spyOn(app, '$transaction').mockImplementation(((
        fn: unknown,
        opz: unknown
      ) =>
        originale(async (tx: Prisma.TransactionClient) => {
          const proxy = new Proxy(tx, {
            get(t, p, r) {
              const v = Reflect.get(t, p, r)
              if (p === '$executeRaw') {
                return (strings: TemplateStringsArray, ...resto: unknown[]) => {
                  const testo = strings.join('?')
                  if (/UPDATE righe_legame_movimento/.test(testo)) aggiornamentiRighe.push(testo)
                  if (/UPDATE legami_movimento/.test(testo)) aggiornamentiLegami.push(testo)
                  return (v as (...x: unknown[]) => unknown).call(t, strings, ...resto)
                }
              }
              return typeof v === 'function' ? (v as (...x: unknown[]) => unknown).bind(t) : v
            },
          })
          return (fn as (t: Prisma.TransactionClient) => Promise<unknown>)(proxy)
        }, opz)) as never)
      try {
        await conPianoGenerico(
          [
            'legami_movimento',
            'righe_legame_movimento',
            'righe_addebito',
            'elenchi_addebiti',
            'waste_movements',
          ],
          async () => {
            const t0 = Date.now()
            const a = await anteprima(s)
            msAnteprima = Date.now() - t0
            expect(a.cambiano).toBe(N)
            expect(a.differenze.length).toBeLessThanOrEqual(200)
            const t1 = Date.now()
            const esito = await applica(s, a.firma)
            msApplica = Date.now() - t1
            expect(esito.aggiornati).toBe(N)
          }
        )
      } finally {
        spia.mockRestore()
      }
      console.info(
        `[T17] 5000 legami, piano generico: anteprima ${msAnteprima} ms, applica ${msApplica} ms`
      )
      expect(msAnteprima).toBeLessThan(10_000)
      expect(msApplica).toBeLessThan(10_000)
      expect(aggiornamentiRighe).toHaveLength(1)
      expect(aggiornamentiLegami).toHaveLength(1)
      const n = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM righe_legame_movimento
        WHERE tenant_id = ${s.tenantId}::uuid AND prezzo = 12`
      expect(n[0].n).toBe(N)
    }, 120_000)
  })
})
