import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { verificaJwt } from '../auth/jwt-verifier'
import { Archivio, EXPIRES_IN_DEFAULT_SECONDI } from '../stato/archivio'
import { inviaProblemDetails } from '../errori/problem-details'
import forge from 'node-forge'
import { certificatoCaPem } from '../auth/ca-test'
import { validaCredentialsAuthorize, validaSignHash } from '../dominio/ca-rentri'

const AUDIENCE = process.env.RENTRI_AUDIENCE ?? 'rentrigov.demo.api'
const PREFISSO = '/ca-rentri/v1.0'
/** Valori di `CredentialsCertificate` (ca-rentri.yaml:2682). */
const CERTIFICATI_AMMESSI = ['None', 'Single', 'Chain']

/** Certificato della CA di prova della fake, in base64 DER (secondo anello della catena). */
function certificatoCaBase64Der(): string {
  const der = forge.asn1.toDer(
    forge.pki.certificateToAsn1(forge.pki.certificateFromPem(certificatoCaPem()))
  )
  return forge.util.encode64(der.getBytes())
}

/**
 * Servizio `ca-rentri` — FIRMA REMOTA RENTRI (R3 Task 3).
 *
 * ## Fedeltà al contratto
 *
 * Il contratto ufficiale esiste ed e' versionato in
 * `docs/contracts/rentri/ca-rentri.yaml` (v. `MANIFEST.md`, v1.0.20260831).
 * - **Allineato**: `GET /credentials/info` (ca-rentri.yaml:1294; risposta
 *   `CredentialsInfoResponse` a :2779, certificato in `cert.certificates[]`
 *   scelto da `certificates`, `credentials_id` in query obbligatorio di 9
 *   caratteri) e `POST /signatures/sign-hash` (ca-rentri.yaml:2019; risposta
 *   `SignatureResponse` a :3560, `{ signatures: string[] }`). Il vecchio
 *   `/credentials/sign-hash` NON esiste nel contratto e qui risponde 404; la
 *   guardia `test/rotte-allineate-ai-contratti.test.ts` verifica metodo e path
 *   delle rotte contro il contratto.
 * - **Allineato**: `POST /credentials/authorize` (:825; risponde `{ handle }`,
 *   corpo validato su `CredentialsAuthorizeRequest` :2617) e
 *   `GET /credentials/authorize-check/{handle}` (:906; 202 in attesa, 200 con
 *   `sad`/`expires_in`/`handle` se concessa, 400 scaduta, 403 non concessa;
 *   `CredentialsAuthorizeResponse` :2665). Il 422 «notifica non inviata» non
 *   e' simulato (la fake non ha un servizio di notifica).
 * - **Ancora non verificato**: la fake firma con RSA, l'ente con ECDSA
 *   (`sign_algo` 1.2.840.10045.4.3.2); la coincidenza del formato della firma
 *   con quella dell'ente non e' dimostrata.
 *
 * Questa fake dimostra che il nostro client percorre il CICLO; sulla voce
 * "Ancora non verificato" non dimostra la coincidenza con l'ente.
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
  // GET /credentials/info — risponde con `CredentialsInfoResponse`
  // (ca-rentri.yaml:2779). Il certificato di firma remota sta in
  // `cert.certificates[]` (`CertData`, :2346), scelto dal parametro
  // `certificates` (`CredentialsCertificate`, :2682): `None` nessuno, `Single`
  // solo l'ente finale, `Chain` ente finale per primo e poi la CA di prova.
  // Senza `cert_info=true` il blocco `cert` non c'e' (e' nullable nel
  // contratto). Senza `certificates` vale `Single`, come nel CSC.
  app.get<{
    Querystring: { cert_info?: string; credentials_id?: string; certificates?: string }
  }>(`${PREFISSO}/credentials/info`, async (richiesta, risposta) => {
    if (!(await autentica(richiesta, risposta, archivio))) return

    const { credentials_id: credentialsId, cert_info: certInfo, certificates } = richiesta.query
    if (!credentialsId || credentialsId.length !== 9) {
      return inviaProblemDetails(risposta, 400, {
        title: 'Parametro richiesto non specificato',
        detail: "'credentials_id' e' obbligatorio e di 9 caratteri.",
      })
    }

    const scelta = certificates ?? 'Single'
    if (!CERTIFICATI_AMMESSI.includes(scelta)) {
      return inviaProblemDetails(risposta, 400, {
        title: 'Modello dati non valido',
        detail: "'certificates' ammette None, Single o Chain.",
      })
    }

    if (certInfo !== 'true') return { description: 'Credenziale di firma remota (fake)' }

    const enteFinale = archivio.certificatoFirmaRemota()
    const elenco =
      scelta === 'None'
        ? []
        : scelta === 'Single'
          ? [enteFinale]
          : [enteFinale, certificatoCaBase64Der()]

    return {
      description: 'Credenziale di firma remota (fake)',
      cert: { status: 'Valid', certificates: elenco },
    }
  })

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

      // `CredentialsAuthorizeResponse` (ca-rentri.yaml:2665): alla richiesta
      // l'ente restituisce solo `handle`; `sad` ed `expires_in` arrivano da
      // `authorize-check` quando l'autorizzazione e' concessa.
      return { handle: sessione.handle }
    }
  )

  // GET /credentials/authorize-check/{handle} (ca-rentri.yaml:906-987):
  // 202 in attesa, 200 concessa (`sad`, `expires_in`, `handle`), 400
  // scaduta, 403 non concessa. (Il 422 «notifica non inviata» non e'
  // simulato: la fake non ha un servizio di notifica.) La scadenza e'
  // calcolata dal TEMPO (creazione + expires_in), non da un contatore di
  // tentativi: un contatore renderebbe l'esito dipendente da quanto spesso il
  // client interroga, che non e' come si comporta una scadenza reale.
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
        return inviaProblemDetails(risposta, 403, {
          title: 'Autorizzazione non concessa',
          detail: "L'utente ha rifiutato la richiesta di firma sul proprio dispositivo.",
        })
      }

      if (archivio.sessioneFirmaScaduta(sessione)) {
        return inviaProblemDetails(risposta, 400, {
          title: 'Autorizzazione scaduta',
          detail: "L'autorizzazione non e' stata confermata entro 'expires_in'.",
        })
      }

      if (sessione.stato === 'AUTORIZZATA') {
        // `expires_in` e' un intero (ca-rentri.yaml:2672): secondi residui,
        // almeno 1 finche' la sessione e' valida.
        const expiresIn = Math.max(1, Math.ceil((sessione.scadenzaMs - Date.now()) / 1000))
        return risposta
          .status(200)
          .send({ sad: sessione.sad, expires_in: expiresIn, handle: sessione.handle })
      }

      return risposta.status(202).send({ handle: sessione.handle })
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
      // Ramo difensivo, non raggiungibile via API: un `sad` esiste solo per
      // sessioni già AUTORIZZATE (lo si ottiene da authorize-check).
      if (trovata.stato !== 'AUTORIZZATA') {
        return inviaProblemDetails(risposta, 422, {
          title: 'Firma non autorizzata',
          detail:
            "L'utente non ha ancora confermato l'autorizzazione sul proprio dispositivo: la firma non puo' essere apposta.",
        })
      }
      // Il contratto non ha 410 su sign-hash (:2019-2089): un SAD scaduto e'
      // un «SAD senza autorizzazione», quindi 422.
      if (archivio.sessioneFirmaScaduta(trovata)) {
        return inviaProblemDetails(risposta, 422, {
          title: 'SAD senza autorizzazione',
          detail: "Il 'sad' non e' piu' valido: l'autorizzazione e' scaduta.",
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
