import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio } from '../stato/archivio'
import {
  OperatoreFixture,
  SitoFixture,
  SoggettoDelegatoFixture,
} from '../stato/fixture-anagrafiche'
import { inviaProblemDetails } from '../errori/problem-details'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/anagrafiche/v1.0'

/**
 * V. formulari.ts/codifiche.ts: credenziale assente o non valida => 403, mai
 * 401. `anagrafiche.yaml` documenta 403 esplicitamente solo su alcune rotte
 * (`autorizzazione-albo`, `siti`), ma la sicurezza globale del contratto
 * (`security: - Bearer: []`) copre tutti i path — applichiamo lo stesso
 * comportamento ovunque, per coerenza col resto della fake.
 */
async function autentica(
  richiesta: FastifyRequest,
  risposta: FastifyReply,
  archivio: Archivio
): Promise<boolean> {
  const esito = await verificaJwt(richiesta.headers.authorization, {
    audienceAttesa: AUDIENCE,
    registroReplay: archivio.registroReplay,
  })

  if (!esito.valido) {
    await inviaProblemDetails(risposta, 403, {
      title: 'Operazione non consentita',
      detail: esito.motivo,
    })
    return false
  }

  return true
}

/** `OperatoreModel` (anagrafiche.yaml componenti, righe 167-...): solo i campi popolati dalla fixture, il resto null come da schema (nessun campo è `required`). */
function operatoreAModello(o: OperatoreFixture) {
  return {
    num_iscr: o.numIscr,
    profilo_soggetto: o.profiloSoggetto,
    data_iscrizione: null,
    identificativo: o.identificativo,
    ipa: null,
    denominazione: o.denominazione,
    forma_giuridica_id: null,
    piva: o.piva,
    cciaarea: null,
    nrea: null,
    data_iscrizione_ri: null,
    stato_impresa_ri: null,
    dipendenti_ri: null,
    data_rilevazione_dipendenti_ri: null,
    nazione_slid: null,
    provincia_slid: null,
    comune_slid: null,
    citta_sl: null,
    indirizzo_sl: null,
    civico_sl: null,
    capsl: null,
    pec: null,
    cod_fisc_lr: null,
    cognome_lr: null,
    nome_lr: null,
    dipendenti: null,
    data_ultima_visura: null,
    flag_esonerato_iscr_albo: null,
    stato: o.stato,
  }
}

/** `SitoModel` (anagrafiche.yaml componenti, righe 429-...). */
function sitoAModello(s: SitoFixture, operatore: OperatoreFixture) {
  return {
    num_iscr_sito: s.numIscrSito,
    num_iscr_operatore: s.numIscrOperatore,
    denominazione_operatore: operatore.denominazione,
    identificativo_operatore: operatore.identificativo,
    ipa_operatore: null,
    nome: s.nome,
    is_sede_legale: s.isSedeLegale,
    comune_id: s.comuneId,
    provincia_id: s.provinciaId,
    indirizzo: s.indirizzo,
    civico: s.civico,
    cciaari: null,
    progressivo_ri: null,
    cu_aoo: null,
    cuu: null,
    deleghe_ass: s.delegatoDaNumIscrAss.map(numIscrAss => ({
      num_iscr_associazione: numIscrAss,
      stato_delega_ass: 'Attivo',
      data_conferma: null,
      data_revoca: null,
      da_associazione: false,
    })),
    attivita: s.attivita,
    data_iscrizione: '2020-01-01T00:00:00Z',
    data_cancellazione: null,
    stato: s.stato,
  }
}

/** `AutRecerModel` (anagrafiche.yaml componenti, righe 46-...). */
function autorizzazioniAModello(s: SitoFixture) {
  return s.autorizzazioni.map(a => ({
    tipo_autorizzazione: a.tipoAutorizzazione,
    autorizzazione_rif: a.autorizzazioneRif,
    data_rilascio: a.dataRilascio,
    data_scadenza: a.dataScadenza,
    attivita_recupero_smaltimento: a.attivitaRecuperoSmaltimento,
  }))
}

/** `AutAlboModel` (anagrafiche.yaml componenti, righe 25-...). */
function autAlboAModello(o: OperatoreFixture) {
  return {
    sezione: o.autorizzazioneAlbo.sezione,
    numero_iscrizione: o.autorizzazioneAlbo.numeroIscrizione,
    attiva: o.autorizzazioneAlbo.attiva,
    data_iscrizione: '2020-01-01T00:00:00Z',
    categorie: o.autorizzazioneAlbo.categorie.map(c => ({
      categoria: c.categoria,
      classe: c.classe,
      stato: c.stato,
    })),
  }
}

