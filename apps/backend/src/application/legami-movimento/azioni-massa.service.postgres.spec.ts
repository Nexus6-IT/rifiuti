/**
 * Azioni di massa e generazione del legame da un movimento (fase 4.3, Task 19) contro un Postgres
 * reale, collegato COME `wasteflow_app`. Il proprietario prepara lo scenario e legge lo stato
 * finale. Pulizia solo per id esatti (`onTenantCreato` -> `tenantCreati`). Le barriere guardano
 * `pg_stat_activity` (sessioni di QUESTO processo, `wait_event_type = 'Lock'`): niente `sleep`
 * come sincronizzazione.
 */
import { HttpException } from '@nestjs/common'
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
const NOME_APPLICAZIONE = `legami-t19-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { TenantContext } from '../../core/context/tenant-context'
import {
  MOTIVO_ESCLUSIONE_CAUSALE,
  MOTIVO_ESCLUSIONE_DATA,
} from '../../domain/legami-movimento/codici'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  creaLegameDiTest,
  creaMovimentoDiTest,
  creaScenarioProposta,
  pulisciTenantDiTest,
  type ScenarioProposta,
} from '../../test-support/legami-di-test'
import { creaRiga } from '../../test-support/listino-di-test'
import { AzioniMassaService } from './azioni-massa.service'
import { LegamiService } from './conferma-legame.service'
import { leggiTestaCatena } from './letture-legame'
import { bloccaLegamePerRadice } from './lock-legame'
import { PropostaLegameService, type InputProposta } from './proposta-legame.service'

interface Eccezione {
  status: number
  body: Record<string, unknown>
}

describe('AzioniMassaService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let proposta: PropostaLegameService
  let legami: LegamiService
  let service: AzioniMassaService
  const tenantCreati: string[] = []

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    proposta = new PropostaLegameService(app)
    legami = new LegamiService(app, proposta)
    service = new AzioniMassaService(app, proposta, legami)
  })

  afterAll(async () => {
    await pulisciTenantDiTest(owner, tenantCreati)
    await owner.$disconnect()
    await app?.$disconnect()
  }, 180_000)

  /** Scenario con «fatturazione da» al 1 gennaio 2026 (CER 20 03 01 con la sua riga CER). */
  async function scenario(): Promise<ScenarioProposta> {
    const s = await creaScenarioProposta(owner, {
      righeV: 0,
      onTenantCreato: id => tenantCreati.push(id),
    })
    await owner.impostazioneFatturazione.create({
      data: { tenantId: s.tenantId, fatturazioneDa: new Date('2026-01-01T00:00:00Z') },
    })
    return s
  }

  const input = (s: ScenarioProposta, o: Partial<InputProposta> = {}): InputProposta => ({
    causale: 'INGRESSO_ESTERNO',
    type: 'CARICO',
    cerCode: '20 03 01',
    movementDate: '2026-03-01',
    unit: 'KG',
    quantity: '100',
    firId: s.firId,
    ...o,
  })

  /** Scrive la proposta del movimento e restituisce l'id del legame. */
  async function proponi(
    s: ScenarioProposta,
    movimentoId: string,
    o: Partial<InputProposta> = {}
  ): Promise<string> {
    const r = await nel(s.tenantId, () =>
      app.$transaction(
        tx =>
          proposta.proponiEScrivi(tx, {
            tenantId: s.tenantId,
            userId: s.utenteId,
            registroId: s.registroId,
            verso: 'CARICO',
            movimentoOriginaleId: movimentoId,
            movimentoVigenteId: movimentoId,
            input: input(s, o),
          }),
        { timeout: 60_000, maxWait: 30_000 }
      )
    )
    if (!r.legameId) throw new Error('proponi: nessun legame scritto')
    return r.legameId
  }

  /** Nuovo movimento dello scenario (stesso FIR, stesso registro). */
  const nuovoMovimento = (s: ScenarioProposta, o: Parameters<typeof creaMovimentoDiTest>[2] = {}) =>
    creaMovimentoDiTest(owner, s.tenantId, { firId: s.firId, ...o })

  /** Legame PROPOSTO completo (CER con la sua riga) su un movimento nuovo. */
  async function legameCompleto(
    s: ScenarioProposta
  ): Promise<{ movimentoId: string; legameId: string }> {
    const m = await nuovoMovimento(s)
    return { movimentoId: m.movimentoId, legameId: await proponi(s, m.movimentoId) }
  }

  /** Legame DA_COLLEGARE: il CER non ha riga di listino. */
  async function legameIncompleto(
    s: ScenarioProposta
  ): Promise<{ movimentoId: string; legameId: string }> {
    const m = await nuovoMovimento(s, { cerCode: '15 01 01' })
    return {
      movimentoId: m.movimentoId,
      legameId: await proponi(s, m.movimentoId, { cerCode: '15 01 01' }),
    }
  }

  const legameDb = (id: string) =>
    owner.legameMovimento.findUniqueOrThrow({
      where: { id },
      include: { righe: { orderBy: { ordine: 'asc' } } },
    })

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

  /** Aggiunge una correzione alla testa della catena. */
  async function correggi(
    s: ScenarioProposta,
    tipo: 'RETTIFICA' | 'ANNULLAMENTO',
    radiceId: string,
    testaId: string,
    sovrascrive: { causale?: string; movementDate?: Date; cerCode?: string; quantity?: string } = {}
  ): Promise<string> {
    const origine = await owner.wasteMovement.findUniqueOrThrow({ where: { id: radiceId } })
    const ultimo = await owner.wasteMovement.aggregate({
      where: { registroId: origine.registroId, progressiveYear: 2026 },
      _max: { progressiveNumber: true },
    })
    const c = await owner.wasteMovement.create({
      data: {
        tenantId: s.tenantId,
        registroId: origine.registroId,
        progressiveYear: 2026,
        progressiveNumber: (ultimo._max.progressiveNumber ?? 0) + 1,
        type: origine.type,
        movementDate: sovrascrive.movementDate ?? origine.movementDate,
        causale: sovrascrive.causale ?? origine.causale,
        cerCode: sovrascrive.cerCode ?? origine.cerCode,
        quantity: sovrascrive.quantity ?? '90',
        unit: 'KG',
        firId: origine.firId,
        tipoAnnotazione: tipo,
        movimentoRettificatoId: testaId,
        movimentoOriginaleId: radiceId,
        motivoAnnotazione: 'prova',
      },
    })
    return c.id
  }

  const mancante = async (s: ScenarioProposta, o: Parameters<typeof creaMovimentoDiTest>[2] = {}) =>
    (await nuovoMovimento(s, o)).movimentoId

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

  /** Tiene il lock consultivo di una radice (sessione del proprietario) finche' non si chiama `rilascia`. */
  async function tieniLockRadice(radiceId: string): Promise<{ rilascia: () => Promise<void> }> {
    let rilascia!: () => void
    const tenuto = new Promise<void>(r => (rilascia = r))
    let preso!: () => void
    const presa = new Promise<void>(r => (preso = r))
    const tx = owner.$transaction(
      async t => {
        await bloccaLegamePerRadice(t, radiceId)
        preso()
        await tenuto
      },
      { timeout: 120_000, maxWait: 30_000 }
    )
    await presa
    return {
      rilascia: async () => {
        rilascia()
        await tx
      },
    }
  }

  // -------------------------------------------------------------------------------------------
  describe('esegui: CONFERMA', () => {
    it('3 proposte complete e 1 incompleta: riusciti 3, falliti 1 con codice e messaggio; l’incompleta non cambia', async () => {
      const s = await scenario()
      const ok = [await legameCompleto(s), await legameCompleto(s), await legameCompleto(s)]
      const no = await legameIncompleto(s)
      const r = await service.esegui(s.tenantId, s.utenteId, {
        azione: 'CONFERMA',
        elementi: [...ok, no].map(x => ({ legameId: x.legameId, versione: 1 })),
      })
      expect(r.riusciti).toBe(3)
      expect(r.falliti).toEqual([
        {
          legameId: no.legameId,
          codice: 'LEGAME_INCOMPLETO',
          messaggio: expect.any(String),
        },
      ])
      for (const x of ok) {
        const l = await legameDb(x.legameId)
        expect(l).toMatchObject({ stato: 'CONFERMATO', versione: 2, confermatoDa: s.utenteId })
        for (const riga of l.righe) expect(riga.congelataIl).not.toBeNull()
      }
      expect(await legameDb(no.legameId)).toMatchObject({ stato: 'DA_COLLEGARE', versione: 1 })
    })

    it('audit: una riga per legame confermato più il riepilogo con id e codici, senza testi liberi', async () => {
      const s = await scenario()
      const ok = [await legameCompleto(s), await legameCompleto(s)]
      const no = await legameIncompleto(s)
      await service.esegui(s.tenantId, s.utenteId, {
        azione: 'CONFERMA',
        elementi: [...ok, no].map(x => ({ legameId: x.legameId, versione: 1 })),
      })
      const singole = await owner.activityLog.count({
        where: { tenantId: s.tenantId, action: 'LEGAME_MOVIMENTO_CONFERMATO' },
      })
      expect(singole).toBe(2)
      const riepilogo = await owner.activityLog.findMany({
        where: { tenantId: s.tenantId, action: 'LEGAMI_AZIONE_MASSA' },
      })
      expect(riepilogo).toHaveLength(1)
      expect(riepilogo[0].userId).toBe(s.utenteId)
      expect(riepilogo[0].metadata).toEqual({
        azione: 'CONFERMA',
        richiesti: 3,
        riusciti: 2,
        falliti: [{ legameId: no.legameId, codice: 'LEGAME_INCOMPLETO' }],
      })
    })

    it('versione vecchia: VERSIONE_SUPERATA solo per quell’elemento; già CONFERMATO senza modifiche: riuscito, nulla scritto', async () => {
      const s = await scenario()
      const a = await legameCompleto(s)
      const b = await legameCompleto(s)
      const c = await legameCompleto(s)
      await legami.conferma(s.tenantId, s.utenteId, c.legameId, 1)
      const r = await service.esegui(s.tenantId, s.utenteId, {
        azione: 'CONFERMA',
        elementi: [
          { legameId: a.legameId, versione: 1 },
          { legameId: b.legameId, versione: 7 },
          { legameId: c.legameId, versione: 2 },
        ],
      })
      expect(r.riusciti).toBe(2)
      expect(r.falliti).toEqual([
        { legameId: b.legameId, codice: 'VERSIONE_SUPERATA', messaggio: expect.any(String) },
      ])
      expect((await legameDb(c.legameId)).versione).toBe(2)
      expect((await legameDb(b.legameId)).stato).toBe('PROPOSTO')
    })

    it('legame FATTURATO / ESCLUSO nell’elenco: STATO_LEGAME_NON_AMMESSO, gli altri proseguono', async () => {
      const s = await scenario()
      const ok = await legameCompleto(s)
      const m = await nuovoMovimento(s)
      const fatt = await creaLegameDiTest(owner, s.tenantId, {
        movimentoOriginaleId: m.movimentoId,
        registroId: m.registroId,
        verso: 'CARICO',
        stato: 'FATTURATO',
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
        righe: [{ rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100' }],
      })
      const r = await service.esegui(s.tenantId, s.utenteId, {
        azione: 'CONFERMA',
        elementi: [
          { legameId: fatt.legameId, versione: 1 },
          { legameId: ok.legameId, versione: 1 },
        ],
      })
      expect(r.riusciti).toBe(1)
      expect(r.falliti).toEqual([
        {
          legameId: fatt.legameId,
          codice: 'STATO_LEGAME_NON_AMMESSO',
          messaggio: expect.any(String),
        },
      ])
      expect((await legameDb(fatt.legameId)).stato).toBe('FATTURATO')
    })

    it('id di un altro tenant o inesistente: non trovato; il legame dell’altro tenant non cambia', async () => {
      const s1 = await scenario()
      const s2 = await scenario()
      const mio = await legameCompleto(s1)
      const altrui = await legameCompleto(s2)
      const inesistente = '00000000-0000-4000-8000-000000000001'
      const r = await service.esegui(s1.tenantId, s1.utenteId, {
        azione: 'CONFERMA',
        elementi: [
          { legameId: altrui.legameId, versione: 1 },
          { legameId: mio.legameId, versione: 1 },
          { legameId: inesistente, versione: 1 },
        ],
      })
      expect(r.riusciti).toBe(1)
      expect(r.falliti.map(f => [f.legameId, f.codice]).sort()).toEqual(
        [
          [altrui.legameId, 'LEGAME_MOVIMENTO_NON_TROVATO'],
          [inesistente, 'LEGAME_MOVIMENTO_NON_TROVATO'],
        ].sort()
      )
      expect(await legameDb(altrui.legameId)).toMatchObject({ stato: 'PROPOSTO', versione: 1 })
    })
  })

  // -------------------------------------------------------------------------------------------
  describe('esegui: ESCLUDI', () => {
    it('3 legami (proposto, confermato, da collegare): tutti ESCLUSO col motivo senza spazi ai bordi', async () => {
      const s = await scenario()
      const a = await legameCompleto(s)
      const b = await legameCompleto(s)
      await legami.conferma(s.tenantId, s.utenteId, b.legameId, 1)
      const c = await legameIncompleto(s)
      const r = await service.esegui(s.tenantId, s.utenteId, {
        azione: 'ESCLUDI',
        motivo: '  Rifiuto in conto lavoro  ',
        elementi: [
          { legameId: a.legameId, versione: 1 },
          { legameId: b.legameId, versione: 2 },
          { legameId: c.legameId, versione: 1 },
        ],
      })
      expect(r).toEqual({ riusciti: 3, falliti: [] })
      for (const x of [a, b, c]) {
        expect(await legameDb(x.legameId)).toMatchObject({
          stato: 'ESCLUSO',
          motivoEsclusione: 'Rifiuto in conto lavoro',
        })
      }
    })

    it('un legame già ESCLUSO: STATO_LEGAME_NON_AMMESSO, gli altri vengono esclusi', async () => {
      const s = await scenario()
      const a = await legameCompleto(s)
      const b = await legameCompleto(s)
      await legami.escludi(s.tenantId, s.utenteId, a.legameId, 1, 'già escluso')
      const r = await service.esegui(s.tenantId, s.utenteId, {
        azione: 'ESCLUDI',
        motivo: 'Prova',
        elementi: [
          { legameId: a.legameId, versione: 2 },
          { legameId: b.legameId, versione: 1 },
        ],
      })
      expect(r.riusciti).toBe(1)
      expect(r.falliti).toEqual([
        { legameId: a.legameId, codice: 'STATO_LEGAME_NON_AMMESSO', messaggio: expect.any(String) },
      ])
      expect((await legameDb(a.legameId)).motivoEsclusione).toBe('già escluso')
    })

    it('richiesta non valida: 400 e nulla scritto (senza motivo, motivo automatico, 0 e 501 elementi)', async () => {
      const s = await scenario()
      const a = await legameCompleto(s)
      const el = [{ legameId: a.legameId, versione: 1 }]
      const e1 = await errore(
        service.esegui(s.tenantId, s.utenteId, { azione: 'ESCLUDI', elementi: el })
      )
      expect(e1).toMatchObject({ status: 400, body: { error: 'MOTIVO_ESCLUSIONE_NON_VALIDO' } })
      const e2 = await errore(
        service.esegui(s.tenantId, s.utenteId, {
          azione: 'ESCLUDI',
          motivo: MOTIVO_ESCLUSIONE_CAUSALE,
          elementi: el,
        })
      )
      expect(e2.status).toBe(400)
      const e3 = await errore(
        service.esegui(s.tenantId, s.utenteId, { azione: 'CONFERMA', elementi: [] })
      )
      expect(e3).toMatchObject({ status: 400, body: { error: 'ELEMENTI_NON_VALIDI' } })
      const troppi = Array.from({ length: 501 }, (_, i) => ({
        legameId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        versione: 1,
      }))
      const e4 = await errore(
        service.esegui(s.tenantId, s.utenteId, { azione: 'CONFERMA', elementi: troppi })
      )
      expect(e4).toMatchObject({ status: 400, body: { error: 'TROPPI_ELEMENTI' } })
      expect(await legameDb(a.legameId)).toMatchObject({ stato: 'PROPOSTO', versione: 1 })
      expect(
        await owner.activityLog.count({
          where: { tenantId: s.tenantId, action: 'LEGAMI_AZIONE_MASSA' },
        })
      ).toBe(0)
    })
  })

  // -------------------------------------------------------------------------------------------
  describe('esegui: ordine dei lock e concorrenza', () => {
    it('gli elementi si elaborano per chiave del lock (hashtext della radice, poi id), qualunque sia l’ordine della richiesta', async () => {
      const s = await scenario()
      const lista = [
        await legameCompleto(s),
        await legameCompleto(s),
        await legameCompleto(s),
        await legameCompleto(s),
        await legameCompleto(s),
      ]
      const chiavi = await owner.$queryRaw<{ id: string; chiave: number }[]>`
        SELECT id::text AS id, hashtext(movimento_originale_id::text) AS chiave
        FROM legami_movimento WHERE tenant_id = ${s.tenantId}::uuid`
      const attesa = chiavi
        .sort((a, b) => a.chiave - b.chiave || (a.id < b.id ? -1 : 1))
        .map(c => c.id)
      const spia = jest.spyOn(legami, 'conferma')
      try {
        const richiesta = [...lista].reverse().map(x => ({ legameId: x.legameId, versione: 1 }))
        const r = await service.esegui(s.tenantId, s.utenteId, {
          azione: 'CONFERMA',
          elementi: richiesta,
        })
        expect(r.riusciti).toBe(5)
        expect(spia.mock.calls.map(c => c[2])).toEqual(attesa)
      } finally {
        spia.mockRestore()
      }
    })

    it('due azioni di massa sugli stessi legami in ordine opposto, ferme sullo stesso lock (serializzazione, non prova dell’ordine, quella è nel test con la spia): nessun deadlock, ogni legame vince una sola volta', async () => {
      const s = await scenario()
      const lista = [
        await legameCompleto(s),
        await legameCompleto(s),
        await legameCompleto(s),
        await legameCompleto(s),
      ]
      const righe = await owner.$queryRaw<{ id: string; radice: string; chiave: number }[]>`
        SELECT id::text AS id, movimento_originale_id::text AS radice,
               hashtext(movimento_originale_id::text) AS chiave
        FROM legami_movimento WHERE tenant_id = ${s.tenantId}::uuid`
      righe.sort((a, b) => a.chiave - b.chiave || (a.id < b.id ? -1 : 1))
      const lock = await tieniLockRadice(righe[0].radice)
      let finite = 0
      const el = lista.map(x => ({ legameId: x.legameId, versione: 1 }))
      const conferma = service
        .esegui(s.tenantId, s.utenteId, { azione: 'CONFERMA', elementi: el })
        .finally(() => finite++)
      const escludi = service
        .esegui(s.tenantId, s.utenteId, {
          azione: 'ESCLUDI',
          motivo: 'Prova',
          elementi: [...el].reverse(),
        })
        .finally(() => finite++)
      try {
        await attendiLock(2, () => finite > 0)
      } finally {
        await lock.rilascia()
      }
      const [rc, re] = await Promise.all([conferma, escludi])
      const codici = [...rc.falliti, ...re.falliti].map(f => f.codice)
      expect(codici.every(c => c === 'VERSIONE_SUPERATA')).toBe(true)
      expect(rc.riusciti + re.riusciti).toBe(4)
      expect(rc.falliti.length + re.falliti.length).toBe(4)
      const riuscitiConferma = new Set(
        (
          await owner.legameMovimento.findMany({
            where: { tenantId: s.tenantId, stato: 'CONFERMATO' },
          })
        ).map(l => l.id)
      )
      expect(riuscitiConferma.size).toBe(rc.riusciti)
      for (const x of lista) {
        const l = await legameDb(x.legameId)
        expect(['CONFERMATO', 'ESCLUSO']).toContain(l.stato)
        expect(l.versione).toBe(2)
      }
    }, 120_000)

    it('500 legami PROPOSTO: una richiesta di 500 conferme, un elemento per transazione (tempo misurato)', async () => {
      const s = await scenario()
      const ids: string[] = []
      for (let i = 0; i < 500; i++) {
        const m = await nuovoMovimento(s)
        const l = await creaLegameDiTest(owner, s.tenantId, {
          movimentoOriginaleId: m.movimentoId,
          registroId: m.registroId,
          verso: 'CARICO',
          stato: 'PROPOSTO',
          clienteId: s.clienteId,
          contrattoId: s.contrattoId,
          elencoId: s.elencoId,
          righe: [{ rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100' }],
        })
        ids.push(l.legameId)
      }
      const inizio = Date.now()
      const r = await service.esegui(s.tenantId, s.utenteId, {
        azione: 'CONFERMA',
        elementi: ids.map(legameId => ({ legameId, versione: 1 })),
      })
      const ms = Date.now() - inizio
      console.info(`azioni di massa: 500 conferme in ${ms} ms`)
      expect(r.falliti).toEqual([])
      expect(r.riusciti).toBe(500)
      expect(ms).toBeLessThan(120_000)
      expect(
        await owner.legameMovimento.count({ where: { tenantId: s.tenantId, stato: 'CONFERMATO' } })
      ).toBe(500)
    }, 600_000)
  })

  // -------------------------------------------------------------------------------------------
  describe('daMovimento: movimento senza legame (MANCANTE)', () => {
    it('movimento con tutto al suo posto: nasce PROPOSTO con cliente dal FIR e righe; audit LEGAME_MOVIMENTO_GENERATO', async () => {
      const s = await scenario()
      const movimentoId = await mancante(s)
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v).toMatchObject({
        stato: 'PROPOSTO',
        movimentoOriginaleId: movimentoId,
        movimentoVigenteId: movimentoId,
      })
      expect(v.cliente?.id).toBe(s.clienteId)
      expect(v.righe).toHaveLength(1)
      const l = await legameDb(v.id)
      expect(l).toMatchObject({ stato: 'PROPOSTO', versione: 1 })
      expect(l.righe[0].quantita?.toFixed()).toBe('100')
      expect(
        await owner.activityLog.count({
          where: { tenantId: s.tenantId, action: 'LEGAME_MOVIMENTO_GENERATO' },
        })
      ).toBe(1)
    })

    it('CER senza riga di listino: nasce DA_COLLEGARE con il motivo', async () => {
      const s = await scenario()
      const movimentoId = await mancante(s, { cerCode: '15 01 01' })
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v.stato).toBe('DA_COLLEGARE')
      expect(v.motivi).toContain('SENZA_RIGA_CER')
    })

    it('idempotente: seconda chiamata stesso legame, stessa versione, un solo audit di generazione', async () => {
      const s = await scenario()
      const movimentoId = await mancante(s)
      const v1 = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      const v2 = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v2.id).toBe(v1.id)
      expect(v2.versione).toBe(v1.versione)
      expect(await owner.legameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(1)
      expect(
        await owner.activityLog.count({
          where: { tenantId: s.tenantId, action: 'LEGAME_MOVIMENTO_GENERATO' },
        })
      ).toBe(1)
    })

    it('rifiuti: causale non fatturabile, data prima di «fatturazione da», fatturazione spenta, catena annullata, altro tenant', async () => {
      const s = await scenario()
      const nonFatt = await mancante(s, { causale: 'AVVIO_RECUPERO' })
      expect(await errore(service.daMovimento(s.tenantId, s.utenteId, nonFatt))).toMatchObject({
        status: 409,
        body: { error: 'CAUSALE_NON_FATTURABILE' },
      })
      const vecchio = await mancante(s, { movementDate: '2025-12-31' })
      expect(await errore(service.daMovimento(s.tenantId, s.utenteId, vecchio))).toMatchObject({
        status: 409,
        body: { error: 'MOVIMENTO_FUORI_FATTURAZIONE' },
      })
      const radice = await mancante(s)
      await correggi(s, 'ANNULLAMENTO', radice, radice)
      expect(await errore(service.daMovimento(s.tenantId, s.utenteId, radice))).toMatchObject({
        status: 409,
        body: { error: 'MOVIMENTO_ANNULLATO' },
      })
      await owner.impostazioneFatturazione.update({
        where: { tenantId: s.tenantId },
        data: { fatturazioneDa: null },
      })
      const dopo = await mancante(s)
      expect(await errore(service.daMovimento(s.tenantId, s.utenteId, dopo))).toMatchObject({
        status: 409,
        body: { error: 'MOVIMENTO_FUORI_FATTURAZIONE' },
      })
      expect(await owner.legameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(0)

      const altro = await scenario()
      expect(
        await errore(service.daMovimento(s.tenantId, s.utenteId, altro.movimentoId))
      ).toMatchObject({
        status: 404,
        body: { error: 'MOVIMENTO_NON_TROVATO' },
      })
      expect(
        await errore(service.daMovimento(s.tenantId, s.utenteId, 'non-un-uuid'))
      ).toMatchObject({ status: 404 })
    })

    it('due richieste insieme sullo stesso movimento (barriera sul lock della radice): un solo legame, stesso id', async () => {
      const s = await scenario()
      const movimentoId = await mancante(s)
      const lock = await tieniLockRadice(movimentoId)
      let finite = 0
      const a = service.daMovimento(s.tenantId, s.utenteId, movimentoId).finally(() => finite++)
      const b = service.daMovimento(s.tenantId, s.utenteId, movimentoId).finally(() => finite++)
      try {
        await attendiLock(2, () => finite > 0)
      } finally {
        await lock.rilascia()
      }
      const [va, vb] = await Promise.all([a, b])
      expect(va.id).toBe(vb.id)
      expect(await owner.legameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(1)
      expect(
        await owner.activityLog.count({
          where: { tenantId: s.tenantId, action: 'LEGAME_MOVIMENTO_GENERATO' },
        })
      ).toBe(1)
    }, 120_000)
  })

  // -------------------------------------------------------------------------------------------
  describe('daMovimento: legame rimasto indietro (DA_RIALLINEARE)', () => {
    it('PROPOSTO, rettifica di quantità: vigente nuovo, quantità ricalcolata, resta PROPOSTO', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      const testa = await correggi(s, 'RETTIFICA', movimentoId, movimentoId, { quantity: '90' })
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v).toMatchObject({
        id: legameId,
        stato: 'PROPOSTO',
        movimentoVigenteId: testa,
        versione: 2,
      })
      const l = await legameDb(legameId)
      expect(l.movimentoVigenteId).toBe(testa)
      expect(l.righe[0].quantita?.toFixed()).toBe('90')
      expect(l.righe[0].quantitaOrigine).toBe('DA_MOVIMENTO')
      expect(
        await owner.activityLog.count({
          where: { tenantId: s.tenantId, action: 'LEGAME_MOVIMENTO_ALLINEATO' },
        })
      ).toBe(1)
    })

    it('idempotente: seconda chiamata non scrive (versione e audit invariati)', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      await correggi(s, 'RETTIFICA', movimentoId, movimentoId)
      await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v.versione).toBe(2)
      expect((await legameDb(legameId)).versione).toBe(2)
      expect(
        await owner.activityLog.count({
          where: { tenantId: s.tenantId, action: 'LEGAME_MOVIMENTO_ALLINEATO' },
        })
      ).toBe(1)
    })

    it('CONFERMATO, rettifica di quantità: resta CONFERMATO, prezzo e congelamento invariati, quantità nuova', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      await legami.conferma(s.tenantId, s.utenteId, legameId, 1)
      const prima = await legameDb(legameId)
      const testa = await correggi(s, 'RETTIFICA', movimentoId, movimentoId, { quantity: '90' })
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v.stato).toBe('CONFERMATO')
      const l = await legameDb(legameId)
      expect(l.movimentoVigenteId).toBe(testa)
      expect(l.confermatoIl).toEqual(prima.confermatoIl)
      expect(l.righe[0].quantita?.toFixed()).toBe('90')
      expect(l.righe[0].prezzo?.toFixed()).toBe(prima.righe[0].prezzo?.toFixed())
      expect(l.righe[0].congelataIl).toEqual(prima.righe[0].congelataIl)
    })

    it('rettifica che cambia il CER: CONFERMATO torna PROPOSTO con CAMBIO_CER_DA_CONFERMARE e la riga del nuovo CER', async () => {
      const s = await scenario()
      await creaRiga(owner, s.tenantId, s.elencoId, {
        tipo: 'CER',
        cerCode: '15 01 01',
        codiceIvaId: s.ivaId,
      })
      const { movimentoId, legameId } = await legameCompleto(s)
      await legami.conferma(s.tenantId, s.utenteId, legameId, 1)
      await correggi(s, 'RETTIFICA', movimentoId, movimentoId, { cerCode: '15 01 01' })
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v.stato).toBe('PROPOSTO')
      expect(v.avvisi).toContain('CAMBIO_CER_DA_CONFERMARE')
      const l = await legameDb(legameId)
      expect(l.confermatoIl).toBeNull()
      expect(l.righe).toHaveLength(1)
      expect(l.righe[0].rigaAddebitoId).not.toBe(s.rigaCerId)
    })

    it('causale non più fatturabile: ESCLUSO col testo fisso, righe conservate', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      await correggi(s, 'RETTIFICA', movimentoId, movimentoId, { causale: 'AVVIO_RECUPERO' })
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v.stato).toBe('ESCLUSO')
      const l = await legameDb(legameId)
      expect(l.motivoEsclusione).toBe(MOTIVO_ESCLUSIONE_CAUSALE)
      expect(l.righe).toHaveLength(1)
    })

    it('data portata prima di «fatturazione da»: ESCLUSO col testo fisso della data', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      await correggi(s, 'RETTIFICA', movimentoId, movimentoId, {
        movementDate: new Date('2025-12-01T10:00:00Z'),
      })
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v.stato).toBe('ESCLUSO')
      const l = await legameDb(legameId)
      expect(l.motivoEsclusione).toBe(MOTIVO_ESCLUSIONE_DATA)
      expect(l.dataMovimento.toISOString().slice(0, 10)).toBe('2025-12-01')
    })

    it('ESCLUSO a mano: la rettifica aggiorna solo il vigente, il suo testo resta', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      await legami.escludi(s.tenantId, s.utenteId, legameId, 1, 'Non si fattura')
      const testa = await correggi(s, 'RETTIFICA', movimentoId, movimentoId)
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v.stato).toBe('ESCLUSO')
      const l = await legameDb(legameId)
      expect(l).toMatchObject({ motivoEsclusione: 'Non si fattura', movimentoVigenteId: testa })
    })

    it('annullamento di catena non fatturata: ANNULLATO, righe conservate', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      const testa = await correggi(s, 'ANNULLAMENTO', movimentoId, movimentoId)
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v.stato).toBe('ANNULLATO')
      const l = await legameDb(legameId)
      expect(l.movimentoVigenteId).toBe(testa)
      expect(l.righe).toHaveLength(1)
    })

    it('decisione 21: FATTURATO rimasto indietro, cambiano solo vigente e scostamento; stato, righe, prezzi e data identici', async () => {
      const s = await scenario()
      const m = await nuovoMovimento(s)
      const f = await creaLegameDiTest(owner, s.tenantId, {
        movimentoOriginaleId: m.movimentoId,
        registroId: m.registroId,
        verso: 'CARICO',
        stato: 'FATTURATO',
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
        righe: [
          { rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100', prezzo: '2.5' },
        ],
      })
      const prima = await legameDb(f.legameId)
      const testa = await correggi(s, 'RETTIFICA', m.movimentoId, m.movimentoId, {
        quantity: '10',
        causale: 'AVVIO_RECUPERO',
        movementDate: new Date('2025-06-01T10:00:00Z'),
      })
      const v = await service.daMovimento(s.tenantId, s.utenteId, m.movimentoId)
      expect(v.stato).toBe('FATTURATO')
      const l = await legameDb(f.legameId)
      expect(l.movimentoVigenteId).toBe(testa)
      expect(l.scostamentoDopoFattura).toBe(true)
      expect(l.scostamentoIl).not.toBeNull()
      expect(l).toMatchObject({
        stato: 'FATTURATO',
        clienteId: prima.clienteId,
        contrattoId: prima.contrattoId,
        elencoId: prima.elencoId,
        motivoEsclusione: null,
        dataMovimento: prima.dataMovimento,
        fatturatoIl: prima.fatturatoIl,
      })
      expect(l.righe.map(r => [r.quantita?.toFixed(), r.prezzo?.toFixed(), r.congelataIl])).toEqual(
        prima.righe.map(r => [r.quantita?.toFixed(), r.prezzo?.toFixed(), r.congelataIl])
      )
      // Anche con annullo: ancora lo stesso legame e nessun altro cambio.
      const annullo = await correggi(s, 'ANNULLAMENTO', m.movimentoId, testa)
      await service.daMovimento(s.tenantId, s.utenteId, m.movimentoId)
      const l2 = await legameDb(f.legameId)
      expect(l2).toMatchObject({ stato: 'FATTURATO', movimentoVigenteId: annullo })
    })

    it('catena lunga (rettifica, causale spenta, causale riaccesa, annullo): un solo legame, il vigente segue ogni testa; un id intermedio vale come la radice', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      const r1 = await correggi(s, 'RETTIFICA', movimentoId, movimentoId, { quantity: '80' })
      await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect((await legameDb(legameId)).movimentoVigenteId).toBe(r1)

      const r2 = await correggi(s, 'RETTIFICA', movimentoId, r1, { causale: 'AVVIO_RECUPERO' })
      await service.daMovimento(s.tenantId, s.utenteId, r1) // un movimento intermedio, non la testa
      expect(await legameDb(legameId)).toMatchObject({
        stato: 'ESCLUSO',
        movimentoVigenteId: r2,
        motivoEsclusione: MOTIVO_ESCLUSIONE_CAUSALE,
      })

      const r3 = await correggi(s, 'RETTIFICA', movimentoId, r2, { quantity: '70' })
      await service.daMovimento(s.tenantId, s.utenteId, r3)
      const dopoRiaccesa = await legameDb(legameId)
      expect(dopoRiaccesa).toMatchObject({
        stato: 'PROPOSTO',
        movimentoVigenteId: r3,
        motivoEsclusione: null,
      })
      expect(dopoRiaccesa.righe[0].quantita?.toFixed()).toBe('70')

      const r4 = await correggi(s, 'ANNULLAMENTO', movimentoId, r3)
      await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(await legameDb(legameId)).toMatchObject({ stato: 'ANNULLATO', movimentoVigenteId: r4 })
      expect(await owner.legameMovimento.count({ where: { tenantId: s.tenantId } })).toBe(1)
    })

    it('legame ANNULLATO e già allineato: seconda chiamata idempotente, versione invariata', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      await correggi(s, 'ANNULLAMENTO', movimentoId, movimentoId)
      const v1 = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      const v2 = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v1.stato).toBe('ANNULLATO')
      expect(v2.versione).toBe(v1.versione)
      expect((await legameDb(legameId)).versione).toBe(2)
    })
  })

  // -------------------------------------------------------------------------------------------
  describe('legame DA_RIALLINEARE: nessuna azione prima di aprirlo (I2)', () => {
    it('conferma e escludi singole: 409 LEGAME_DA_RIALLINEARE, legame invariato', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      await correggi(s, 'RETTIFICA', movimentoId, movimentoId)
      for (const f of [
        () => legami.conferma(s.tenantId, s.utenteId, legameId, 1),
        () => legami.escludi(s.tenantId, s.utenteId, legameId, 1, 'Prova'),
        () => legami.modifica(s.tenantId, s.utenteId, legameId, 1, {}),
      ]) {
        expect(await errore(f())).toMatchObject({
          status: 409,
          body: { error: 'LEGAME_DA_RIALLINEARE' },
        })
      }
      expect(await legameDb(legameId)).toMatchObject({ stato: 'PROPOSTO', versione: 1 })
      // Dopo il riallineamento (versione 2) la conferma passa.
      await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect((await legami.conferma(s.tenantId, s.utenteId, legameId, 2)).stato).toBe('CONFERMATO')
    })

    it('azione di massa: l’elemento indietro è un fallito, gli altri proseguono', async () => {
      const s = await scenario()
      const a = await legameCompleto(s)
      const b = await legameCompleto(s)
      await correggi(s, 'RETTIFICA', b.movimentoId, b.movimentoId)
      for (const azione of ['CONFERMA', 'ESCLUDI'] as const) {
        const r = await service.esegui(s.tenantId, s.utenteId, {
          azione,
          motivo: 'Prova',
          elementi: [
            { legameId: b.legameId, versione: 1 },
            ...(azione === 'ESCLUDI' ? [] : [{ legameId: a.legameId, versione: 1 }]),
          ],
        })
        expect(r.falliti).toEqual([
          { legameId: b.legameId, codice: 'LEGAME_DA_RIALLINEARE', messaggio: expect.any(String) },
        ])
        expect(r.riusciti).toBe(azione === 'CONFERMA' ? 1 : 0)
      }
      expect(await legameDb(b.legameId)).toMatchObject({ stato: 'PROPOSTO', versione: 1 })
    })
  })

  // -------------------------------------------------------------------------------------------
  describe('esegui: movimenti MANCANTI in un solo passo (I3)', () => {
    it('CONFERMA: proposta e conferma per ciascuno; incompleto resta DA_COLLEGARE, già presente e inesistente falliscono', async () => {
      const s = await scenario()
      const ok1 = await mancante(s)
      const ok2 = await mancante(s)
      const incompleto = await mancante(s, { cerCode: '15 01 01' })
      const giaPresente = (await legameCompleto(s)).movimentoId
      const inesistente = '00000000-0000-4000-8000-000000000002'
      const r = await service.esegui(s.tenantId, s.utenteId, {
        azione: 'CONFERMA',
        elementi: [],
        movimentoIds: [ok1, ok2, incompleto, giaPresente, inesistente],
      })
      expect(r.riusciti).toBe(2)
      const perMov = new Map(r.falliti.map(f => [f.movimentoId, f]))
      expect(perMov.get(incompleto)).toMatchObject({
        codice: 'LEGAME_INCOMPLETO',
        legameId: expect.any(String),
      })
      expect(perMov.get(giaPresente)).toMatchObject({
        codice: 'LEGAME_GIA_PRESENTE',
        legameId: null,
      })
      expect(perMov.get(inesistente)).toMatchObject({
        codice: 'MOVIMENTO_NON_TROVATO',
        legameId: null,
      })
      expect(r.falliti).toHaveLength(3)
      const legamiDb = await owner.legameMovimento.findMany({
        where: { tenantId: s.tenantId, movimentoOriginaleId: { in: [ok1, ok2, incompleto] } },
      })
      expect(legamiDb.map(l => l.stato).sort()).toEqual([
        'CONFERMATO',
        'CONFERMATO',
        'DA_COLLEGARE',
      ])
      expect(
        await owner.legameMovimento.count({
          where: { tenantId: s.tenantId, movimentoOriginaleId: giaPresente },
        })
      ).toBe(1)
    })

    it('ESCLUDI su MANCANTI e insieme a un legame esistente: tutti ESCLUSO col motivo', async () => {
      const s = await scenario()
      const m1 = await mancante(s)
      const esistente = await legameCompleto(s)
      const r = await service.esegui(s.tenantId, s.utenteId, {
        azione: 'ESCLUDI',
        motivo: 'Conto lavoro',
        elementi: [{ legameId: esistente.legameId, versione: 1 }],
        movimentoIds: [m1],
      })
      expect(r).toEqual({ riusciti: 2, falliti: [] })
      const l = await owner.legameMovimento.findFirstOrThrow({
        where: { tenantId: s.tenantId, movimentoOriginaleId: m1 },
      })
      expect(l).toMatchObject({ stato: 'ESCLUSO', motivoEsclusione: 'Conto lavoro' })
    })

    it('il tetto di 500 vale sul totale delle due liste; il movimento fuori fatturazione è un fallito con il suo codice', async () => {
      const s = await scenario()
      const lista = Array.from({ length: 250 }, (_, i) => ({
        legameId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        versione: 1,
      }))
      const mov = Array.from(
        { length: 251 },
        (_, i) => `00000000-0000-4000-9000-${String(i + 1).padStart(12, '0')}`
      )
      expect(
        await errore(
          service.esegui(s.tenantId, s.utenteId, {
            azione: 'CONFERMA',
            elementi: lista,
            movimentoIds: mov,
          })
        )
      ).toMatchObject({ status: 400, body: { error: 'TROPPI_ELEMENTI' } })
      const vecchio = await mancante(s, { movementDate: '2025-12-31' })
      const r = await service.esegui(s.tenantId, s.utenteId, {
        azione: 'CONFERMA',
        movimentoIds: [vecchio],
      })
      expect(r.falliti).toEqual([
        {
          legameId: null,
          movimentoId: vecchio,
          codice: 'MOVIMENTO_FUORI_FATTURAZIONE',
          messaggio: expect.any(String),
        },
      ])
    })
  })

  // -------------------------------------------------------------------------------------------
  describe('esegui: stati non ammessi e budget di tempo', () => {
    it('ESCLUDI su FATTURATO e IMPORTATO_FATTURATO, CONFERMA su ESCLUSO e ANNULLATO: STATO_LEGAME_NON_AMMESSO', async () => {
      const s = await scenario()
      const ids: string[] = []
      for (const stato of ['FATTURATO', 'IMPORTATO_FATTURATO', 'ESCLUSO', 'ANNULLATO'] as const) {
        const m = await nuovoMovimento(s)
        const l = await creaLegameDiTest(owner, s.tenantId, {
          movimentoOriginaleId: m.movimentoId,
          registroId: m.registroId,
          verso: 'CARICO',
          stato,
          clienteId: s.clienteId,
          contrattoId: s.contrattoId,
          elencoId: s.elencoId,
          righe: [{ rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100' }],
        })
        ids.push(l.legameId)
      }
      const escludi = await service.esegui(s.tenantId, s.utenteId, {
        azione: 'ESCLUDI',
        motivo: 'Prova',
        elementi: ids.slice(0, 2).map(legameId => ({ legameId, versione: 1 })),
      })
      expect(escludi.riusciti).toBe(0)
      expect(escludi.falliti.map(f => f.codice)).toEqual([
        'STATO_LEGAME_NON_AMMESSO',
        'STATO_LEGAME_NON_AMMESSO',
      ])
      const conferma = await service.esegui(s.tenantId, s.utenteId, {
        azione: 'CONFERMA',
        elementi: ids.slice(2).map(legameId => ({ legameId, versione: 1 })),
      })
      expect(conferma.riusciti).toBe(0)
      expect(conferma.falliti.map(f => f.codice)).toEqual([
        'STATO_LEGAME_NON_AMMESSO',
        'STATO_LEGAME_NON_AMMESSO',
      ])
    })

    it('budget esaurito: gli elementi restanti escono con TEMPO_SCADUTO, i riusciti restano', async () => {
      const s = await scenario()
      const lista = [await legameCompleto(s), await legameCompleto(s), await legameCompleto(s)]
      const originale = legami.conferma.bind(legami)
      const spia = jest.spyOn(legami, 'conferma').mockImplementation(async (...a) => {
        // Simula un elemento lento (non e' una sincronizzazione: consuma il budget).
        await new Promise(r => setTimeout(r, 150))
        return originale(...a)
      })
      try {
        const r = await service.esegui(
          s.tenantId,
          s.utenteId,
          { azione: 'CONFERMA', elementi: lista.map(x => ({ legameId: x.legameId, versione: 1 })) },
          { budgetMs: 100 }
        )
        expect(r.riusciti).toBe(1)
        expect(r.falliti.map(f => f.codice)).toEqual(['TEMPO_SCADUTO', 'TEMPO_SCADUTO'])
        expect(
          await owner.legameMovimento.count({
            where: { tenantId: s.tenantId, stato: 'CONFERMATO' },
          })
        ).toBe(1)
      } finally {
        spia.mockRestore()
      }
    })
  })

  // -------------------------------------------------------------------------------------------
  describe('allineaAlVigente: rami del dominio (I1, I4)', () => {
    it('I1: CONFERMATO con cliente disattivato, rettifica di sola quantità nello stesso giorno: resta CONFERMATO, quantità nuova, confermato_il invariato', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      await legami.conferma(s.tenantId, s.utenteId, legameId, 1)
      const prima = await legameDb(legameId)
      await owner.cliente.update({ where: { id: s.clienteId }, data: { attivo: false } })
      const testa = await correggi(s, 'RETTIFICA', movimentoId, movimentoId, { quantity: '90' })
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v.stato).toBe('CONFERMATO')
      const l = await legameDb(legameId)
      expect(l.movimentoVigenteId).toBe(testa)
      expect(l.confermatoIl).toEqual(prima.confermatoIl)
      expect(l.righe[0].quantita?.toFixed()).toBe('90')
      expect(l.righe[0].congelataIl).toEqual(prima.righe[0].congelataIl)
    })

    it('Review Focus 4: CONFERMATO, la data passa oltre la fine dell’elenco: DA_COLLEGARE con ELENCO_SCADUTO, data_movimento aggiornata a parità di CER', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      await legami.conferma(s.tenantId, s.utenteId, legameId, 1)
      await owner.elencoAddebiti.update({
        where: { id: s.elencoId },
        data: {
          validoDal: new Date('2026-01-01T00:00:00Z'),
          validoAl: new Date('2026-03-31T00:00:00Z'),
        },
      })
      await correggi(s, 'RETTIFICA', movimentoId, movimentoId, {
        movementDate: new Date('2026-04-15T10:00:00Z'),
      })
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v.stato).toBe('DA_COLLEGARE')
      expect(v.motivi).toContain('ELENCO_SCADUTO')
      const l = await legameDb(legameId)
      expect(l.confermatoIl).toBeNull()
      expect(l.dataMovimento.toISOString().slice(0, 10)).toBe('2026-04-15')
    })

    it('quantità MANUALE: resta e compare QUANTITA_MANUALE_NON_DERIVATA', async () => {
      const s = await scenario()
      const { movimentoId, legameId } = await legameCompleto(s)
      await legami.modifica(s.tenantId, s.utenteId, legameId, 1, {
        righe: [{ rigaAddebitoId: s.rigaCerId, quantita: '55' }],
      })
      await correggi(s, 'RETTIFICA', movimentoId, movimentoId, { quantity: '90' })
      const v = await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      expect(v.avvisi).toContain('QUANTITA_MANUALE_NON_DERIVATA')
      const l = await legameDb(legameId)
      expect(l.righe[0].quantita?.toFixed()).toBe('55')
      expect(l.righe[0].quantitaOrigine).toBe('MANUALE')
    })

    it('CER cambiato: il cliente scelto dall’utente resta e l’audit elenca i prezzi persi', async () => {
      const s = await scenario()
      await creaRiga(owner, s.tenantId, s.elencoId, {
        tipo: 'CER',
        cerCode: '15 01 01',
        codiceIvaId: s.ivaId,
      })
      const { movimentoId, legameId } = await legameCompleto(s)
      await owner.$executeRaw`
        UPDATE legami_movimento SET fonte_cliente = 'UTENTE' WHERE id = ${legameId}::uuid`
      await legami.conferma(s.tenantId, s.utenteId, legameId, 1)
      await correggi(s, 'RETTIFICA', movimentoId, movimentoId, { cerCode: '15 01 01' })
      await service.daMovimento(s.tenantId, s.utenteId, movimentoId)
      const l = await legameDb(legameId)
      expect(l.fonteCliente).toBe('UTENTE')
      expect(l.clienteId).toBe(s.clienteId)
      const audit = await owner.activityLog.findFirstOrThrow({
        where: { tenantId: s.tenantId, action: 'LEGAME_MOVIMENTO_ALLINEATO' },
      })
      const md = audit.metadata as { prezziManualiPersi?: { rigaAddebitoId: string }[] }
      expect(md.prezziManualiPersi).toHaveLength(1)
      expect(md.prezziManualiPersi?.[0].rigaAddebitoId).toBe(s.rigaCerId)
    })

    it('IMPORTATO_FATTURATO: solo vigente e scostamento, data e stato invariati', async () => {
      const s = await scenario()
      const m = await nuovoMovimento(s)
      const f = await creaLegameDiTest(owner, s.tenantId, {
        movimentoOriginaleId: m.movimentoId,
        registroId: m.registroId,
        verso: 'CARICO',
        stato: 'IMPORTATO_FATTURATO',
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
        righe: [{ rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100' }],
      })
      const prima = await legameDb(f.legameId)
      const testa = await correggi(s, 'RETTIFICA', m.movimentoId, m.movimentoId, {
        movementDate: new Date('2026-06-01T10:00:00Z'),
      })
      await service.daMovimento(s.tenantId, s.utenteId, m.movimentoId)
      const l = await legameDb(f.legameId)
      expect(l).toMatchObject({
        stato: 'IMPORTATO_FATTURATO',
        movimentoVigenteId: testa,
        scostamentoDopoFattura: true,
        dataMovimento: prima.dataMovimento,
      })
      expect(l.righe[0].quantita?.toFixed()).toBe('100')
    })

    it('riuso nel Task 21: utente null, esito dello scostamento per l’avviso', async () => {
      const s = await scenario()
      const m = await nuovoMovimento(s)
      const f = await creaLegameDiTest(owner, s.tenantId, {
        movimentoOriginaleId: m.movimentoId,
        registroId: m.registroId,
        verso: 'CARICO',
        stato: 'FATTURATO',
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
        righe: [{ rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100' }],
      })
      const testaId = await correggi(s, 'RETTIFICA', m.movimentoId, m.movimentoId)
      const esito = await nel(s.tenantId, () =>
        app.$transaction(async tx => {
          await bloccaLegamePerRadice(tx, m.movimentoId)
          const testa = await leggiTestaCatena(tx, s.tenantId, m.movimentoId)
          return legami.allineaAlVigente(tx, s.tenantId, null, f.legameId, testa!)
        })
      )
      expect(esito.scostamento).toBe(true)
      expect(esito.vista.movimentoVigenteId).toBe(testaId)
      const idem = await nel(s.tenantId, () =>
        app.$transaction(async tx => {
          const testa = await leggiTestaCatena(tx, s.tenantId, m.movimentoId)
          return legami.allineaAlVigente(tx, s.tenantId, null, f.legameId, testa!)
        })
      )
      expect(idem.scostamento).toBe(false)
    })
  })
})
