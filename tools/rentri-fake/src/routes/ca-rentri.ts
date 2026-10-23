import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio, EXPIRES_IN_DEFAULT_SECONDI } from '../stato/archivio'
import { inviaProblemDetails } from '../errori/problem-details'
import { validaCredentialsAuthorize, validaSignHash } from '../dominio/ca-rentri'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/ca-rentri/v1.0'

/**
 * Servizio `ca-rentri` — FIRMA REMOTA RENTRI (R3 Task 3).
 *
 * ## Fedeltà al contratto
 *
 * Il contratto ufficiale esiste ed e' versionato in
 * `docs/contracts/rentri/ca-rentri.yaml` (v. `MANIFEST.md`, v1.0.20260831).
 * - **Allineato**: `POST /signatures/sign-hash` (ca-rentri.yaml:2019; risposta
 *   `SignatureResponse` a :3560, `{ signatures: string[] }`). Il vecchio
 *   `/credentials/sign-hash` NON esiste nel contratto e qui risponde 404; la
 *   guardia `test/rotte-allineate-ai-contratti.test.ts` verifica metodo e path
 *   delle rotte contro il contratto.
 * - **NON ancora allineato** (pezzo successivo del Piano B):
 *   - `GET /credentials/info` (:1294, `CredentialsInfoResponse` a :2779): la
 *     fake espone un campo `certificato` che nel contratto non esiste (il
 *     contratto ha `cert.certificates[]`), e il `credentials_id` in query e'
 *     da riverificare;
 *   - `POST /credentials/authorize` (:825) e `authorize-check` (:906): il
 *     CORPO della richiesta e' ora validato su `CredentialsAuthorizeRequest`
 *     (:2617) e quello di sign-hash su `SignatureRequest` (:3517), con 422
 *     dove il contratto lo prevede; restano da allineare la semantica di
 *     `sad`/`expires_in` e i codici di `authorize-check`;
 *
 * Questa fake dimostra che il nostro client percorre il CICLO; dove sopra e'
 * indicato "NON ancora allineato" non dimostra la coincidenza con l'ente.
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

      // `__expires_in_test` e' un'estensione della sola fake: si toglie prima
      // di validare, perche' il contratto ha `additionalProperties: false`.
      const { __expires_in_test: scadenzaDiTest, ...corpoUfficiale } = (richiesta.body ??
        {}) as CorpoAuthorize
      const motivo = validaCredentialsAuthorize(corpoUfficiale)
      if (motivo) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Modello dati non valido',
          detail: motivo,
        })
      }

      // Il contratto ammette esattamente un hash (minItems = maxItems = 1) e
      // un `credentials_id` di 9 caratteri: la validazione sopra li garantisce.
      const credentialsId = corpoUfficiale.credentials_id as string
      const hashes = corpoUfficiale.hashes as string[]

      const expiresIn = Number(scadenzaDiTest ?? EXPIRES_IN_DEFAULT_SECONDI)
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

  // POST /signatures/sign-hash — firma davvero, solo se autorizzata.
  app.post<{ Body: CorpoSignHash }>(
    `${PREFISSO}/signatures/sign-hash`,
    async (richiesta, risposta) => {
      if (!(await autentica(richiesta, risposta, archivio))) return

      const motivo = validaSignHash(richiesta.body)
      if (motivo) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Modello dati non valido',
          detail: motivo,
        })
      }

      const corpo = richiesta.body as Required<CorpoSignHash>
      const hashes = corpo.hashes

      // Contratto (ca-rentri.yaml:2048-2049): 422 = «SAD senza autorizzazione,
      // mancato invio della notifica o mancata corrispondenza degli hash».
      // Il `sad` lega l'autorizzazione a QUEGLI hash: una firma richiesta con
      // un sad valido ma su un digest diverso da quello autorizzato e'
      // precisamente cio' che il meccanismo esiste per impedire.
      const trovata = trovaSessionePerSad(archivio, corpo.sad)
      if (!trovata) {
        return inviaProblemDetails(risposta, 422, {
          title: 'Autorizzazione non valida',
          detail: "Nessuna autorizzazione corrisponde al 'sad' indicato.",
        })
      }
      if (trovata.stato !== 'AUTORIZZATA') {
        return inviaProblemDetails(risposta, 422, {
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
        return inviaProblemDetails(risposta, 422, {
          title: 'Hash non corrispondente',
          detail: "Il digest richiesto non e' quello per cui l'autorizzazione e' stata concessa.",
        })
      }

      // Risposta `SignatureResponse` (ca-rentri.yaml:3560).
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
