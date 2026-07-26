import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio, EXPIRES_IN_DEFAULT_SECONDI } from '../stato/archivio'
import { inviaProblemDetails } from '../errori/problem-details'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/ca-rentri/v1.0'

/**
 * Servizio `ca-rentri` — FIRMA REMOTA RENTRI (R3 Task 3).
 *
 * ## Avvertenza sulla fedeltà, diversa da quella delle altre rotte
 *
 * Ogni altra rotta di questa fake è verificata contro un **contratto OpenAPI
 * ufficiale** (`docs/contracts/rentri/*.yaml`), citato riga per riga nei
 * commenti. **`ca-rentri` non ha alcun contratto pubblico**: la
 * documentazione vive in una pagina che richiede rendering JavaScript e nei
 * PDF degli incontri di formazione per Software House (v.
 * `docs/adr/2026-07-26-firma-fir-firma-remota-rentri.md`, «Lacune ancora
 * aperte»).
 *
 * Di conseguenza, nomi dei campi, forme delle risposte e codici di stato
 * qui sotto sono **la nostra migliore ricostruzione da fonti secondarie**,
 * non una trascrizione. Questa fake dimostra che il nostro client percorre
 * correttamente il CICLO che abbiamo ricostruito; **non** dimostra che
 * quel ciclo sia identico a quello dell'ente. Le due assunzioni più esposte,
 * entrambe segnalate anche lato client:
 * - `credentials_id` passato in **query** su `GET /credentials/info`
 *   (nessuna fonte dice se query o header);
 * - risposta di `sign-hash` nella forma CSC `{ signatures: [...] }`.
 *
 * ## Cosa la fake NON simula
 *
 * - Il **boarding** (`GET /credentials/boarding/{qrcode_token}`,
 *   `POST /credentials`): è un passo umano sul portale, fuori dal ciclo che
 *   il backend esegue.
 * - `PUT /credentials/authorize-confirmation`: la compie l'app ufficiale sul
 *   dispositivo dell'utente, **mai** il nostro backend. Nella fake il suo
 *   effetto si ottiene dal canale di controllo
 *   (`POST /__controllo/ca-rentri/autorizza/{handle}`).
 * - Il servizio di notifica al dispositivo.
 * - Qualunque verifica che `credentials_id` esista davvero o sia del
 *   chiamante: la fake accetta qualunque identificativo non vuoto.
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
    // Stessa scelta di formulari.ts/transazioni.ts: 403, mai 401.
    await inviaProblemDetails(risposta, 403, {
      title: 'Operazione non consentita',
      detail: esito.motivo,
    })
    return false
  }

  return true
}

interface CorpoAuthorize {
  credentials_id?: string
  num_signatures?: number
  hashes?: string[]
  hash_algo?: string
  description?: string
  auth_data?: string | null
  client_data?: string | null
  /**
   * NON è un campo dell'ente: estensione della sola fake, per permettere a un
   * test di ottenere una scadenza breve senza attendere il default reale.
   * Deliberatamente prefissato per non confondersi con il corpo ufficiale.
   */
  __expires_in_test?: number
}

interface CorpoSignHash {
  credentials_id?: string
  sad?: string
  hashes?: string[]
  sign_algo?: string
}