function soggettoDelegatoAModello(s: SoggettoDelegatoFixture) {
  return operatoreAModello({
    numIscr: s.numIscrAss,
    identificativo: s.identificativo,
    profiloSoggetto: 'AssociazioneCategoria',
    denominazione: s.denominazione,
    piva: null,
    stato: s.stato,
    autorizzazioneAlbo: { sezione: '', numeroIscrizione: 0, attiva: false, categorie: [] },
  })
}

interface QueryElencoOperatori {
  num_iscr_ass?: string
}

interface QuerySiti {
  num_iscr_sito?: string
}

interface HeaderPaging {
  'paging-page'?: string
  'paging-pagesize'?: string
}

/** Applica la paginazione dichiarata dal contratto (header `Paging-*`) a un elenco già filtrato. */
function applicaPaginazione<T>(
  risposta: FastifyReply,
  elenco: T[],
  intestazioni: HeaderPaging
): void {
  const pagingPage = Number(intestazioni['paging-page'] ?? 1)
  const pagingPageSize = Number(intestazioni['paging-pagesize'] ?? 100)
  const totale = elenco.length
  const pageCount = Math.max(1, Math.ceil(totale / pagingPageSize))

  risposta.header('Paging-Page', pagingPage)
  risposta.header('Paging-PageSize', pagingPageSize)
  risposta.header('Paging-PageCount', pageCount)
  risposta.header('Paging-TotalRecordCount', totale)
}

