/**
 * Interruttore di emergenza degli invii allo SDI (4.5b, piano §4.4).
 *
 * `SDI_INVII_ATTIVI`: assente o qualunque valore diverso dal testo esatto `true` = invii SPENTI
 * (default). E' il contrario dell'interruttore di RENTRI: qui un errore di battitura NON deve mai
 * far partire fatture fiscali, quindi gli invii si accendono solo con il letterale `true` (nessuna
 * interpretazione di "1", "yes", "TRUE", spazi). Si accende solo al pilota (4.5f).
 *
 * Spento significa: l'accodamento risponde 409 `INVII_SDI_SOSPESI` (nessun documento diventa
 * «emesso» senza poter partire) e il job non prenota ne' invia; la riconciliazione degli invii
 * incerti (solo `cerca`, nessun invio) prosegue. Si legge a ogni chiamata.
 */
export const VARIABILE_INVII_SDI = 'SDI_INVII_ATTIVI'

export function inviiSdiAttivi(): boolean {
  return process.env.SDI_INVII_ATTIVI === 'true'
}