export function registraRotteCaRentri(app: FastifyInstance, archivio: Archivio): void {
  // GET /credentials/info?cert_info=true&credentials_id=...
  // Restituisce il certificato X.509 della credenziale di firma remota:
  // senza, /hash e /acquisizione-firma non si possono nemmeno chiamare.
  app.get<{ Querystring: { cert_info?: string; credentials_id?: string } }>(
    `${PREFISSO}/credentials/info`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      if (!richiesta.query.credentials_id) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Parametro richiesto non specificato',
          detail: "'credentials_id' e' obbligatorio.",
        })
      }

      return { certificato: archivio.certificatoFirmaRemota() }
    }
  )

  // POST /credentials/authorize — crea la sessione di autorizzazione. NON la
  // conferma: la conferma e' un gesto dell'utente sul proprio dispositivo.
  app.post<{ Body: CorpoAuthorize }>(
    `${PREFISSO}/credentials/authorize`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const corpo = richiesta.body ?? {}
      const credentialsId = corpo.credentials_id
      const hashes = corpo.hashes

      if (!credentialsId || credentialsId.trim() === '') {
        return inviaProblemDetails(risposta, 400, {
          title: 'Parametro richiesto non specificato',
          detail: "'credentials_id' e' obbligatorio.",
        })
      }
      if (!Array.isArray(hashes) || hashes.length === 0) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Parametro richiesto non specificato',
          detail: "'hashes' deve contenere almeno un digest.",
        })
      }
      // "Massimo un hash per richiesta" e' l'unico vincolo quantitativo
      // dichiarato esplicitamente dalla documentazione ufficiale: la fake lo
      // applica, cosi' un client che un domani ne inviasse due se ne
      // accorgerebbe qui invece che in produzione.
      if (hashes.length > 1) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Troppi hash nella richiesta',
          detail: "E' ammesso al massimo un hash per richiesta di autorizzazione.",
        })
      }

      const expiresIn = Number(corpo.__expires_in_test ?? EXPIRES_IN_DEFAULT_SECONDI)
      const sessione = archivio.creaSessioneFirma(credentialsId, hashes, expiresIn)

      return {
        sad: sessione.sad,
        handle: sessione.handle,
        expires_in: expiresIn,
      }
    }
  )

  // GET /credentials/authorize-check/{handle} — 202 in attesa, 200 autorizzata.
  // La scadenza e' calcolata dal TEMPO (creazione + expires_in), non da un
  // contatore di tentativi: un contatore renderebbe l'esito dipendente da
  // quanto spesso il client interroga, che non e' come si comporta una
  // scadenza reale.
  app.get<{ Params: { handle: string } }>(
    `${PREFISSO}/credentials/authorize-check/:handle`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const sessione = archivio.leggiSessioneFirma(richiesta.params.handle)
      if (!sessione) {
        return inviaProblemDetails(risposta, 404, {
          title: 'Autorizzazione non trovata',
          detail: "Nessuna autorizzazione alla firma con questo 'handle'.",
        })
      }

      if (sessione.stato === 'RIFIUTATA') {
        return inviaProblemDetails(risposta, 400, {
          title: 'Autorizzazione rifiutata',
          detail: "L'utente ha rifiutato la richiesta di firma sul proprio dispositivo.",
        })
      }

      if (archivio.sessioneFirmaScaduta(sessione)) {
        return inviaProblemDetails(risposta, 410, {
          title: 'Autorizzazione scaduta',
          detail: "L'autorizzazione non e' stata confermata entro 'expires_in'.",
        })
      }

      if (sessione.stato === 'AUTORIZZATA') {
        return risposta.status(200).send({ stato: 'AUTORIZZATA', handle: sessione.handle })
      }

      return risposta.status(202).send()
    }
  )

  // POST /credentials/sign-hash — firma davvero, solo se autorizzata.
  app.post<{ Body: CorpoSignHash }>(
    `${PREFISSO}/credentials/sign-hash`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const corpo = richiesta.body ?? {}
      const hashes = corpo.hashes

      if (!Array.isArray(hashes) || hashes.length !== 1) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Numero di hash non ammesso',
          detail: "'hashes' deve contenere esattamente un digest.",
        })
      }
      if (!corpo.sad) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Parametro richiesto non specificato',
          detail: "'sad' e' obbligatorio.",
        })
      }

      // Il `sad` lega l'autorizzazione a QUEGLI hash: una firma richiesta con
      // un sad valido ma su un digest diverso da quello autorizzato e'
      // precisamente cio' che il meccanismo esiste per impedire.
      const trovata = trovaSessionePerSad(archivio, corpo.sad)
      if (!trovata) {
        return inviaProblemDetails(risposta, 403, {
          title: 'Autorizzazione non valida',
          detail: "Nessuna autorizzazione corrisponde al 'sad' indicato.",
        })
      }
      if (trovata.stato !== 'AUTORIZZATA') {
        return inviaProblemDetails(risposta, 403, {
          title: 'Firma non autorizzata',
          detail:
            "L'utente non ha ancora confermato l'autorizzazione sul proprio dispositivo: la firma non puo' essere apposta.",
        })
      }
      if (archivio.sessioneFirmaScaduta(trovata)) {
        return inviaProblemDetails(risposta, 410, {
          title: 'Autorizzazione scaduta',
          detail: "Il 'sad' non e' piu' valido.",
        })
      }
      if (trovata.hashes[0] !== hashes[0]) {
        return inviaProblemDetails(risposta, 403, {
          title: 'Hash non corrispondente',
          detail: "Il digest richiesto non e' quello per cui l'autorizzazione e' stata concessa.",
        })
      }

      // Forma CSC assunta (v. avvertenza in testa al file).
      return { signatures: [archivio.firmaHash(hashes[0])] }
    }
  )
}

/**
 * La documentazione non offre un modo di risalire dalla `sad` alla sessione:
 * qui si scandiscono le sessioni note, sufficiente per una fake in memoria.
 */
function trovaSessionePerSad(archivio: Archivio, sad: string) {
  return archivio.elencaSessioniFirma().find(s => s.sad === sad)
}