export function registraRotteAnagrafiche(app: FastifyInstance, archivio: Archivio): void {
  // GET /operatore — elenco, filtrabile per num_iscr_ass (operatori delegati).
  app.get<{ Querystring: QueryElencoOperatori }>(
    `${PREFISSO}/operatore`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return
      return archivio.elencaOperatori(richiesta.query.num_iscr_ass).map(operatoreAModello)
    }
  )

  // GET /soggetto-delegato — elenco.
  app.get(`${PREFISSO}/soggetto-delegato`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio))) return
    return archivio.elencaSoggettiDelegati().map(soggettoDelegatoAModello)
  })

  // GET /status (anagrafiche.yaml riga 1628): stessa semantica di
  // codifiche.ts, nessuna autenticazione richiesta nel contratto.
  app.get(`${PREFISSO}/status`, async () => {
    return { status: 'Ok', warnings: [], planned_notices: [] }
  })

  // Sotto-albero /operatore/:identificativoOperatore/... — un solo nome di
  // parametro a questa posizione (find-my-way/Fastify lo impone: v. nota in
  // formulari.ts), anche se il significato cambia tra codice fiscale
  // (controllo-iscrizione/controllo-autorizzazione-albo) e num_iscr
  // (autorizzazione-albo/siti).

  // GET /operatore/{identificativo}/controllo-iscrizione — booleano.
  app.get<{ Params: { identificativoOperatore: string } }>(
    `${PREFISSO}/operatore/:identificativoOperatore/controllo-iscrizione`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return
      const iscritto =
        archivio.operatorePerIdentificativo(richiesta.params.identificativoOperatore) !== undefined
      return iscritto
    }
  )

  // GET /operatore/{identificativo}/controllo-autorizzazione-albo — booleano.
  app.get<{ Params: { identificativoOperatore: string } }>(
    `${PREFISSO}/operatore/:identificativoOperatore/controllo-autorizzazione-albo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return
      const operatore = archivio.operatorePerIdentificativo(
        richiesta.params.identificativoOperatore
      )
      return (operatore?.autorizzazioneAlbo.categorie.length ?? 0) > 0
    }
  )

  // GET /operatore/{num_iscr}/autorizzazione-albo — 404 se l'operatore non esiste.
  app.get<{ Params: { identificativoOperatore: string } }>(
    `${PREFISSO}/operatore/:identificativoOperatore/autorizzazione-albo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return
      const operatore = archivio.operatorePerNumIscr(richiesta.params.identificativoOperatore)
      if (!operatore) {
        return inviaProblemDetails(risposta, 404, { title: 'Operatore o unità locale non trovata' })
      }
      return autAlboAModello(operatore)
    }
  )

  // GET /operatore/{num_iscr}/siti — elenco paginato, filtrabile per num_iscr_sito.
  app.get<{ Params: { identificativoOperatore: string }; Querystring: QuerySiti }>(
    `${PREFISSO}/operatore/:identificativoOperatore/siti`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const operatore = archivio.operatorePerNumIscr(richiesta.params.identificativoOperatore)
      if (!operatore) {
        return inviaProblemDetails(risposta, 404, { title: 'Operatore o unità locale non trovata' })
      }

      let elenco = archivio.sitiDiOperatore(operatore.numIscr)
      if (richiesta.query.num_iscr_sito) {
        elenco = elenco.filter(s => s.numIscrSito === richiesta.query.num_iscr_sito)
      }

      applicaPaginazione(risposta, elenco, richiesta.headers as HeaderPaging)
      return elenco.map(s => sitoAModello(s, operatore))
    }
  )

  // Sotto-albero /operatore/:identificativoOperatore/siti/:identificativoSito/...
  // (num_iscr_sito per il dettaglio/autorizzazioni, comune_id per il
  // controllo-autorizzazioni: stesso vincolo di nome unico di posizione).

  // GET /operatore/{identificativo}/siti/{comune_id}/controllo-autorizzazioni — booleano.
  app.get<{
    Params: { identificativoOperatore: string; identificativoSito: string }
    Querystring: { attivita?: string }
  }>(
    `${PREFISSO}/operatore/:identificativoOperatore/siti/:identificativoSito/controllo-autorizzazioni`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const operatore = archivio.operatorePerIdentificativo(
        richiesta.params.identificativoOperatore
      )
      if (!operatore) return false

      const comuneId = richiesta.params.identificativoSito
      const attivitaRichiesta = richiesta.query.attivita
      const siti = archivio.sitiDiOperatore(operatore.numIscr).filter(s => s.comuneId === comuneId)
      if (!attivitaRichiesta) {
        return siti.some(s => s.autorizzazioni.length > 0)
      }
      return siti.some(s =>
        s.autorizzazioni.some(a => a.attivitaRecuperoSmaltimento.includes(attivitaRichiesta))
      )
    }
  )

  // GET /operatore/{num_iscr}/siti/{num_iscr_sito} — dettaglio, 404 se assente.
  app.get<{ Params: { identificativoOperatore: string; identificativoSito: string } }>(
    `${PREFISSO}/operatore/:identificativoOperatore/siti/:identificativoSito`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const operatore = archivio.operatorePerNumIscr(richiesta.params.identificativoOperatore)
      const sito =
        operatore &&
        archivio.sitoDiOperatore(operatore.numIscr, richiesta.params.identificativoSito)
      if (!operatore || !sito) {
        return inviaProblemDetails(risposta, 404, { title: 'Operatore o unità locale non trovata' })
      }
      return sitoAModello(sito, operatore)
    }
  )

  // GET /operatore/{num_iscr}/siti/{num_iscr_sito}/autorizzazioni — elenco, 404 se il sito non esiste.
  app.get<{ Params: { identificativoOperatore: string; identificativoSito: string } }>(
    `${PREFISSO}/operatore/:identificativoOperatore/siti/:identificativoSito/autorizzazioni`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const operatore = archivio.operatorePerNumIscr(richiesta.params.identificativoOperatore)
      const sito =
        operatore &&
        archivio.sitoDiOperatore(operatore.numIscr, richiesta.params.identificativoSito)
      if (!operatore || !sito) {
        return inviaProblemDetails(risposta, 404, { title: 'Operatore o unità locale non trovata' })
      }
      return autorizzazioniAModello(sito)
    }
  )

  // GET /soggetto-delegato/{num_iscr_ass}/siti — elenco paginato delle unità
  // locali per cui il soggetto delegato ha delega.
  app.get<{ Params: { numIscrAss: string }; Querystring: QuerySiti }>(
    `${PREFISSO}/soggetto-delegato/:numIscrAss/siti`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const delegato = archivio.soggettoDelegato(richiesta.params.numIscrAss)
      if (!delegato) {
        return inviaProblemDetails(risposta, 404, { title: 'Operatore o unità locale non trovata' })
      }

      let elenco = archivio.sitiDelegatiA(delegato.numIscrAss)
      if (richiesta.query.num_iscr_sito) {
        elenco = elenco.filter(s => s.numIscrSito === richiesta.query.num_iscr_sito)
      }

      applicaPaginazione(risposta, elenco, richiesta.headers as HeaderPaging)
      return elenco.map(s => {
        const operatore = archivio.operatorePerNumIscr(s.numIscrOperatore)
        // Invariante di fixture: ogni sito delegato appartiene a un
        // operatore noto all'archivio (v. fixture-anagrafiche.ts).
        return sitoAModello(s, operatore as OperatoreFixture)
      })
    }
  )

  // GET /soggetto-delegato/{num_iscr_ass}/siti/{num_iscr_sito} — dettaglio.
  app.get<{ Params: { numIscrAss: string; identificativoSitoSd: string } }>(
    `${PREFISSO}/soggetto-delegato/:numIscrAss/siti/:identificativoSitoSd`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const delegato = archivio.soggettoDelegato(richiesta.params.numIscrAss)
      const sito =
        delegato &&
        archivio.sitoDelegatoA(delegato.numIscrAss, richiesta.params.identificativoSitoSd)
      if (!delegato || !sito) {
        return inviaProblemDetails(risposta, 404, { title: 'Operatore o unità locale non trovata' })
      }

      const operatore = archivio.operatorePerNumIscr(sito.numIscrOperatore) as OperatoreFixture
      return sitoAModello(sito, operatore)
    }
  )
}
