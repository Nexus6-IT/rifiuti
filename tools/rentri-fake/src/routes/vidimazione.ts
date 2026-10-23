import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt, RegistroReplayMemoria } from '../auth/jwt-verifier'
import { inviaProblemDetails } from '../errori/problem-details'
import { Vidimazione, FirVidimato, BloccoRegistrato } from '../stato/vidimazione'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/vidimazione-formulari/v1.0'

/**
 * Registro anti-replay dei `jti` DEDICATO a questo servizio, stesso motivo
 * gia' dichiarato in `dati-registri.ts`: nel RENTRI reale ogni servizio ha
 * il proprio host (`servers[0].url` del contratto), quindi anti-replay
 * per-servizio e' la scelta piu' fedele.
 */
const registroReplay = new RegistroReplayMemoria()

async function autentica(
  richiesta: FastifyRequest,
  risposta: FastifyReply
): Promise<{ ok: true; soggetto: string } | { ok: false }> {
  const esito = await verificaJwt(richiesta.headers.authorization, {
    audienceAttesa: AUDIENCE,
    registroReplay,
  })

  if (!esito.valido) {
    // Come `formulari.ts`/`trasmissioni-dati.ts`/`dati-registri.ts`: il
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

/** `BloccoModel` (righe elenco/GET `/`). */
function aBloccoModel(b: BloccoRegistrato): Record<string, unknown> {
  return {
    disattivo: b.disattivo,
    identificativo_soggetto: b.identificativoSoggetto,
    denominazione_soggetto: null,
    codice_blocco: b.codiceBlocco,
    descrizione: b.descrizione ?? null,
    codice_fiscale_utente: null,
    data_creazione: b.dataCreazione,
    numero_fir_vidimati: 0,
    data_ultimo_utilizzo: b.dataUltimoUtilizzo ?? null,
    num_iscr_sito: b.numIscrSito ?? null,
    indirizzo: null,
    civico: null,
    comune_id: null,
  }
}

/** `EfirPublicModel` (elenco FIR del blocco, `GET /verifica/{numero_fir}`). */
function aEfirPublicModel(f: FirVidimato): Record<string, unknown> {
  return {
    progressivo: f.progressivo,
    numero_fir: f.numeroFir,
    qr_code_bytes: f.qrCodeBytes,
    check_sum: f.checkSum,
    data_richiesta: f.dataRichiesta,
    denominazione_soggetto: f.denominazioneSoggetto ?? null,
    codice_fiscale_soggetto: f.codiceFiscaleSoggetto ?? null,
    num_iscr_sito: f.numIscrSito ?? null,
    codice_blocco: f.codiceBlocco,
    cciaa_nome: null,
    is_annullato: f.isAnnullato,
    data_annullamento: f.dataAnnullamento ?? null,
  }
}

/** `EfirModel` (dettaglio `GET /{codice_blocco}/{progressivo}`): come il pubblico, piu' i campi privati. */
function aEfirModel(f: FirVidimato, conXml: boolean): Record<string, unknown> {
  return {
    utente_richiesta: f.utenteRichiesta ?? null,
    denominazione_utente_richiesta: f.denominazioneUtenteRichiesta ?? null,
    utente_annullamento: f.utenteAnnullamento ?? null,
    origine: 'Api',
    // Fuori scope dichiarato: `xml` (il documento firmato) non e' modellato
    // da questa fake (v. commento di `generaQrCodeBytes`, stesso motivo: non
    // firmiamo nulla). Anche con `?xml=true` resta null.
    xml: conXml ? null : null,
    ...aEfirPublicModel(f),
  }
}

interface ParamsIdentificativo {
  identificativo: string
}

interface ParamsIdentificativoProgressivo {
  identificativo: string
  progressivo: string
}

interface QueryElencoBlocchi {
  identificativo: string
  num_iscr_sito?: string
  codice_blocco?: string
  anche_disattivi?: string
}

interface QueryElencoFir {
  progressivo_iniziale?: string
  progressivo_finale?: string
}

/**
 * Servizio `vidimazione-formulari`
 * (`docs/contracts/rentri/vidimazione-formulari.yaml`, versione
 * 1.0.20260831-1024): la vidimazione dei FIR sui blocchi virtuali e la
 * produzione di `qr_code_bytes` — v. `docs/audits/rentri-vidimazione-e-qr-2026-09-10.md`.
 *
 * Priorita' del task (tutte coperte qui): (1) vidimazione a blocchi (radice
 * e `/{codice_blocco}`, che restituisce `numero_fir`/`qr_code_bytes`), (2)
 * `/verifica/{numero_fir}`, (3) il resto (dettaglio, annullamento, PDF
 * modello, stato API, certificato).
 *
 * **Nessun endpoint di questo gruppo dichiara un `requestBody`** (a
 * differenza di `formulari`/`dati-registri`/`copie`): la vidimazione si pilota
 * solo con path/query/header (`X-ReplyTo` incluso). Non c'e' quindi un corpo
 * da validare con `creaValidatoreContratto`/`genera-schema.js` — la guardia
 * di fedelta' qui e' sulle RISPOSTE (v. `test/schema-vidimazione-allineato-al-contratto.test.ts`,
 * che verifica `EfirModel`/`BloccoModel` generati verbatim dal contratto).
 *
 * **Nome del parametro `:identificativo`** (non `:codice_blocco`/
 * `:transazione_id`): questa fake registra allo stesso livello dell'albero
 * (`${PREFISSO}/:X` e `${PREFISSO}/:X/...`) sia le rotte sui blocchi
 * (`/{codice_blocco}`, `/{codice_blocco}/{progressivo}[...]`) sia il ciclo
 * NONBLOCK_PULL (`/{transazione_id}/status`, `/result`) — find-my-way
 * ammette un solo nome di parametro per posizione, stesso vincolo gia'
 * documentato in `formulari.ts`/`trasmissioni-dati.ts`. Il path esterno resta
 * identico al contratto, cambia solo il nome interno del parametro.
 */
export function registraRotteVidimazione(app: FastifyInstance): void {
  const vidimazione = new Vidimazione()

  // --- Canale di controllo -------------------------------------------------

  app.post<{
    Body: { codice_blocco: string; identificativo_soggetto: string; num_iscr_sito?: string }
  }>('/__controllo/vidimazione/blocco', async richiesta => {
    vidimazione.registraBlocco(
      richiesta.body.codice_blocco,
      richiesta.body.identificativo_soggetto,
      {
        numIscrSito: richiesta.body.num_iscr_sito,
      }
    )
    return { registrato: true }
  })

  app.post<{
    Body: {
      transazione_id: string
      errore?: boolean
      tipo?: string
      tempo_elaborazione?: string
      validazione?: unknown[]
      esito?: Record<string, unknown>
    }
  }>('/__controllo/vidimazione/completa-transazione', async (richiesta, risposta) => {
    const transazione = vidimazione.leggiTransazione(richiesta.body.transazione_id)
    if (!transazione) {
      return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
    }

    vidimazione.completaTransazione(richiesta.body.transazione_id, {
      errore: richiesta.body.errore ?? false,
      tipo: richiesta.body.tipo,
      tempo_elaborazione: richiesta.body.tempo_elaborazione,
      validazione: richiesta.body.validazione ?? [],
      esito: richiesta.body.esito as Record<string, unknown> | undefined,
    })
    return { completata: true }
  })

  app.post('/__controllo/vidimazione/azzera', async () => {
    vidimazione.azzera()
    return { azzerato: true }
  })

  // --- Ciclo NONBLOCK_PULL generico (righe simili a formulari/registri) ----

  app.get<{ Params: ParamsIdentificativo }>(
    `${PREFISSO}/:identificativo/status`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const transazione = vidimazione.leggiTransazione(richiesta.params.identificativo)
      if (!transazione) {
        return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
      }
      if (transazione.stato === 'in_elaborazione') {
        return risposta.status(200).send()
      }
      return risposta.status(303).header('Location', `${PREFISSO}/${transazione.id}/result`).send()
    }
  )

  app.get<{ Params: ParamsIdentificativo }>(
    `${PREFISSO}/:identificativo/result`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const transazione = vidimazione.leggiTransazione(richiesta.params.identificativo)
      if (!transazione) {
        return inviaProblemDetails(risposta, 404, { title: 'Transazione non trovata' })
      }
      if (transazione.stato === 'in_elaborazione') {
        return inviaProblemDetails(risposta, 400, {
          title: 'Richiesta non ancora elaborata',
          detail: "Interrogare /status finche' non risponde 303.",
        })
      }

      const esito = transazione.esito!
      return {
        transazione_id: transazione.id,
        errore: esito.errore,
        tipo: esito.tipo ?? null,
        tempo_elaborazione: esito.tempo_elaborazione ?? null,
        validazione: esito.validazione ?? [],
        esito: esito.esito ? aEfirPublicModel(esito.esito) : null,
      }
    }
  )

  // --- Elenco blocchi (GET /) -----------------------------------------------

  app.get<{ Querystring: QueryElencoBlocchi }>(`${PREFISSO}/`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta)).ok) return

    if (!richiesta.query.identificativo) {
      return inviaProblemDetails(risposta, 400, {
        title: 'Parametro obbligatorio mancante',
        detail: "'identificativo' e' obbligatorio (query).",
      })
    }

    const elenco = vidimazione.elencaBlocchi({
      identificativo: richiesta.query.identificativo,
      numIscrSito: richiesta.query.num_iscr_sito,
      codiceBlocco: richiesta.query.codice_blocco,
      ancheDisattivi: richiesta.query.anche_disattivi === 'true',
    })

    const pagingPage = Number(richiesta.headers['paging-page'] ?? 1)
    const pagingPageSize = Number(richiesta.headers['paging-pagesize'] ?? 100)
    const totale = elenco.length

    risposta.header('Paging-Page', pagingPage)
    risposta.header('Paging-PageSize', pagingPageSize)
    risposta.header('Paging-PageCount', Math.max(1, Math.ceil(totale / pagingPageSize)))
    risposta.header('Paging-TotalRecordCount', totale)

    return elenco.map(aBloccoModel)
  })

  // --- Vidimazione a blocchi (priorita' 1) ----------------------------------

  // POST /{codice_blocco} (righe "Vidimazione nuovo FIR"): ASYNC, 202 +
  // TransazioneModel + header Location (assente se X-ReplyTo, stesso
  // trattamento di `dati-registri.ts`/`trasmissioni-dati.ts`).
  app.post<{ Params: ParamsIdentificativo }>(
    `${PREFISSO}/:identificativo`,
    async (richiesta, risposta) => {
      const esitoAuth = await autentica(richiesta, risposta)
      if (!esitoAuth.ok) return

      const codiceBlocco = richiesta.params.identificativo
      if (!vidimazione.bloccoConosciuto(codiceBlocco)) {
        return inviaProblemDetails(risposta, 404, { title: 'Blocco non trovato' })
      }

      const id = vidimazione.creaTransazioneVidimazione(codiceBlocco)
      const rispostaConStato = risposta.status(202)
      if (!richiesta.headers['x-replyto']) {
        rispostaConStato.header('Location', `${PREFISSO}/${id}/status`)
      }
      return rispostaConStato.send({ transazione_id: id })
    }
  )

  // GET /{codice_blocco} (righe "Elenco FIR vidimati").
  app.get<{ Params: ParamsIdentificativo; Querystring: QueryElencoFir }>(
    `${PREFISSO}/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const codiceBlocco = richiesta.params.identificativo
      if (!vidimazione.bloccoConosciuto(codiceBlocco)) {
        return inviaProblemDetails(risposta, 404, { title: 'Blocco non trovato' })
      }

      const elenco = vidimazione.elencaFir(codiceBlocco, {
        progressivoIniziale: richiesta.query.progressivo_iniziale
          ? Number(richiesta.query.progressivo_iniziale)
          : undefined,
        progressivoFinale: richiesta.query.progressivo_finale
          ? Number(richiesta.query.progressivo_finale)
          : undefined,
      })

      const pagingPage = Number(richiesta.headers['paging-page'] ?? 1)
      const pagingPageSize = Number(richiesta.headers['paging-pagesize'] ?? 100)
      const totale = elenco.length

      risposta.header('Paging-Page', pagingPage)
      risposta.header('Paging-PageSize', pagingPageSize)
      risposta.header('Paging-PageCount', Math.max(1, Math.ceil(totale / pagingPageSize)))
      risposta.header('Paging-TotalRecordCount', totale)

      return elenco.map(aEfirPublicModel)
    }
  )

  // GET /{codice_blocco}/{progressivo} (righe "Dati di vidimazione FIR").
  app.get<{ Params: ParamsIdentificativoProgressivo; Querystring: { xml?: string } }>(
    `${PREFISSO}/:identificativo/:progressivo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const codiceBlocco = richiesta.params.identificativo
      const progressivo = Number(richiesta.params.progressivo)
      const fir = vidimazione.firPerProgressivo(codiceBlocco, progressivo)
      if (!fir) {
        return inviaProblemDetails(risposta, 404, { title: 'FIR vidimato non trovato' })
      }

      return aEfirModel(fir, richiesta.query.xml === 'true')
    }
  )

  // PUT /{codice_blocco}/{progressivo}/annulla (righe "Annulla vidimazione FIR"): 200 senza corpo.
  app.put<{ Params: ParamsIdentificativoProgressivo }>(
    `${PREFISSO}/:identificativo/:progressivo/annulla`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const codiceBlocco = richiesta.params.identificativo
      const progressivo = Number(richiesta.params.progressivo)
      const esito = vidimazione.annullaFir(codiceBlocco, progressivo)

      if (esito === 'non-trovato') {
        return inviaProblemDetails(risposta, 404, { title: 'FIR vidimato non trovato' })
      }
      if (esito === 'gia-annullato') {
        return inviaProblemDetails(risposta, 400, {
          title: 'FIR gia annullato',
          detail: "L'annullamento non e' reversibile.",
        })
      }
      return risposta.status(200).send()
    }
  )

  // GET /{codice_blocco}/{progressivo}/pdf (righe "Modello FIR PDF"): stesso
  // pattern del PDF di `formulari.ts` (base64 fittizio, nessun rendering reale).
  app.get<{ Params: ParamsIdentificativoProgressivo }>(
    `${PREFISSO}/:identificativo/:progressivo/pdf`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const codiceBlocco = richiesta.params.identificativo
      const progressivo = Number(richiesta.params.progressivo)
      const fir = vidimazione.firPerProgressivo(codiceBlocco, progressivo)
      if (!fir) {
        return inviaProblemDetails(risposta, 404, { title: 'FIR vidimato non trovato' })
      }

      const contenuto = Buffer.from(`%PDF-FAKE ${fir.numeroFir}`, 'utf-8').toString('base64')
      return {
        nome_file: `FIR-${fir.numeroFir}.pdf`,
        mime: 'application/pdf',
        content: contenuto,
      }
    }
  )

  // --- Verifica pubblica (priorita' 2) --------------------------------------

  app.get<{ Params: { numero_fir: string } }>(
    `${PREFISSO}/verifica/:numero_fir`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return

      const fir = vidimazione.firPerNumero(richiesta.params.numero_fir)
      if (!fir) {
        return inviaProblemDetails(risposta, 404, { title: 'Numero FIR non trovato' })
      }
      return aEfirPublicModel(fir)
    }
  )

  // --- Resto (priorita' 3) ---------------------------------------------------

  // GET /status (righe "Stato API"): sempre "Ok", nessun guasto simulato qui
  // (il guasto globale del canale di controllo, condiviso da `app.ts`, resta
  // il meccanismo per simulare 429/423/403/503).
  app.get(`${PREFISSO}/status`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta)).ok) return
    return { status: 'Ok', warnings: [], planned_notices: [] }
  })

  // GET /certificati/{certificato_id} (righe "Certificato di firma"):
  // **fuori scope dichiarato** oltre alla forma della risposta — questa fake
  // non possiede alcun certificato reale dell'ente con cui firma il
  // `qr_code_bytes` (v. commento di `generaQrCodeBytes`), quindi restituisce
  // sempre un elenco vuoto invece di un certificato inventato.
  app.get<{ Params: { certificato_id: string } }>(
    `${PREFISSO}/certificati/:certificato_id`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta)).ok) return
      return []
    }
  )
}
