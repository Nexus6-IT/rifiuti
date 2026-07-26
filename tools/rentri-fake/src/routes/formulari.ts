import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio } from '../stato/archivio'
import { numeroFirValido } from '../dominio/numero-fir'
import { operazioniPerStato } from '../dominio/operazione'
import { inviaProblemDetails } from '../errori/problem-details'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/formulari/v1.0'

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
    // Il contratto documenta 403 "Operazione non consentita" su ogni
    // operazione (formulari.yaml, es. righe 164-165) e non documenta mai
    // 401. La fake precedente rispondeva 401, un codice che il contratto
    // non prevede su alcuna rotta.
    await inviaProblemDetails(risposta, 403, {
      title: 'Operazione non consentita',
      detail: esito.motivo,
    })
    return false
  }

  return true
}

interface QueryElenco {
  num_iscr_sito?: string
  identificativo_soggetto?: string
}

export function registraRotteFormulari(app: FastifyInstance, archivio: Archivio): void {
  app.get<{ Querystring: QueryElenco }>(`${PREFISSO}/`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio))) return

    // formulari.yaml righe 22-47: uno tra num_iscr_sito e
    // identificativo_soggetto deve essere valorizzato, altrimenti 400. La
    // fake precedente rispondeva 200 a una richiesta nuda.
    const { num_iscr_sito, identificativo_soggetto } = richiesta.query
    if (!num_iscr_sito && !identificativo_soggetto) {
      return inviaProblemDetails(risposta, 400, {
        title: 'Parametri richiesti non specificati',
        detail: "Uno tra 'num_iscr_sito' e 'identificativo_soggetto' e' obbligatorio.",
      })
    }

    const pagingPage = Number(richiesta.headers['paging-page'] ?? 1)
    const pagingPageSize = Number(richiesta.headers['paging-pagesize'] ?? 100)
    // Filtro secondo il contratto: identificativo_soggetto e num_iscr_sito
    // sono mutuamente esclusivi lato client (v. RENTRIApiClient.cercaFormulari);
    // qui si applica quello effettivamente presente in query.
    const elenco = archivio.elencaFormulari({
      identificativoSoggetto: identificativo_soggetto,
      numIscrSito: num_iscr_sito,
    })
    const totale = elenco.length
    const pageCount = Math.max(1, Math.ceil(totale / pagingPageSize))

    // Header dichiarati sulla risposta 200 (formulari.yaml righe 134-157):
    // la fake precedente non li emetteva mai.
    risposta.header('Paging-Page', pagingPage)
    risposta.header('Paging-PageSize', pagingPageSize)
    risposta.header('Paging-PageCount', pageCount)
    risposta.header('Paging-TotalRecordCount', totale)

    // FormularioItemResult (formulari.yaml righe 9686-9800): qui solo i
    // campi che questo task verifica — visibilita_sito_acquisita è quello
    // decisivo, calcolato da `sitiConVisibilita` (v. Archivio).
    return elenco.map(f => ({
      numero_fir: f.numero_fir,
      identificativo_soggetto: f.identificativo_soggetto ?? null,
      num_iscr_sito: f.num_iscr_sito ?? null,
      stato: f.stato,
      visibilita_sito_acquisita: (f.sitiConVisibilita?.length ?? 0) > 0,
    }))
  })

  // /count e /status sono path ufficiali distinti da /{numero_fir}
  // (formulari.yaml righe 4450 e 4578): vanno registrati esplicitamente
  // perché non cadano nel gestore generico sottostante, che altrimenti li
  // maschera dietro un 404 di dominio "Formulario non trovato" — una
  // lacuna che si traveste da comportamento di dominio, invece di essere
  // dichiarata. Qui rispondono 501, riconoscibili come non implementati.
  app.get(`${PREFISSO}/count`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio))) return
    return inviaProblemDetails(risposta, 501, {
      title: 'Non implementato nella fake',
      detail: `GET ${PREFISSO}/count e' un path ufficiale del contratto ma non e' implementato in questa fake (v. FEDELTA.md).`,
    })
  })

  // GET /status (formulari.yaml riga 4578, "Verifica dello stato dell'API")
  // non richiede autenticazione nel contratto: nessun 403 e' documentato
  // per questa operazione.
  app.get(`${PREFISSO}/status`, async (_richiesta, risposta) => {
    return inviaProblemDetails(risposta, 501, {
      title: 'Non implementato nella fake',
      detail: `GET ${PREFISSO}/status e' un path ufficiale del contratto ma non e' implementato in questa fake (v. FEDELTA.md).`,
    })
  })

  // GET /{numero_fir}/stato (formulari.yaml riga 2265, "Consultazione dello
  // stato del formulario"): risposta 200 = InfoFormulario
  // ({versione, stato_formulario}). Nessun parametro oltre al path — a
  // differenza di /azioni sotto, che richiede identificativo_soggetto.
  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/:identificativo/stato`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const numeroFir = richiesta.params.identificativo
      if (!numeroFirValido(numeroFir)) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Numero FIR non valido',
          detail: `'${numeroFir}' non rispetta il pattern numero_fir del contratto.`,
        })
      }

      const formulario = archivio.leggiFormulario(numeroFir)
      if (!formulario) {
        return inviaProblemDetails(risposta, 404, { title: 'Formulario non trovato' })
      }

      return {
        versione: formulario.versione ?? null,
        stato_formulario: formulario.stato,
      }
    }
  )

  // GET /{numero_fir}/azioni (formulari.yaml riga 1330, "Azioni disponibili
  // sul formulario"): risposta 200 = AzioniResult ({versione, stato, azioni}).
  // `identificativo_soggetto` e' OBBLIGATORIO (righe 1348-1353, il CF del
  // soggetto per cui si chiedono le azioni) — a differenza di GET /{numero_fir}
  // e di /stato sopra. `num_iscr_sito` opzionale non e' gestito da questa fake
  // (fuori scope Task 2 R3: acquisirebbe automaticamente la visibilita').
  app.get<{
    Params: { identificativo: string }
    Querystring: { identificativo_soggetto?: string }
  }>(`${PREFISSO}/:identificativo/azioni`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio))) return

    const numeroFir = richiesta.params.identificativo
    if (!numeroFirValido(numeroFir)) {
      return inviaProblemDetails(risposta, 400, {
        title: 'Numero FIR non valido',
        detail: `'${numeroFir}' non rispetta il pattern numero_fir del contratto.`,
      })
    }

    if (!richiesta.query.identificativo_soggetto) {
      return inviaProblemDetails(risposta, 400, {
        title: 'Parametro richiesto non specificato',
        detail: "'identificativo_soggetto' e' obbligatorio.",
      })
    }

    const formulario = archivio.leggiFormulario(numeroFir)
    if (!formulario) {
      return inviaProblemDetails(risposta, 404, { title: 'Formulario non trovato' })
    }

    return {
      versione: formulario.versione ?? null,
      stato: formulario.stato,
      azioni: operazioniPerStato(formulario.stato),
    }
  })

  // POST /{numero_fir}/hash (formulari.yaml riga 1498) e
  // POST /{numero_fir}/acquisizione-firma (riga 531) — R3 Task 3.
  //
  // Entrambe ASYNC: rispondono 202 + TransazioneModel, esattamente come
  // `POST /` in transazioni.ts, e si completano SOLO dal canale di controllo
  // (`/__controllo/completa-transazione`, riusato tale e quale). La fake non
  // decide da sola l'esito di una scrittura: e' il test a stabilire se
  // l'ente accetta o rifiuta, che e' il punto dell'oracolo.
  //
  // Come le altre rotte di dominio, si validano PRIMA il numero FIR (400 di
  // validazione) e l'esistenza del formulario (404), altrimenti un errore di
  // dominio si travestirebbe da transazione accettata.
  const registraOperazioneAsincrona = (
    segmento: string,
    validaCorpo: (corpo: Record<string, unknown>) => string | null
  ): void => {
    app.post<{ Params: { identificativo: string }; Body: Record<string, unknown> }>(
      `${PREFISSO}/:identificativo/${segmento}`,
      async (richiesta, risposta) => {
        if (!(await autentica(richiesta, risposta, archivio))) return

        const numeroFir = richiesta.params.identificativo
        if (!numeroFirValido(numeroFir)) {
          return inviaProblemDetails(risposta, 400, {
            title: 'Numero FIR non valido',
            detail: `'${numeroFir}' non rispetta il pattern numero_fir del contratto.`,
          })
        }

        if (!archivio.leggiFormulario(numeroFir)) {
          return inviaProblemDetails(risposta, 404, { title: 'Formulario non trovato' })
        }

        const motivo = validaCorpo(richiesta.body ?? {})
        if (motivo) {
          return inviaProblemDetails(risposta, 400, {
            title: 'Corpo della richiesta non valido',
            detail: motivo,
          })
        }

        const id = archivio.creaTransazione()
        return risposta
          .status(202)
          .header('Location', `${PREFISSO}/${id}/status`)
          .send({ transazione_id: id })
      }
    )
  }

  // DatiPerFirmaModel (formulari.yaml riga 7614): `certificato` obbligatorio,
  // `tipo_firma` opzionale (non inviato dal nostro client, v. il commento di
  // `RENTRIApiClient.richiediHashPerFirma`).
  registraOperazioneAsincrona('hash', corpo =>
    typeof corpo.certificato === 'string' && corpo.certificato.trim() !== ''
      ? null
      : "'certificato' e' obbligatorio (DatiPerFirmaModel)."
  )

  // FirmaModel (formulari.yaml riga 9646): certificato + token + firma, tutti
  // obbligatori. Un client che dimenticasse il `token` ricevuto da /hash se ne
  // accorgerebbe qui, non in produzione.
  registraOperazioneAsincrona('acquisizione-firma', corpo => {
    const mancanti = ['certificato', 'token', 'firma'].filter(
      campo => typeof corpo[campo] !== 'string' || (corpo[campo] as string).trim() === ''
    )
    return mancanti.length === 0
      ? null
      : `Campi obbligatori mancanti (FirmaModel): ${mancanti.join(', ')}.`
  })

  // Nome del parametro `:identificativo` (non `:numero_fir`): questa rotta
  // condivide la posizione nel path con le rotte di transazione registrate
  // da `registraRotteTransazioni` (`/status`, `/result`). find-my-way
  // (router di Fastify) ammette un solo nome di parametro per posizione
  // nell'albero delle rotte: nomi diversi qui e in `transazioni.ts`
  // causerebbero un errore alla registrazione. Il path esterno resta
  // invariato, cambia solo il nome interno del parametro. Le rotte statiche
  // /count e /status sopra hanno comunque priorità su questo segmento
  // generico nel router di find-my-way.
  app.get<{ Params: { identificativo: string } }>(
    `${PREFISSO}/:identificativo`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const numeroFir = richiesta.params.identificativo

      // formulari.yaml riga 299: un numero_fir mal formato e' un 400 di
      // validazione, non un 404 di dominio — la fake precedente li
      // confondeva.
      if (!numeroFirValido(numeroFir)) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Numero FIR non valido',
          detail: `'${numeroFir}' non rispetta il pattern numero_fir del contratto.`,
        })
      }

      const formulario = archivio.leggiFormulario(numeroFir)
      if (!formulario) {
        return inviaProblemDetails(risposta, 404, { title: 'Formulario non trovato' })
      }

      return formulario
    }
  )
}
