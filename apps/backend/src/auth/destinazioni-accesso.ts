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

/** Restituisce la destinazione per la chiave ricevuta, oppure null se non e' nell'elenco. */
export function risolviDestinazioneAccesso(valore: unknown): DestinazioneAccesso | null {
  if (typeof valore !== 'string') return null
  if (!Object.prototype.hasOwnProperty.call(DESTINAZIONI_ACCESSO, valore)) return null
  return DESTINAZIONI_ACCESSO[valore as ChiaveDestinazioneAccesso]
}
