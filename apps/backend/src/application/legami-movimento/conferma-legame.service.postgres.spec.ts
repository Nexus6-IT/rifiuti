/**
 * Conferma, modifica, esclusione e riammissione del legame (fase 4.3, Task 16) contro un Postgres
 * reale, collegato COME `wasteflow_app`. Il proprietario prepara lo scenario e legge lo stato
 * finale. Pulizia solo per id esatti: l'id di ogni azienda si registra in `tenantCreati` appena
 * esiste (`onTenantCreato`), prima di ogni altra operazione che puo' fallire. Le barriere guardano
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
const NOME_APPLICAZIONE = `legami-t16-${process.pid}`
process.env.DATABASE_URL += `&application_name=${NOME_APPLICAZIONE}`

import { TenantContext } from '../../core/context/tenant-context'
import { MOTIVO_ESCLUSIONE_CAUSALE, type StatoLegame } from '../../domain/legami-movimento/codici'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import {
  creaLegameDiTest,
  creaMovimentoDiTest,
  creaScenarioProposta,
  pulisciLegamiDiTest,
  type ScenarioProposta,
} from '../../test-support/legami-di-test'
import { creaContrattoConElenco, creaRiga } from '../../test-support/listino-di-test'
import { LegamiService, type ModificheLegame } from './conferma-legame.service'
import { bloccaLegamePerRadice } from './lock-legame'
import { PropostaLegameService, type InputProposta } from './proposta-legame.service'

interface Eccezione {
  status: number
  body: Record<string, unknown>
}

describe('LegamiService (conferma, modifica, escludi, riammetti) — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let proposta: PropostaLegameService
  let service: LegamiService
  const tenantCreati: string[] = []

  const nel = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(() => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    proposta = new PropostaLegameService(app)
    service = new LegamiService(app, proposta)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await pulisciLegamiDiTest(owner, tenantCreati)
      await owner.impostazioneFatturazione.deleteMany({ where: { tenantId: { in: tenantCreati } } })
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

  /** Scenario con «fatturazione da» al 1 gennaio 2026: CER + `righeV` righe V, FIR dal cliente. */
  async function scenario(righeV = 1): Promise<ScenarioProposta> {
    const s = await creaScenarioProposta(owner, {
      righeV,
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

  /** Scrive la proposta del movimento (default: quello dello scenario) e restituisce l'id del legame. */
  async function proponi(
    s: ScenarioProposta,
    movimentoId = s.movimentoId,
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

  const conferma = (s: ScenarioProposta, id: string, v: number, m?: ModificheLegame) =>
    service.conferma(s.tenantId, s.utenteId, id, v, m)
  const modifica = (s: ScenarioProposta, id: string, v: number, m: ModificheLegame) =>
    service.modifica(s.tenantId, s.utenteId, id, v, m)

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

  const legameDb = (id: string) =>
    owner.legameMovimento.findUniqueOrThrow({
      where: { id },
      include: { righe: { orderBy: { ordine: 'asc' } } },
    })

  /** Riga del legame per riga di listino. */
  async function rigaDb(legameId: string, rigaAddebitoId: string) {
    return owner.rigaLegameMovimento.findFirstOrThrow({ where: { legameId, rigaAddebitoId } })
  }

  async function audit(tenantId: string, action: string) {
    return owner.activityLog.findMany({
      where: { tenantId, action },
      orderBy: { createdAt: 'asc' },
    })
  }

  /** Secondo contratto dello stesso cliente, con un suo elenco e la riga CER. */
  async function secondoContratto(s: ScenarioProposta) {
    const c = await creaContrattoConElenco(owner, s.tenantId, { clienteId: s.clienteId })
    const cer = await creaRiga(owner, s.tenantId, c.elencoId, {
      tipo: 'CER',
      cerCode: '20 03 01',
      codiceIvaId: s.ivaId,
    })
    return { ...c, rigaCerId: cer.id }
  }

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

  // -------------------------------------------------------------------------------------------
  describe('conferma', () => {
    it('PROPOSTO completo: CONFERMATO, righe congelate, prezzo/sconto/IVA dal listino, confermato_da', async () => {
      const s = await scenario(1)
      const id = await proponi(s)
      const v = await conferma(s, id, 1)
      expect(v).toMatchObject({ id, stato: 'CONFERMATO', versione: 2, motivi: [] })
      expect(v.confermatoIl).toEqual(expect.any(String))
      const l = await legameDb(id)
      expect(l).toMatchObject({ stato: 'CONFERMATO', versione: 2, confermatoDa: s.utenteId })
      expect(l.confermatoIl).not.toBeNull()
      expect(l.motivi).toEqual([])
      expect(l.righe).toHaveLength(2)
      for (const r of l.righe) {
        expect(r.congelataIl).not.toBeNull()
        expect(r.prezzo?.toFixed()).toBe('1')
        expect(r.sconto).toBeNull()
        expect(r.aliquotaIva.toFixed()).toBe('22')
        expect(r.codiceIvaId).toBe(s.ivaId)
        expect(r.quantita?.toFixed()).toBe('100')
        expect(r.prezzoManuale).toBe(false)
      }
    })

    it('riga a prezzo speciale: confermata con prezzo NULL', async () => {
      const s = await scenario(1)
      await owner.rigaAddebito.update({
        where: { id: s.righeVIds[0] },
        data: { prezzoSpeciale: true, prezzo: null },
      })
      const id = await proponi(s)
      await conferma(s, id, 1)
      const r = await rigaDb(id, s.righeVIds[0])
      expect(r).toMatchObject({ prezzoSpeciale: true, prezzo: null })
      expect(r.congelataIl).not.toBeNull()
      expect((await legameDb(id)).stato).toBe('CONFERMATO')
    })

    it('prezzo "0" esplicito sulla riga di listino: confermato', async () => {
      const s = await scenario(0)
      await owner.rigaAddebito.update({ where: { id: s.rigaCerId }, data: { prezzo: '0' } })
      const id = await proponi(s)
      await conferma(s, id, 1)
      const r = await rigaDb(id, s.rigaCerId)
      expect(r.prezzo?.toFixed()).toBe('0')
      expect((await legameDb(id)).stato).toBe('CONFERMATO')
    })

    it('riga senza prezzo e non speciale: 409 LEGAME_INCOMPLETO con SENZA_PREZZO, nulla scritto', async () => {
      const s = await scenario(0)
      // Una riga congelata senza prezzo (il listino non puo' averne: righe_addebito_prezzo_presente).
      const { legameId } = await creaLegameDiTest(owner, s.tenantId, {
        movimentoOriginaleId: s.movimentoId,
        registroId: s.registroId,
        verso: 'CARICO',
        stato: 'PROPOSTO',
        clienteId: s.clienteId,
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
        righe: [
          { rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100', prezzo: null },
        ],
      })
      await owner.$executeRaw`UPDATE righe_legame_movimento SET congelata_il = now() WHERE legame_id = ${legameId}::uuid`
      const e = await errore(conferma(s, legameId, 1))
      expect(e.status).toBe(409)
      expect(e.body).toMatchObject({
        error: 'LEGAME_INCOMPLETO',
        details: { motivi: ['SENZA_PREZZO'] },
      })
      const l = await legameDb(legameId)
      expect(l).toMatchObject({ stato: 'PROPOSTO', versione: 1, confermatoIl: null })
      expect(l.righe[0].prezzo).toBeNull()
    })

    it('modifiche e conferma in una richiesta (quantita manuale)', async () => {
      const s = await scenario(1)
      const id = await proponi(s)
      const v = await conferma(s, id, 1, {
        righe: [{ rigaAddebitoId: s.rigaCerId, quantita: '50' }],
      })
      expect(v.stato).toBe('CONFERMATO')
      const cer = await rigaDb(id, s.rigaCerId)
      expect(cer).toMatchObject({ quantitaOrigine: 'MANUALE' })
      expect(cer.quantita?.toFixed()).toBe('50')
      expect((await rigaDb(id, s.righeVIds[0])).quantita?.toFixed()).toBe('100')
    })

    it('cambiare contratto rigenera le righe (e il cambio di elenco con righe presenti non viola la FK)', async () => {
      const s = await scenario(1)
      const id = await proponi(s)
      const c2 = await secondoContratto(s)
      const v = await conferma(s, id, 1, { contrattoId: c2.contrattoId })
      expect(v.stato).toBe('CONFERMATO')
      const l = await legameDb(id)
      expect(l).toMatchObject({ contrattoId: c2.contrattoId, elencoId: c2.elencoId })
      expect(l.righe.map(r => r.rigaAddebitoId)).toEqual([c2.rigaCerId])
      expect(l.righe[0].elencoId).toBe(c2.elencoId)
    })

    it('cambiare cliente: fonte UTENTE e proposta rifatta sul nuovo cliente', async () => {
      const s = await scenario(1)
      const id = await proponi(s)
      const altro = await creaContrattoConElenco(owner, s.tenantId)
      const cer = await creaRiga(owner, s.tenantId, altro.elencoId, {
        tipo: 'CER',
        cerCode: '20 03 01',
        codiceIvaId: s.ivaId,
      })
      const v = await conferma(s, id, 1, { clienteId: altro.clienteId })
      expect(v.stato).toBe('CONFERMATO')
      const l = await legameDb(id)
      expect(l).toMatchObject({
        clienteId: altro.clienteId,
        fonteCliente: 'UTENTE',
        contrattoId: altro.contrattoId,
        elencoId: altro.elencoId,
      })
      expect(l.righe.map(r => r.rigaAddebitoId)).toEqual([cer.id])
    })

    it('Review 1: due conferme con la stessa versione si serializzano (barriera): una 200, una 409', async () => {
      const s = await scenario(1)
      const id = await proponi(s)
      let rilascia!: () => void
      const aperta = new Promise<void>(r => (rilascia = r))
      let bloccoPreso!: () => void
      const preso = new Promise<void>(r => (bloccoPreso = r))
      // Il lock consultivo della radice e' tenuto da fuori: le due conferme arrivano e aspettano.
      const tenitore = owner.$transaction(
        async tx => {
          await bloccaLegamePerRadice(tx, s.movimentoId)
          bloccoPreso()
          await aperta
        },
        { timeout: 60_000, maxWait: 30_000 }
      )
      await preso
      let finite = false
      const due = Promise.allSettled([conferma(s, id, 1), conferma(s, id, 1)]).finally(
        () => (finite = true)
      )
      await attendiLock(2, () => finite)
      rilascia()
      await tenitore
      const esiti = await due
      const riusciti = esiti.filter(e => e.status === 'fulfilled')
      const falliti = esiti.filter(e => e.status === 'rejected') as PromiseRejectedResult[]
      expect(riusciti).toHaveLength(1)
      expect(falliti).toHaveLength(1)
      expect(falliti[0].reason).toBeInstanceOf(HttpException)
      const ecc = falliti[0].reason as HttpException
      expect(ecc.getStatus()).toBe(409)
      expect(ecc.getResponse()).toMatchObject({ error: 'VERSIONE_SUPERATA' })
      const l = await legameDb(id)
      expect(l.versione).toBe(2)
      expect(l.righe).toHaveLength(2)
      expect(new Set(l.righe.map(r => r.rigaAddebitoId)).size).toBe(2)
      expect(l.righe.every(r => r.congelataIl !== null)).toBe(true)
    })

    it('conferma ripetuta su un legame gia CONFERMATO con la versione aggiornata: 200 idempotente', async () => {
      const s = await scenario(1)
      const id = await proponi(s)
      await conferma(s, id, 1)
      const prima = await legameDb(id)
      const v = await conferma(s, id, 2)
      expect(v).toMatchObject({ stato: 'CONFERMATO', versione: 2 })
      const dopo = await legameDb(id)
      expect(dopo.versione).toBe(2)
      expect(dopo.confermatoIl).toEqual(prima.confermatoIl)
      expect(dopo.righe.map(r => r.congelataIl)).toEqual(prima.righe.map(r => r.congelataIl))
      expect(await audit(s.tenantId, 'LEGAME_MOVIMENTO_CONFERMATO')).toHaveLength(1)
    })

    it('versione vecchia: 409 VERSIONE_SUPERATA; legame inesistente o di un altro tenant: 404', async () => {
      const s = await scenario(0)
      const altra = await scenario(0)
      const id = await proponi(s)
      const vecchia = await errore(conferma(s, id, 7))
      expect(vecchia).toMatchObject({ status: 409, body: { error: 'VERSIONE_SUPERATA' } })
      const inesistente = await errore(conferma(s, '00000000-0000-4000-8000-000000000001', 1))
      expect(inesistente).toMatchObject({
        status: 404,
        body: { error: 'LEGAME_MOVIMENTO_NON_TROVATO' },
      })
      const altrui = await errore(service.conferma(altra.tenantId, altra.utenteId, id, 1))
      expect(altrui.status).toBe(404)
      expect((await legameDb(id)).stato).toBe('PROPOSTO')
    })

    describe('Review 3: i dati cambiati fra la proposta e la conferma', () => {
      it('cliente disattivato: 409 con SENZA_CLIENTE e dettaglio «cliente disattivato», legame invariato', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        await owner.cliente.update({ where: { id: s.clienteId }, data: { attivo: false } })
        const e = await errore(conferma(s, id, 1))
        expect(e.status).toBe(409)
        expect(e.body).toMatchObject({
          error: 'LEGAME_INCOMPLETO',
          details: { motivi: ['SENZA_CLIENTE'], dettaglioCliente: 'cliente disattivato' },
        })
        const l = await legameDb(id)
        expect(l).toMatchObject({ stato: 'PROPOSTO', versione: 1, clienteId: s.clienteId })
        expect(l.righe).toHaveLength(2)
        expect(l.righe.every(r => r.congelataIl === null)).toBe(true)
      })

      it.each([
        ['SOSPESO', { stato: 'SOSPESO' as const }],
        ['BOZZA', { stato: 'BOZZA' as const }],
        [
          'ANNULLATO',
          { stato: 'ANNULLATO' as const, motivoAnnullo: 'prova', annullatoIl: new Date() },
        ],
        ['scaduto prima del movimento', { dataFine: new Date('2026-02-01T00:00:00Z') }],
      ])('contratto %s: 409 con CONTRATTO_NON_ATTIVO, nulla scritto', async (_nome, dati) => {
        const s = await scenario(1)
        const id = await proponi(s)
        await owner.contrattoCliente.update({ where: { id: s.contrattoId }, data: dati })
        const e = await errore(conferma(s, id, 1))
        expect(e.status).toBe(409)
        expect(e.body).toMatchObject({
          error: 'LEGAME_INCOMPLETO',
          details: { motivi: ['CONTRATTO_NON_ATTIVO'] },
        })
        expect(await legameDb(id)).toMatchObject({ stato: 'PROPOSTO', versione: 1 })
      })

      it('contratto eliminato: 409 con SENZA_CONTRATTO', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        await owner.contrattoCliente.update({
          where: { id: s.contrattoId },
          data: { eliminatoIl: new Date() },
        })
        const e = await errore(conferma(s, id, 1))
        expect(e).toMatchObject({
          status: 409,
          body: { error: 'LEGAME_INCOMPLETO', details: { motivi: ['SENZA_CONTRATTO'] } },
        })
        expect((await legameDb(id)).stato).toBe('PROPOSTO')
      })

      it('elenco con validoAl prima della data del movimento: 409 con ELENCO_SCADUTO', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        await owner.elencoAddebiti.update({
          where: { id: s.elencoId },
          data: {
            validoDal: new Date('2025-01-01T00:00:00Z'),
            validoAl: new Date('2026-02-01T00:00:00Z'),
          },
        })
        const e = await errore(conferma(s, id, 1))
        expect(e).toMatchObject({
          status: 409,
          body: { error: 'LEGAME_INCOMPLETO', details: { motivi: ['ELENCO_SCADUTO'] } },
        })
        const l = await legameDb(id)
        expect(l).toMatchObject({ stato: 'PROPOSTO', versione: 1 })
        expect(l.righe).toHaveLength(2)
      })

      it('contratto che scade DOPO la data del movimento ma prima di oggi: confermato (conta la data del movimento)', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        await owner.contrattoCliente.update({
          where: { id: s.contrattoId },
          data: { dataFine: new Date('2026-03-15T00:00:00Z') },
        })
        expect((await conferma(s, id, 1)).stato).toBe('CONFERMATO')
      })

      it('contratto di un’altra sede scelto: confermato con l’avviso CONTRATTO_ALTRA_SEDE', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        const altraSede = await owner.sedeDitta.create({
          data: {
            tenantId: s.tenantId,
            dittaId: s.dittaId,
            via: 'Via Altra',
            civico: '2',
            cap: '00100',
            comune: 'Roma',
            provincia: 'RM',
          },
        })
        await owner.contrattoCliente.update({
          where: { id: s.contrattoId },
          data: { sedeId: altraSede.id },
        })
        const v = await conferma(s, id, 1)
        expect(v.stato).toBe('CONFERMATO')
        expect(v.avvisi).toContain('CONTRATTO_ALTRA_SEDE')
        expect((await legameDb(id)).avvisi).toContain('CONTRATTO_ALTRA_SEDE')
      })

      it('scelta esplicita di un contratto annullato o di un altro cliente/tenant: 409 / 400 / 404', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        const altroCliente = await creaContrattoConElenco(owner, s.tenantId)
        const altroTenant = await scenario(0)
        const annullato = await secondoContratto(s)
        await owner.contrattoCliente.update({
          where: { id: annullato.contrattoId },
          data: { stato: 'ANNULLATO', motivoAnnullo: 'prova', annullatoIl: new Date() },
        })
        expect(
          await errore(modifica(s, id, 1, { contrattoId: annullato.contrattoId }))
        ).toMatchObject({
          status: 409,
          body: { error: 'LEGAME_INCOMPLETO', details: { motivi: ['CONTRATTO_NON_ATTIVO'] } },
        })
        expect(
          await errore(modifica(s, id, 1, { contrattoId: altroCliente.contrattoId }))
        ).toMatchObject({ status: 400, body: { error: 'CONTRATTO_NON_DEL_CLIENTE' } })
        expect(
          await errore(modifica(s, id, 1, { contrattoId: altroTenant.contrattoId }))
        ).toMatchObject({ status: 404, body: { error: 'CONTRATTO_CLIENTE_NON_TROVATO' } })
        expect(await errore(modifica(s, id, 1, { elencoId: altroCliente.elencoId }))).toMatchObject(
          { status: 400 }
        )
        expect(await legameDb(id)).toMatchObject({ versione: 1, contrattoId: s.contrattoId })
      })

      it('righe di un altro elenco: 400 RIGA_NON_DELL_ELENCO', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        const c2 = await secondoContratto(s)
        const e = await errore(
          modifica(s, id, 1, { righe: [{ rigaAddebitoId: c2.rigaCerId, quantita: '5' }] })
        )
        expect(e).toMatchObject({ status: 400, body: { error: 'RIGA_NON_DELL_ELENCO' } })
        expect((await legameDb(id)).righe).toHaveLength(2)
      })
    })

    describe('Review 5: quantita manuale', () => {
      it.each(['0', '0.000', '-3', '1,5', '1.2345', '', 'abc', ' 5'])(
        'quantita %p: 400 QUANTITA_NON_VALIDA, nulla scritto',
        async quantita => {
          const s = await scenario(0)
          const id = await proponi(s)
          const e = await errore(
            conferma(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, quantita }] })
          )
          expect(e).toMatchObject({ status: 400, body: { error: 'QUANTITA_NON_VALIDA' } })
          expect(await legameDb(id)).toMatchObject({ stato: 'PROPOSTO', versione: 1 })
        }
      )

      it('un numero JSON al posto della stringa: 400', async () => {
        const s = await scenario(0)
        const id = await proponi(s)
        const m = { righe: [{ rigaAddebitoId: s.rigaCerId, quantita: 5 as unknown as string }] }
        expect((await errore(modifica(s, id, 1, m))).status).toBe(400)
      })

      it.each([
        ['12.5', '12.5'],
        ['0.001', '0.001'],
        ['007.50', '7.5'],
      ])('quantita %p: ammessa, origine MANUALE', async (quantita, atteso) => {
        const s = await scenario(0)
        const id = await proponi(s)
        await conferma(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, quantita }] })
        const r = await rigaDb(id, s.rigaCerId)
        expect(r.quantita?.toFixed()).toBe(atteso)
        expect(r.quantitaOrigine).toBe('MANUALE')
      })

      it('la conferma ricalcola la quantita derivata dal movimento ma non quella MANUALE', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        await modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, quantita: '12.5' }] })
        // La V ha una quantita derivata "vecchia": la conferma la riallinea al movimento (100).
        await owner.$executeRaw`UPDATE righe_legame_movimento SET quantita = 999 WHERE legame_id = ${id}::uuid AND riga_addebito_id = ${s.righeVIds[0]}::uuid`
        await conferma(s, id, 2)
        expect((await rigaDb(id, s.rigaCerId)).quantita?.toFixed()).toBe('12.5')
        expect((await rigaDb(id, s.righeVIds[0])).quantita?.toFixed()).toBe('100')
      })

      it('quantita null: torna a quella derivata dal movimento', async () => {
        const s = await scenario(0)
        const id = await proponi(s)
        await modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, quantita: '12.5' }] })
        await modifica(s, id, 2, { righe: [{ rigaAddebitoId: s.rigaCerId, quantita: null }] })
        const r = await rigaDb(id, s.rigaCerId)
        expect(r.quantita?.toFixed()).toBe('100')
        expect(r.quantitaOrigine).toBe('DA_MOVIMENTO')
      })
    })

    describe('decisione 16: prezzo e sconto a mano', () => {
      it('prezzo "12.5" su PROPOSTO: prezzo_manuale, avviso PREZZO_MANUALE, resta PROPOSTO, audit con prima e dopo', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        const v = await modifica(s, id, 1, {
          righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: '12.5' }],
        })
        expect(v).toMatchObject({ stato: 'PROPOSTO', versione: 2 })
        expect(v.avvisi).toContain('PREZZO_MANUALE')
        const r = await rigaDb(id, s.rigaCerId)
        expect(r.prezzo?.toFixed()).toBe('12.5')
        expect(r.prezzoManuale).toBe(true)
        expect((await rigaDb(id, s.righeVIds[0])).prezzoManuale).toBe(false)
        expect((await legameDb(id)).avvisi).toContain('PREZZO_MANUALE')
        const log = await audit(s.tenantId, 'LEGAME_MOVIMENTO_MODIFICATO')
        expect(log).toHaveLength(1)
        expect(log[0].userId).toBe(s.utenteId)
        const meta = JSON.stringify(log[0].metadata)
        expect(meta).toContain('"12.5"')
        expect(meta).toContain(id)
        expect(log[0].metadata).toMatchObject({
          legameId: id,
          statoPrima: 'PROPOSTO',
          statoDopo: 'PROPOSTO',
          righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: { prima: '1', dopo: '12.5' } }],
        })
      })

      it('prezzo "0" esplicito: ammesso', async () => {
        const s = await scenario(0)
        const id = await proponi(s)
        await modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: '0' }] })
        const r = await rigaDb(id, s.rigaCerId)
        expect(r.prezzo?.toFixed()).toBe('0')
        expect(r.prezzoManuale).toBe(true)
      })

      it.each(['-1', '1,5', '1.1234567', '', 'x', '1e3'])(
        'prezzo %p: 400 PREZZO_NON_VALIDO',
        async prezzo => {
          const s = await scenario(0)
          const id = await proponi(s)
          const e = await errore(
            modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, prezzo }] })
          )
          expect(e).toMatchObject({ status: 400, body: { error: 'PREZZO_NON_VALIDO' } })
          expect((await legameDb(id)).versione).toBe(1)
        }
      )

      it('un prezzo numero JSON: 400', async () => {
        const s = await scenario(0)
        const id = await proponi(s)
        const m = { righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: 12.5 as unknown as string }] }
        expect((await errore(modifica(s, id, 1, m))).status).toBe(400)
      })

      it('sconto: formula valida salvata, formula non valida 400, null lo toglie', async () => {
        const s = await scenario(0)
        const id = await proponi(s)
        await modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, sconto: '10+5' }] })
        const r = await rigaDb(id, s.rigaCerId)
        expect(r).toMatchObject({ sconto: '10+5', prezzoManuale: true })
        const e = await errore(
          modifica(s, id, 2, { righe: [{ rigaAddebitoId: s.rigaCerId, sconto: 'abc' }] })
        )
        expect(e).toMatchObject({ status: 400, body: { error: 'SCONTO_NON_VALIDO' } })
        await modifica(s, id, 2, { righe: [{ rigaAddebitoId: s.rigaCerId, sconto: null }] })
        expect((await rigaDb(id, s.rigaCerId)).sconto).toBeNull()
      })

      it('prezzo manuale su CONFERMATO: resta CONFERMATO, prezzo nuovo, congelata_il invariata, audit', async () => {
        const s = await scenario(0)
        const id = await proponi(s)
        await conferma(s, id, 1)
        const prima = await rigaDb(id, s.rigaCerId)
        const v = await modifica(s, id, 2, {
          righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: '7.25' }],
        })
        expect(v).toMatchObject({ stato: 'CONFERMATO', versione: 3 })
        const dopo = await rigaDb(id, s.rigaCerId)
        expect(dopo.prezzo?.toFixed()).toBe('7.25')
        expect(dopo.prezzoManuale).toBe(true)
        expect(dopo.congelataIl).toEqual(prima.congelataIl)
        expect((await legameDb(id)).confermatoIl).not.toBeNull()
        expect(await audit(s.tenantId, 'LEGAME_MOVIMENTO_MODIFICATO')).toHaveLength(1)
      })

      it('prezzo manuale su una riga a prezzo speciale: 400', async () => {
        const s = await scenario(1)
        await owner.rigaAddebito.update({
          where: { id: s.righeVIds[0] },
          data: { prezzoSpeciale: true, prezzo: null },
        })
        const id = await proponi(s)
        const e = await errore(
          modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.righeVIds[0], prezzo: '3' }] })
        )
        expect(e).toMatchObject({
          status: 400,
          body: { error: 'PREZZO_SPECIALE_NON_MODIFICABILE' },
        })
        expect((await legameDb(id)).versione).toBe(1)
      })

      it('solo lo sconto su una riga senza prezzo: 400 (il prezzo manuale richiede un prezzo)', async () => {
        const s = await scenario(0)
        const { legameId } = await creaLegameDiTest(owner, s.tenantId, {
          movimentoOriginaleId: s.movimentoId,
          registroId: s.registroId,
          verso: 'CARICO',
          stato: 'DA_COLLEGARE',
          clienteId: s.clienteId,
          contrattoId: s.contrattoId,
          elencoId: s.elencoId,
          righe: [
            { rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100', prezzo: null },
          ],
        })
        await owner.$executeRaw`UPDATE righe_legame_movimento SET congelata_il = now() WHERE legame_id = ${legameId}::uuid`
        const e = await errore(
          modifica(s, legameId, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, sconto: '10' }] })
        )
        expect(e).toMatchObject({ status: 400, body: { error: 'PREZZO_NON_VALIDO' } })
      })

      it.each(['FATTURATO', 'IMPORTATO_FATTURATO', 'ANNULLATO', 'ESCLUSO'] as StatoLegame[])(
        'legame %s: modifica, conferma ed escludi -> 409, nulla scritto',
        async stato => {
          const s = await scenario(0)
          const { legameId } = await creaLegameDiTest(owner, s.tenantId, {
            movimentoOriginaleId: s.movimentoId,
            registroId: s.registroId,
            verso: 'CARICO',
            stato,
            clienteId: s.clienteId,
            contrattoId: s.contrattoId,
            elencoId: s.elencoId,
            righe: [{ rigaAddebitoId: s.rigaCerId, codiceIvaId: s.ivaId, quantita: '100' }],
          })
          const m = { righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: '5' }] }
          // Una alla volta (funzioni, non promesse gia' partite): ogni tentativo e' una prova.
          for (const tenta of [
            () => modifica(s, legameId, 1, m),
            () => conferma(s, legameId, 1),
            () => service.escludi(s.tenantId, s.utenteId, legameId, 1, 'motivo'),
          ]) {
            const e = await errore(tenta())
            expect(e).toMatchObject({ status: 409, body: { error: 'STATO_LEGAME_NON_AMMESSO' } })
          }
          const l = await legameDb(legameId)
          expect(l.versione).toBe(1)
          expect(l.righe[0].prezzo?.toFixed()).toBe('1')
          expect(l.righe[0].prezzoManuale).toBe(false)
        }
      )

      it('la conferma non sovrascrive un prezzo manuale col prezzo di listino (le altre righe si riallineano)', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        await modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: '12.5' }] })
        await owner.rigaAddebito.update({ where: { id: s.rigaCerId }, data: { prezzo: '2' } })
        await owner.rigaAddebito.update({ where: { id: s.righeVIds[0] }, data: { prezzo: '3' } })
        await conferma(s, id, 2)
        expect((await rigaDb(id, s.rigaCerId)).prezzo?.toFixed()).toBe('12.5')
        expect((await rigaDb(id, s.righeVIds[0])).prezzo?.toFixed()).toBe('3')
        expect((await legameDb(id)).avvisi).toContain('PREZZO_MANUALE')
      })

      it('PREZZO_MANUALE resta finche c’e una riga manuale; sparisce quando le togli tutte', async () => {
        const s = await scenario(2)
        const [v1, v2] = s.righeVIds
        const id = await proponi(s)
        await modifica(s, id, 1, {
          righe: [
            { rigaAddebitoId: v1, prezzo: '4' },
            { rigaAddebitoId: v2, prezzo: '5' },
          ],
        })
        await modifica(s, id, 2, { righe: [{ rigaAddebitoId: v1, rimuovi: true }] })
        let l = await legameDb(id)
        expect(l.righe.map(r => r.rigaAddebitoId).sort()).toEqual([s.rigaCerId, v2].sort())
        expect(l.avvisi).toContain('PREZZO_MANUALE')
        await modifica(s, id, 3, { righe: [{ rigaAddebitoId: v2, rimuovi: true }] })
        l = await legameDb(id)
        expect(l.righe.map(r => r.rigaAddebitoId)).toEqual([s.rigaCerId])
        expect(l.avvisi).not.toContain('PREZZO_MANUALE')
      })

      it('togli e riaggiungi la riga: torna il prezzo di listino (prezzo_manuale azzerato)', async () => {
        const s = await scenario(1)
        const v1 = s.righeVIds[0]
        const id = await proponi(s)
        await modifica(s, id, 1, { righe: [{ rigaAddebitoId: v1, prezzo: '4' }] })
        await modifica(s, id, 2, { righe: [{ rigaAddebitoId: v1, rimuovi: true }] })
        await modifica(s, id, 3, { righe: [{ rigaAddebitoId: v1 }] })
        const r = await rigaDb(id, v1)
        expect(r.prezzoManuale).toBe(false)
        expect(r.prezzo?.toFixed()).toBe('1')
      })

      it('togliere tutte le righe: 400 RIGHE_VUOTE', async () => {
        const s = await scenario(0)
        const id = await proponi(s)
        const e = await errore(
          modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, rimuovi: true }] })
        )
        expect(e).toMatchObject({ status: 400, body: { error: 'RIGHE_VUOTE' } })
      })

      it('cambiare elenco o contratto: righe rigenerate dal listino, prezzo_manuale false, avviso tolto', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        await modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: '12.5' }] })
        const c2 = await secondoContratto(s)
        const v = await modifica(s, id, 2, { contrattoId: c2.contrattoId })
        expect(v.avvisi).not.toContain('PREZZO_MANUALE')
        const l = await legameDb(id)
        expect(l.righe.map(r => r.rigaAddebitoId)).toEqual([c2.rigaCerId])
        expect(l.righe[0]).toMatchObject({ prezzoManuale: false })
        expect(l.righe[0].prezzo?.toFixed()).toBe('1')
        expect(l.avvisi).not.toContain('PREZZO_MANUALE')
      })

      it('modifica concorrente dello stesso prezzo con la stessa versione: una 200, una 409', async () => {
        const s = await scenario(0)
        const id = await proponi(s)
        const m = { righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: '9' }] }
        const esiti = await Promise.allSettled([modifica(s, id, 1, m), modifica(s, id, 1, m)])
        expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
        const rifiutato = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
        expect((rifiutato.reason as HttpException).getStatus()).toBe(409)
        expect((await legameDb(id)).versione).toBe(2)
      })
    })

    it('DA_COLLEGARE senza cliente: la scelta del cliente lo porta a PROPOSTO', async () => {
      const s = await scenario(0)
      const senzaFir = await creaMovimentoDiTest(owner, s.tenantId, { cerCode: '20 03 01' })
      const id = await proponi(s, senzaFir.movimentoId, { firId: null })
      expect(await legameDb(id)).toMatchObject({ stato: 'DA_COLLEGARE', clienteId: null })
      const v = await modifica(s, id, 1, { clienteId: s.clienteId })
      expect(v.stato).toBe('PROPOSTO')
      expect(await legameDb(id)).toMatchObject({
        clienteId: s.clienteId,
        fonteCliente: 'UTENTE',
        contrattoId: s.contrattoId,
        elencoId: s.elencoId,
      })
      expect(v.motivi).toEqual([])
    })

    it('CONFERMATO: cambiare contratto torna a PROPOSTO con le righe non congelate', async () => {
      const s = await scenario(1)
      const id = await proponi(s)
      await conferma(s, id, 1)
      const c2 = await secondoContratto(s)
      const v = await modifica(s, id, 2, { contrattoId: c2.contrattoId })
      expect(v.stato).toBe('PROPOSTO')
      const l = await legameDb(id)
      expect(l.confermatoIl).toBeNull()
      expect(l.righe.every(r => r.congelataIl === null)).toBe(true)
    })

    describe('decisione 20: righe aggiunte o tolte su un CONFERMATO', () => {
      it('aggiungere una riga: resta CONFERMATO, la nuova si congela col prezzo di listino, le altre invariate', async () => {
        const s = await scenario(2)
        const [v1, v2] = s.righeVIds
        const id = await proponi(s)
        await modifica(s, id, 1, { righe: [{ rigaAddebitoId: v1, prezzo: '4' }] })
        await modifica(s, id, 2, { righe: [{ rigaAddebitoId: v2, rimuovi: true }] })
        await conferma(s, id, 3)
        const prima = await legameDb(id)
        expect(prima.righe).toHaveLength(2)
        await owner.rigaAddebito.update({ where: { id: v2 }, data: { prezzo: '6' } })
        const v = await modifica(s, id, 4, { righe: [{ rigaAddebitoId: v2 }] })
        expect(v.stato).toBe('CONFERMATO')
        const l = await legameDb(id)
        expect(l.stato).toBe('CONFERMATO')
        expect(l.confermatoIl).toEqual(prima.confermatoIl)
        expect(l.righe).toHaveLength(3)
        expect(l.righe.every(r => r.congelataIl !== null)).toBe(true)
        const nuova = await rigaDb(id, v2)
        expect(nuova.prezzo?.toFixed()).toBe('6')
        for (const r of prima.righe) {
          const dopo = l.righe.find(x => x.id === r.id)!
          expect(dopo.congelataIl).toEqual(r.congelataIl)
          expect(dopo.prezzo?.toFixed()).toBe(r.prezzo?.toFixed())
          expect(dopo.quantita?.toFixed()).toBe(r.quantita?.toFixed())
        }
        expect((await rigaDb(id, v1)).prezzoManuale).toBe(true)
      })

      it('aggiungere una riga senza prezzo: 409 LEGAME_INCOMPLETO con SENZA_PREZZO, nulla scritto', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        await owner.rigaAddebito.update({
          where: { id: s.righeVIds[0] },
          data: { prezzoSpeciale: false },
        })
        await conferma(s, id, 1)
        await modifica(s, id, 2, { righe: [{ rigaAddebitoId: s.righeVIds[0], rimuovi: true }] })
        const orig = proposta.calcolaEBloccaInTx.bind(proposta)
        const spia = jest
          .spyOn(proposta, 'calcolaEBloccaInTx')
          .mockImplementationOnce(async (...a) => {
            const p = await orig(...a)
            return {
              ...p,
              righe: p.righe.map(r =>
                r.rigaAddebitoId === s.righeVIds[0] ? { ...r, prezzo: null, importo: null } : r
              ),
            }
          })
        const e = await errore(modifica(s, id, 3, { righe: [{ rigaAddebitoId: s.righeVIds[0] }] }))
        spia.mockRestore()
        expect(e).toMatchObject({
          status: 409,
          body: { error: 'LEGAME_INCOMPLETO', details: { motivi: ['SENZA_PREZZO'] } },
        })
        const l = await legameDb(id)
        expect(l).toMatchObject({ stato: 'CONFERMATO', versione: 3 })
        expect(l.righe).toHaveLength(1)
      })

      it('togliere una riga: resta CONFERMATO; togliere l’ultima: 400 RIGHE_VUOTE', async () => {
        const s = await scenario(1)
        const id = await proponi(s)
        await conferma(s, id, 1)
        const v = await modifica(s, id, 2, {
          righe: [{ rigaAddebitoId: s.righeVIds[0], rimuovi: true }],
        })
        expect(v.stato).toBe('CONFERMATO')
        const l = await legameDb(id)
        expect(l.righe.map(r => r.rigaAddebitoId)).toEqual([s.rigaCerId])
        expect(l.righe[0].congelataIl).not.toBeNull()
        const e = await errore(
          modifica(s, id, 3, { righe: [{ rigaAddebitoId: s.rigaCerId, rimuovi: true }] })
        )
        expect(e).toMatchObject({ status: 400, body: { error: 'RIGHE_VUOTE' } })
      })

      it('m1: CONFERMATO con solo quantita null non ricontrolla la testata (cliente disattivato: resta CONFERMATO)', async () => {
        const s = await scenario(0)
        const id = await proponi(s)
        await conferma(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, quantita: '5' }] })
        await owner.cliente.update({ where: { id: s.clienteId }, data: { attivo: false } })
        const v = await modifica(s, id, 2, {
          righe: [{ rigaAddebitoId: s.rigaCerId, quantita: null }],
        })
        expect(v.stato).toBe('CONFERMATO')
        const r = await rigaDb(id, s.rigaCerId)
        expect(r.quantita?.toFixed()).toBe('100')
        expect(r.quantitaOrigine).toBe('DA_MOVIMENTO')
        const log = await audit(s.tenantId, 'LEGAME_MOVIMENTO_MODIFICATO')
        expect(log[0].metadata).toMatchObject({
          righe: [{ rigaAddebitoId: s.rigaCerId, quantita: { prima: '5', dopo: '100' } }],
        })
      })
    })

    it('m2: cliente disattivato + modifica di un prezzo: DA_COLLEGARE con SENZA_CLIENTE, versione+1', async () => {
      const s = await scenario(0)
      const id = await proponi(s)
      await owner.cliente.update({ where: { id: s.clienteId }, data: { attivo: false } })
      const v = await modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: '3' }] })
      expect(v).toMatchObject({
        stato: 'DA_COLLEGARE',
        versione: 2,
        motivi: ['SENZA_CLIENTE'],
        dettaglioCliente: 'cliente disattivato',
      })
      expect((await rigaDb(id, s.rigaCerId)).prezzo?.toFixed()).toBe('3')
    })

    it('m5: il cambio di contratto registra nell’audit i prezzi manuali persi', async () => {
      const s = await scenario(0)
      const id = await proponi(s)
      await modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: '12.5' }] })
      const c2 = await secondoContratto(s)
      await modifica(s, id, 2, { contrattoId: c2.contrattoId })
      const log = await audit(s.tenantId, 'LEGAME_MOVIMENTO_MODIFICATO')
      expect(log[1].metadata).toMatchObject({
        prezziManualiPersi: [{ rigaAddebitoId: s.rigaCerId, prezzo: '12.5', sconto: null }],
      })
    })

    it('la conferma non scrive nulla sul registro', async () => {
      const s = await scenario(1)
      const prima = await owner.wasteMovement.findUniqueOrThrow({ where: { id: s.movimentoId } })
      const id = await proponi(s)
      await conferma(s, id, 1)
      await service.escludi(s.tenantId, s.utenteId, id, 2, 'non fatturare')
      await service.riammetti(s.tenantId, s.utenteId, id, 3)
      expect(await owner.wasteMovement.findUniqueOrThrow({ where: { id: s.movimentoId } })).toEqual(
        prima
      )
    })

    it('un FOR UPDATE del listino tiene in attesa la conferma, che poi legge il prezzo nuovo', async () => {
      const s = await scenario(0)
      const id = await proponi(s)
      let rilascia!: () => void
      const aperta = new Promise<void>(r => (rilascia = r))
      let preso!: () => void
      const tenuto = new Promise<void>(r => (preso = r))
      const scrittore = owner.$transaction(
        async tx => {
          await tx.$queryRaw`SELECT id FROM righe_addebito WHERE id = ${s.rigaCerId}::uuid FOR UPDATE`
          await tx.$executeRaw`UPDATE righe_addebito SET prezzo = 7 WHERE id = ${s.rigaCerId}::uuid`
          preso()
          await aperta
        },
        { timeout: 60_000, maxWait: 30_000 }
      )
      await tenuto
      let finita = false
      const conf = conferma(s, id, 1).finally(() => (finita = true))
      await attendiLock(1, () => finita)
      rilascia()
      await scrittore
      await conf
      expect((await rigaDb(id, s.rigaCerId)).prezzo?.toFixed()).toBe('7')
    })
  })

  // -------------------------------------------------------------------------------------------
  describe('escludi e riammetti', () => {
    it.each([
      ['', 'vuoto'],
      ['   ', 'solo spazi'],
      ['x'.repeat(201), '201 caratteri'],
      [MOTIVO_ESCLUSIONE_CAUSALE, 'testo automatico'],
    ])('motivo %j (%s): 400 MOTIVO_ESCLUSIONE_NON_VALIDO', async motivo => {
      const s = await scenario(0)
      const id = await proponi(s)
      const e = await errore(service.escludi(s.tenantId, s.utenteId, id, 1, motivo))
      expect(e).toMatchObject({ status: 400, body: { error: 'MOTIVO_ESCLUSIONE_NON_VALIDO' } })
      expect((await legameDb(id)).stato).toBe('PROPOSTO')
    })

    it('escludi da CONFERMATO: ESCLUSO con il motivo trim, non piu confermato; 200 e audit', async () => {
      const s = await scenario(1)
      const id = await proponi(s)
      await conferma(s, id, 1)
      const v = await service.escludi(s.tenantId, s.utenteId, id, 2, '  Cliente in contenzioso  ')
      expect(v).toMatchObject({
        stato: 'ESCLUSO',
        motivoEsclusione: 'Cliente in contenzioso',
        versione: 3,
      })
      const l = await legameDb(id)
      expect(l).toMatchObject({
        stato: 'ESCLUSO',
        motivoEsclusione: 'Cliente in contenzioso',
        confermatoIl: null,
        confermatoDa: null,
      })
      const log = await audit(s.tenantId, 'LEGAME_MOVIMENTO_ESCLUSO')
      expect(log).toHaveLength(1)
      expect(log[0].metadata).toMatchObject({ legameId: id, statoPrima: 'CONFERMATO' })
    })

    it('escludi su un ESCLUSO o su un FATTURATO: 409', async () => {
      const s = await scenario(0)
      const id = await proponi(s)
      await service.escludi(s.tenantId, s.utenteId, id, 1, 'prima volta')
      const e = await errore(service.escludi(s.tenantId, s.utenteId, id, 2, 'seconda volta'))
      expect(e).toMatchObject({ status: 409, body: { error: 'STATO_LEGAME_NON_AMMESSO' } })
    })

    it('riammetti: motivo azzerato e proposta ricalcolata (completa: PROPOSTO)', async () => {
      const s = await scenario(1)
      const id = await proponi(s)
      await modifica(s, id, 1, { righe: [{ rigaAddebitoId: s.rigaCerId, prezzo: '9' }] })
      await service.escludi(s.tenantId, s.utenteId, id, 2, 'errore di registrazione')
      const v = await service.riammetti(s.tenantId, s.utenteId, id, 3)
      expect(v).toMatchObject({ stato: 'PROPOSTO', motivoEsclusione: null, versione: 4 })
      const l = await legameDb(id)
      expect(l.righe).toHaveLength(2)
      // La proposta e' rifatta dal listino: il prezzo scritto a mano non sopravvive.
      expect((await rigaDb(id, s.rigaCerId)).prezzo?.toFixed()).toBe('1')
      expect(l.avvisi).not.toContain('PREZZO_MANUALE')
      expect(await audit(s.tenantId, 'LEGAME_MOVIMENTO_RIAMMESSO')).toHaveLength(1)
    })

    it('riammetti un legame senza cliente: DA_COLLEGARE', async () => {
      const s = await scenario(0)
      const senzaFir = await creaMovimentoDiTest(owner, s.tenantId, { cerCode: '20 03 01' })
      const id = await proponi(s, senzaFir.movimentoId, { firId: null })
      await service.escludi(s.tenantId, s.utenteId, id, 1, 'da rivedere')
      const v = await service.riammetti(s.tenantId, s.utenteId, id, 2)
      expect(v).toMatchObject({ stato: 'DA_COLLEGARE', motivi: ['SENZA_CLIENTE'] })
    })

    it('riammetti su un legame non ESCLUSO: 409', async () => {
      const s = await scenario(0)
      const id = await proponi(s)
      const e = await errore(service.riammetti(s.tenantId, s.utenteId, id, 1))
      expect(e).toMatchObject({ status: 409, body: { error: 'STATO_LEGAME_NON_AMMESSO' } })
    })

    it('I1: riammetti un legame escluso per data (movimento prima di «fatturazione da»): 409, legame invariato', async () => {
      const s = await scenario(0)
      const id = await proponi(s)
      await service.escludi(s.tenantId, s.utenteId, id, 1, 'da rivedere')
      await owner.impostazioneFatturazione.update({
        where: { tenantId: s.tenantId },
        data: { fatturazioneDa: new Date('2026-06-01T00:00:00Z') },
      })
      const e = await errore(service.riammetti(s.tenantId, s.utenteId, id, 2))
      expect(e).toMatchObject({ status: 409, body: { error: 'MOVIMENTO_FUORI_FATTURAZIONE' } })
      expect(await legameDb(id)).toMatchObject({ stato: 'ESCLUSO', versione: 2 })
      // Fatturazione spenta (nessuna data): stesso risultato.
      await owner.impostazioneFatturazione.update({
        where: { tenantId: s.tenantId },
        data: { fatturazioneDa: null },
      })
      expect((await errore(service.riammetti(s.tenantId, s.utenteId, id, 2))).status).toBe(409)
    })

    it('riammetti con la causale non piu fatturabile: 409 CAUSALE_NON_FATTURABILE', async () => {
      const s = await scenario(0)
      const nonFatturabile = await creaMovimentoDiTest(owner, s.tenantId, {
        cerCode: '20 03 01',
        causale: 'PRODUZIONE_INTERNA',
      })
      const { legameId } = await creaLegameDiTest(owner, s.tenantId, {
        movimentoOriginaleId: nonFatturabile.movimentoId,
        registroId: s.registroId,
        verso: 'CARICO',
        stato: 'ESCLUSO',
      })
      const e = await errore(service.riammetti(s.tenantId, s.utenteId, legameId, 1))
      expect(e).toMatchObject({ status: 409, body: { error: 'CAUSALE_NON_FATTURABILE' } })
    })
  })

  it('un errore di chiave esterna (cliente eliminato in parallelo) esce come 409 OPERAZIONE_CONCORRENTE, non 500', async () => {
    // Il sintomo e' una Prisma.PrismaClientKnownRequestError P2003 durante la scrittura: la
    // traduzione e' comune a tutti i metodi (vedi `traduci` nel servizio).
    const err = new Prisma.PrismaClientKnownRequestError('fk', {
      code: 'P2003',
      clientVersion: 'test',
    })
    const s = await scenario(0)
    const id = await proponi(s)
    const spia = jest.spyOn(proposta, 'calcolaEBloccaInTx').mockRejectedValueOnce(err)
    const e = await errore(conferma(s, id, 1))
    spia.mockRestore()
    expect(e).toMatchObject({ status: 409, body: { error: 'OPERAZIONE_CONCORRENTE' } })
  })
})
