import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio } from '../stato/archivio'
import { numeroFirValido } from '../dominio/numero-fir'
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
