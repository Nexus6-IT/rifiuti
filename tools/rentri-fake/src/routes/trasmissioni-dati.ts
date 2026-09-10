import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio, TrasmissioneDatiFake } from '../stato/archivio'
import { numIscrSitoValido } from '../dominio/num-iscr-sito'
import { numeroFirValido } from '../dominio/numero-fir'
import { validaTrasmissioneDati } from '../dominio/trasmissione-dati'
import { inviaProblemDetails } from '../errori/problem-details'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/formulari/v1.0'

async function autentica(
  richiesta: FastifyRequest,
  risposta: FastifyReply,
  archivio: Archivio
): Promise<{ ok: true; soggetto: string } | { ok: false }> {
  const esito = await verificaJwt(richiesta.headers.authorization, {
    audienceAttesa: AUDIENCE,
    registroReplay: archivio.registroReplay,
  })

  if (!esito.valido) {
    // Come le altre rotte del servizio (v. formulari.ts/transazioni.ts): il
    // contratto documenta 403 "Operazione non consentita" su ogni operazione
    // di questo gruppo, mai 401.
    await inviaProblemDetails(risposta, 403, {
      title: 'Operazione non consentita',
      detail: esito.motivo,
    })
    return { ok: false }
  }

  return { ok: true, soggetto: esito.soggetto }
}

/** `TrasmissioneDatiSitoResult` (formulari.yaml righe 10405-10432): v. commento di `TrasmissioneDatiFake` per la divergenza dichiarata sui campi non risolti. */
function sito(numIscrSito?: string): Record<string, unknown> | null {
  if (!numIscrSito) return null
  return {
    num_iscr_sito: numIscrSito,
    codice_fiscale: null,
    denominazione: null,
    comune_id: null,
    indirizzo: null,
    civico: null,
  }
}

/** `TrasmissioneDatiItemResult` (elenco, formulari.yaml righe 10294-10353): nessun campo `formulario`, a differenza del dettaglio. */
function aItemResult(t: TrasmissioneDatiFake): Record<string, unknown> {
  return {
    identificativo: t.identificativo,
    sito_oggetto_trasmissione: sito(t.numIscrSito),
    sito_trasportatore_per_conto_produttore: sito(t.numIscrSitoTrasportatorePerContoProduttore),
    numero_fir: t.numeroFir || null,
    user_name: t.userName,
    data_trasmissione: t.dataTrasmissione,
    data_emissione: t.dataEmissione ?? null,
    codice_eer: t.codiceEer ?? null,
    rifiuto_quantita: null,
    rifiuto_unita_misura: null,
    tipo: t.tipo,
    stato: t.stato,
  }
}

/** `TrasmissioneDatiResult` (dettaglio, formulari.yaml righe 10354-10404): come l'item, piu' `formulario` (il corpo trasmesso) e senza `data_emissione` deprecato... che il contratto comunque dichiara: la fake lo valorizza per fedelta'. */
function aDettaglioResult(t: TrasmissioneDatiFake): Record<string, unknown> {
  return {
    ...aItemResult(t),
    formulario: t.formulario,
  }
}

interface ParamsNumIscrSito {
  num_iscr_sito: string
}

interface ParamsNumIscrSitoIdentificativo {
  num_iscr_sito: string
  identificativo: string
}

interface QueryElenco {
  numero_fir?: string
  stato?: string
  tipo?: string
  codice_eer?: string
  includi_trasportatore_per_conto_produttore?: string
}

interface QueryInvio {
  num_iscr_sito_produttore?: string
}

/**
 * `Trasmissione dati operatore` (formulari.yaml righe 5149-5577), variante
 * usata dal nostro backend (l'operatore trasmette per la propria unita'
 * locale, eventualmente per conto del produttore). Le varianti
 * `soggetto-delegato` e i path deprecati (`/trasmissioni/{num_iscr_sito}...`,
 * senza `/operatore/`) restano fuori dall'ambito di questo task.
 *
 * A differenza di `POST /formulari/v1.0/` (creazione, NONBLOCK_PULL), `POST
 * .../trasmissioni/operatore/{num_iscr_sito}` e' **sincrona**: 201 immediato
 * con `TrasmissioneFormularioResponse`, nessun `TransazioneModel`. Solo
 * `POST .../{numero_fir}/estrai` e' asincrona, e riusa il ciclo generico gia'
 * implementato da `transazioni.ts` (`GET /formulari/v1.0/:id/status` e
 * `/result`, path canonici — quelli sotto `/trasmissioni/{transazione_id}/...`
 * sono deprecati dal contratto in loro favore) invece di duplicarlo qui.
 */
