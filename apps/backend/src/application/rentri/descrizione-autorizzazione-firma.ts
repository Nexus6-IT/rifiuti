/**
 * `description` di `POST /ca-rentri/v1.0/credentials/authorize`
 * (`CredentialsAuthorizeRequest.description`, ca-rentri.yaml:2650): lunghezza
 * da 1 a 1000 e pattern
 * `^[A-Za-zÀ-ÖØ-öø-ÿ0-9\s\.,;:!?\-\(\)/€%&@]*$`.
 *
 * È l'unico testo che l'utente legge sul dispositivo prima di confermare la
 * firma, ma l'ente lo rifiuta se contiene un carattere fuori dal pattern. Il
 * caso tipico è `_`, ammesso dal `numero_fir` (separatori ` \t-/_`) e vietato
 * qui; lo era anche il trattino lungo `—` della forma precedente.
 */
const CARATTERE_AMMESSO = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9\s.,;:!?\-()/€%&@]$/

const LUNGHEZZA_MASSIMA = 1000

/**
 * `Firma del formulario <numero> - operazione <tipo>`, con ogni carattere
 * fuori dal pattern del contratto sostituito da `-`.
 *
 * Pura e totale: non solleva mai errori e restituisce sempre una stringa di
 * 1-1000 caratteri che rispetta il pattern (il prefisso fisso garantisce che
 * non sia vuota).
 */
export function descrizioneAutorizzazioneFirma(numeroFir: string, tipoOperazione: string): string {
  const testo = `Firma del formulario ${String(numeroFir)} - operazione ${String(tipoOperazione)}`

  // Per code point, non per unità UTF-16: un carattere fuori dal BMP (emoji)
  // vale un solo `-`, e dopo la sostituzione ogni carattere è nel BMP, quindi
  // il troncamento sotto non può spezzare una coppia surrogata.
  const ripulito = Array.from(testo, c => (CARATTERE_AMMESSO.test(c) ? c : '-')).join('')

  return ripulito.slice(0, LUNGHEZZA_MASSIMA)
}
