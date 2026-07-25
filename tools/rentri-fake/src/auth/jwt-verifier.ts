import { importX509, jwtVerify } from 'jose'
import forge from 'node-forge'
import { certificatoCaPem } from './ca-test'
import { soggettoAccreditato } from './soggetti-accreditati'

export interface OpzioniVerifica {
  audienceAttesa: string
  adesso?: Date
  registroReplay?: RegistroReplay
}

/**
 * Rifiuto del riutilizzo del `jti` (FEDELTA.md §5.2 punto 3): un token privo
 * di anti-replay puo' essere intercettato e rigiocato indefinitamente. Il
 * verificatore non impone un'implementazione: chi lo invoca decide dove
 * persistere i `jti' gia' visti (nella fake, `Archivio`, azzerato da
 * `__controllo/azzera` insieme al resto dello stato).
 */
export interface RegistroReplay {
  giaUsato(jti: string): boolean
  registra(jti: string): void
}

/** Implementazione di riferimento in memoria di RegistroReplay, per i test unitari. */
export class RegistroReplayMemoria implements RegistroReplay {
  private usati = new Set<string>()

  giaUsato(jti: string): boolean {
    return this.usati.has(jti)
  }

  registra(jti: string): void {
    this.usati.add(jti)
  }

  azzera(): void {
    this.usati.clear()
  }
}

export type EsitoVerifica = { valido: true; soggetto: string } | { valido: false; motivo: string }

// ID_AUTH_REST_02 (ModI AgID) vincola l'algoritmo di firma del JWT
// self-issued a RS256: nessun altro algoritmo, incluso PS256, e' ammesso.
const ALGORITMO_ATTESO = 'RS256'

// Finestra massima ammessa tra iat ed exp: un token self-issued in direct
// trust serve a provare il possesso della chiave per la singola richiesta,
// non a costituire una sessione lunga. 5 minuti e' il valore di riferimento
// usato nella documentazione ModI per questo pattern.
const FINESTRA_MASSIMA_SECONDI = 300

/**
 * Verifica un JWT self-issued secondo il pattern AgID ID_AUTH_REST_02 in
 * direct trust: la chiave pubblica NON viene da un registro, ma dal
 * certificato che il chiamante allega nell'header x5c. In direct trust
 * l'unico controllo che conta davvero e' *da chi* viene il certificato
 * (FEDELTA.md §3.4): verifichiamo quindi l'intera catena verso la CA di
 * prova fissa della fake, la finestra di validita' del certificato, le
 * claim ModI (iss/aud/iat/exp/jti), la non-rigiocabilita' del jti, e infine
 * che il soggetto dichiarato sia un operatore accreditato noto alla fake.
 */
export async function verificaJwt(
  authorization: string | undefined,
  opzioni: OpzioniVerifica
): Promise<EsitoVerifica> {
  if (!authorization) {
    return { valido: false, motivo: 'header Authorization assente' }
  }

  const [schema, token] = authorization.split(' ')
  if (schema !== 'Bearer' || !token) {
    return { valido: false, motivo: 'schema di autorizzazione non Bearer' }
  }

  let intestazione: { x5c?: string[] }
  try {
    intestazione = JSON.parse(Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'))
  } catch {
    return { valido: false, motivo: 'intestazione JWT illeggibile' }
  }

  const x5c = intestazione.x5c
  if (!x5c || x5c.length === 0) {
    return { valido: false, motivo: 'header x5c assente' }
  }

  const pem = `-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`
  const adesso = opzioni.adesso ?? new Date()

  const esitoCatena = verificaCatenaCertificato(pem, adesso)
  if (!esitoCatena.valida) {
    return { valido: false, motivo: esitoCatena.motivo }
  }

  try {
    const chiavePubblica = await importX509(pem, ALGORITMO_ATTESO)
    const { payload } = await jwtVerify(token, chiavePubblica, {
      audience: opzioni.audienceAttesa,
      // Vincola l'algoritmo: il rifiuto di `alg: none` (e di `PS256`) e' ora
      // un controllo esplicito, non un effetto collaterale del parsing
      // (FEDELTA.md §5.2 punto 2).
      algorithms: [ALGORITMO_ATTESO],
      currentDate: adesso,
      // Punto 3: un token senza queste claim non e' un JWT ID_AUTH_REST_02
      // valido, a prescindere dalla firma.
      requiredClaims: ['sub', 'iss', 'iat', 'exp', 'jti'],
    })

    const iat = payload.iat as number
    const exp = payload.exp as number
    const finestra = exp - iat
    if (finestra > FINESTRA_MASSIMA_SECONDI) {
      return {
        valido: false,
        motivo: `finestra di validita' del token troppo ampia (${finestra}s, massimo ${FINESTRA_MASSIMA_SECONDI}s)`,
      }
    }

    const jti = String(payload.jti)
    if (opzioni.registroReplay) {
      if (opzioni.registroReplay.giaUsato(jti)) {
        return { valido: false, motivo: "token gia' utilizzato (claim jti riproposto)" }
      }
      opzioni.registroReplay.registra(jti)
    }

    const soggetto = String(payload.sub)
    if (!soggettoAccreditato(soggetto)) {
      return { valido: false, motivo: `soggetto '${soggetto}' non accreditato presso RENTRI` }
    }

    return { valido: true, soggetto }
  } catch (errore) {
    return { valido: false, motivo: `verifica fallita: ${(errore as Error).message}` }
  }
}

function verificaCatenaCertificato(
  pemOperatore: string,
  adesso: Date
): { valida: true } | { valida: false; motivo: string } {
  let certificatoOperatore: forge.pki.Certificate
  let certificatoCa: forge.pki.Certificate
  try {
    certificatoOperatore = forge.pki.certificateFromPem(pemOperatore)
    certificatoCa = forge.pki.certificateFromPem(certificatoCaPem())
  } catch {
    return { valida: false, motivo: 'certificato illeggibile' }
  }

  if (adesso < certificatoOperatore.validity.notBefore || adesso > certificatoOperatore.validity.notAfter) {
    return { valida: false, motivo: 'certificato scaduto o non ancora valido' }
  }

  try {
    if (!certificatoCa.verify(certificatoOperatore)) {
      return {
        valida: false,
        motivo: "certificato non emesso dalla CA di prova attesa dalla fake",
      }
    }
  } catch {
    // node-forge lancia se il certificato non e' strutturalmente
    // verificabile contro questa CA (es. algoritmi incompatibili): e'
    // comunque un rifiuto della catena, non un errore da propagare.
    return { valida: false, motivo: "certificato non emesso dalla CA di prova attesa dalla fake" }
  }

  return { valida: true }
}