export function registraRotteTrasmissioniDati(app: FastifyInstance, archivio: Archivio): void {
  function erroreNumIscrSito(numIscrSito: string): { title: string; detail: string } {
    return {
      title: "Numero iscrizione unita' locale non valido",
      detail: `'${numIscrSito}' non rispetta il pattern num_iscr_sito del contratto.`,
    }
  }

  // GET /trasmissioni/operatore/{num_iscr_sito} (formulari.yaml righe
  // 5149-5277): il contratto NON dichiara 400 su questo path (solo
  // 403/404/500/429/423) — un `num_iscr_sito` mal formato non trova quindi
  // nulla e la fake risponde 200 con elenco vuoto, non un 400 inventato.
  app.get<{ Params: ParamsNumIscrSito; Querystring: QueryElenco }>(
    `${PREFISSO}/trasmissioni/operatore/:num_iscr_sito`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const { num_iscr_sito: numIscrSito } = richiesta.params
      const pagingPage = Number(richiesta.headers['paging-page'] ?? 1)
      const pagingPageSize = Number(richiesta.headers['paging-pagesize'] ?? 100)

      const elenco = archivio.elencaTrasmissioniDati(numIscrSito, {
        numeroFir: richiesta.query.numero_fir,
        stato: richiesta.query.stato,
        tipo: richiesta.query.tipo,
        codiceEer: richiesta.query.codice_eer,
        includiTrasportatorePerContoProduttore:
          richiesta.query.includi_trasportatore_per_conto_produttore === 'true',
      })
      const totale = elenco.length
      const pageCount = Math.max(1, Math.ceil(totale / pagingPageSize))

      risposta.header('Paging-Page', pagingPage)
      risposta.header('Paging-PageSize', pagingPageSize)
      risposta.header('Paging-PageCount', pageCount)
      risposta.header('Paging-TotalRecordCount', totale)

      return elenco.map(aItemResult)
    }
  )

  // POST /trasmissioni/operatore/{num_iscr_sito} (formulari.yaml righe
  // 5278-5365): SINCRONA, 201 + Location + TrasmissioneFormularioResponse.
  //
  // **Interpretazione dichiarata**: il contratto descrive l'header `Location`
  // come "URL per verificare lo stato dell'elaborazione" — testo copiato dal
  // pattern NONBLOCK_PULL, ma qui non esiste alcuna transazione da
  // interrogare (risposta 201 immediata, non 202). La fake tratta quindi
  // `Location` come da convenzione REST per un 201 Created: l'URL della
  // risorsa appena creata (`GET .../{identificativo}`), l'unica lettura
  // che questo gruppo di rotte offre per la trasmissione appena registrata.
  //
  // **Fuori scope dichiarato**: la regola di dominio "il numero FIR deve
  // essere vidimato al trasportatore" (righe 5297-5298, rilevante solo se
  // `num_iscr_sito_produttore` e' indicato) non e' verificata — richiederebbe
  // una nozione di "vidimazione" che questa fake non modella. Allo stesso
  // modo non si verifica che `num_iscr_sito` afferisca davvero al soggetto
  // indicato come primo trasportatore/produttore nel corpo.
  app.post<{ Params: ParamsNumIscrSito; Querystring: QueryInvio; Body: unknown }>(
    `${PREFISSO}/trasmissioni/operatore/:num_iscr_sito`,
    async (richiesta, risposta) => {
      const esitoAuth = await autentica(richiesta, risposta, archivio)
      if (!esitoAuth.ok) return

      const { num_iscr_sito: numIscrSito } = richiesta.params
      if (!numIscrSitoValido(numIscrSito)) {
        return inviaProblemDetails(risposta, 400, erroreNumIscrSito(numIscrSito))
      }

      const numIscrSitoProduttore = richiesta.query.num_iscr_sito_produttore
      if (numIscrSitoProduttore && !numIscrSitoValido(numIscrSitoProduttore)) {
        return inviaProblemDetails(risposta, 400, {
          title: "Numero iscrizione unita' locale del produttore non valido",
          detail: `'${numIscrSitoProduttore}' non rispetta il pattern num_iscr_sito del contratto.`,
        })
      }

      const motivo = validaTrasmissioneDati(richiesta.body)
      if (motivo) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Modello dati non valido',
          detail: motivo,
        })
      }

      const trasmissione = archivio.creaTrasmissioneDati(
        numIscrSito,
        richiesta.body as Record<string, unknown>,
        { numIscrSitoProduttore, userName: esitoAuth.soggetto }
      )

      return risposta
        .status(201)
        .header(
          'Location',
          `${PREFISSO}/trasmissioni/operatore/${numIscrSito}/${trasmissione.identificativo}`
        )
        .send({ identificativo: trasmissione.identificativo })
    }
  )

  // GET /trasmissioni/operatore/{num_iscr_sito}/{identificativo}
  // (formulari.yaml righe 5366-5413): nessun 400 dichiarato (v. GET elenco
  // sopra) — un `num_iscr_sito` mal formato o un `identificativo`
  // inesistente per quel sito sono entrambi 404, mai rivelando l'esistenza
  // della trasmissione a un sito diverso da quello che l'ha inviata.
  app.get<{ Params: ParamsNumIscrSitoIdentificativo }>(
    `${PREFISSO}/trasmissioni/operatore/:num_iscr_sito/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const { num_iscr_sito: numIscrSito, identificativo } = richiesta.params
      const trasmissione = archivio.leggiTrasmissioneDati(numIscrSito, identificativo)
      if (!trasmissione) {
        return inviaProblemDetails(risposta, 404, { title: 'Trasmissione non trovata' })
      }

      return aDettaglioResult(trasmissione)
    }
  )

  // DELETE /trasmissioni/operatore/{num_iscr_sito}/{identificativo}/annulla
  // (formulari.yaml righe 5414-5467): 200 senza corpo, operazione NON
  // reversibile. 400 e' l'unico dei tre verbi di questo gruppo (insieme a
  // POST invio/estrai) a dichiararlo: qui scatta se si tenta di annullare una
  // trasmissione gia' annullata (v. `Archivio.annullaTrasmissioneDati`) — il
  // contratto non elenca altre condizioni di "Bad Request" per questo path,
  // che non ha ne' corpo ne' parametri oltre a quelli del path.
  app.delete<{ Params: ParamsNumIscrSitoIdentificativo }>(
    `${PREFISSO}/trasmissioni/operatore/:num_iscr_sito/:identificativo/annulla`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const { num_iscr_sito: numIscrSito, identificativo } = richiesta.params
      const esito = archivio.annullaTrasmissioneDati(numIscrSito, identificativo)

      if (esito === 'non-trovata') {
        return inviaProblemDetails(risposta, 404, { title: 'Trasmissione non trovata' })
      }
      if (esito === 'gia-annullata') {
        return inviaProblemDetails(risposta, 400, {
          title: 'Trasmissione gia annullata',
          detail: "L'annullamento non e' reversibile (formulari.yaml riga 5423).",
        })
      }

      return risposta.status(200).send()
    }
  )

  // POST /trasmissioni/operatore/{num_iscr_sito}/{numero_fir}/estrai
  // (formulari.yaml righe 5468-5577): ASYNC, stesso schema NONBLOCK_PULL di
  // `POST /formulari/v1.0/` — 202 + `TransazioneModel` + header `Location`
  // verso `/status` (canonico, non il path deprecato
  // `/trasmissioni/{transazione_id}/status`). Riusa `archivio.creaTransazione`
  // senza `contestoOperazione`: l'estrazione non ha alcun effetto di dominio
  // da applicare a un `Formulario` al completamento (a differenza di
  // 'accettazione'/'annulla-fir' in `formulari.ts`) — il completamento lo
  // decide solo il canale di controllo, come per 'hash'.
  //
  // **Fuori scope dichiarato**: il file xFIR NON viene validato (ne' il
  // limite dei 3 MB, ne' la conformita' alla guida tecnica) — quella
  // validazione appartiene a `xfir.ts` (fuori dai file che questo task puo'
  // toccare) e a `EsitoEstrazioneDatiXfirModel`, che qui non si materializza:
  // il completamento (esito positivo/negativo) resta una decisione del TEST
  // tramite il canale di controllo, non della fake.
  //
  // **`X-ReplyTo` dichiarato ma non implementato**: se presente, il contratto
  // omette l'header `Location` (nessuna callback HTTP viene davvero inviata
  // dalla fake — implementarla richiederebbe un client HTTP in uscita verso
  // un URL arbitrario del chiamante, fuori dall'ambito di un oracolo che gira
  // in-process).
  // Nome del parametro `:identificativo` (non `:numero_fir`): questa rotta
  // condivide la posizione nell'albero delle rotte di find-my-way con `GET
  // .../{num_iscr_sito}/{identificativo}` e `DELETE
  // .../{identificativo}/annulla` sopra — stesso vincolo, stessa soluzione
  // gia' applicata in `formulari.ts`/`transazioni.ts` (v. i loro commenti).
  // Il path esterno resta identico al contratto (`{numero_fir}`), cambia
  // solo il nome interno del segmento.
  app.post<{
    Params: { num_iscr_sito: string; identificativo: string }
    Body: unknown
  }>(
    `${PREFISSO}/trasmissioni/operatore/:num_iscr_sito/:identificativo/estrai`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio)).ok) return

      const numIscrSito = richiesta.params.num_iscr_sito
      const numeroFir = richiesta.params.identificativo
      if (!numIscrSitoValido(numIscrSito)) {
        return inviaProblemDetails(risposta, 400, erroreNumIscrSito(numIscrSito))
      }
      if (!numeroFirValido(numeroFir)) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Numero FIR non valido',
          detail: `'${numeroFir}' non rispetta il pattern numero_fir del contratto.`,
        })
      }

      const corpo = (richiesta.body ?? {}) as Record<string, unknown>
      if (typeof corpo.xfir !== 'string' || corpo.xfir.trim() === '') {
        return inviaProblemDetails(risposta, 400, {
          title: 'Corpo della richiesta non valido',
          detail: "'xfir' e' obbligatorio (EstraiDatiXfirModel).",
        })
      }

      const id = archivio.creaTransazione()
      const rispostaConStato = risposta.status(202)
      if (!richiesta.headers['x-replyto']) {
        rispostaConStato.header('Location', `${PREFISSO}/${id}/status`)
      }
      return rispostaConStato.send({ transazione_id: id })
    }
  )
}
