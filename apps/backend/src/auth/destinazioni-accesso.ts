/**
 * Destinazioni ammesse per il ritorno del login SPID/CIE (RelayState SAML).
 *
 * Elenco CHIUSO di chiavi: il valore ricevuto dal browser non e' mai un URL ne' un percorso, e'
 * solo la chiave di questa tabella. Qualunque altro valore (assente, sconosciuto, URL, oggetto)
 * cade sul percorso predefinito del frontend d'ufficio: nessun open redirect possibile.
 */
export interface DestinazioneAccesso {
  /** Percorso sull'origine del frontend (`FRONTEND_URL`), a cui si aggiunge il fragment coi token. */
  readonly percorso: string
  /** Durata del refresh token, in giorni, quando l'utente ha il ruolo indicato in `ruoloRefreshLungo`. */
  readonly refreshGiorni: number
  readonly ruoloRefreshLungo: string
}

export const DESTINAZIONI_ACCESSO = {
  campo: { percorso: '/campo/accesso', refreshGiorni: 30, ruoloRefreshLungo: 'AUTISTA' },
} as const satisfies Record<string, DestinazioneAccesso>

export type ChiaveDestinazioneAccesso = keyof typeof DESTINAZIONI_ACCESSO

/** Percorso predefinito (frontend d'ufficio) e durata standard del refresh. */
export const PERCORSO_ACCESSO_PREDEFINITO = '/auth/callback'
export const REFRESH_GIORNI_PREDEFINITO = 7

/**
 * RelayState = `<chiave>` oppure `<chiave>.<nonce>`: il nonce (16-32 caratteri base64url) lo genera
 * il browser prima del login e lo rimanda indietro nel fragment; l'app accetta i token solo se
 * coincide con quello che ha salvato (difesa dal login CSRF: link con i token di un altro utente).
 */
const RELAY_STATE_CON_NONCE = /^([a-z]+)\.([A-Za-z0-9_-]{16,32})$/

export interface RelayStateLetto {
  destinazione: DestinazioneAccesso | null
  nonce: string | null
}

function perChiave(chiave: string): DestinazioneAccesso | null {
  if (!Object.prototype.hasOwnProperty.call(DESTINAZIONI_ACCESSO, chiave)) return null
  return DESTINAZIONI_ACCESSO[chiave as ChiaveDestinazioneAccesso]
}

/** Legge il RelayState ricevuto dall'IdP: solo chiavi dell'elenco chiuso, nonce solo se ben formato. */
export function leggiRelayState(valore: unknown): RelayStateLetto {
  const nessuna: RelayStateLetto = { destinazione: null, nonce: null }
  if (typeof valore !== 'string') return nessuna
  const conNonce = RELAY_STATE_CON_NONCE.exec(valore)
  if (conNonce) {
    const destinazione = perChiave(conNonce[1])
    return destinazione ? { destinazione, nonce: conNonce[2] } : nessuna
  }
  const destinazione = perChiave(valore)
  return destinazione ? { destinazione, nonce: null } : nessuna
}

/** Restituisce la destinazione per il RelayState ricevuto, oppure null se non e' nell'elenco. */
export function risolviDestinazioneAccesso(valore: unknown): DestinazioneAccesso | null {
  return leggiRelayState(valore).destinazione
}
