/**
 * Validazione condivisa dei codici delle tabelle di fatturazione (4.1a, ruling R1).
 *
 * Un solo punto per codice cliente, condizioni di pagamento, conti correnti, spese accessorie,
 * testi e codifiche: stessa regola, stesso messaggio, cambia solo il soggetto e la lunghezza
 * massima. Il messaggio non riporta mai il valore ricevuto.
 *
 * Il `charset` e' una classe di caratteri di una regex (default `[A-Za-z0-9._-]`); i testi e le
 * codifiche del contratto passano `[A-Za-z0-9]` (solo lettere e cifre).
 */

const CHARSET_PREDEFINITO = '[A-Za-z0-9._-]'

export function validaCodiceTabella(
  codice: string,
  max: number,
  soggetto: string,
  charset: string = CHARSET_PREDEFINITO
): string | null {
  const regola = new RegExp(`^${charset}{1,${max}}$`)
  if (regola.test(codice)) return null
  const ammessi =
    charset === CHARSET_PREDEFINITO
      ? 'lettere, cifre, punto, trattino e trattino basso'
      : 'lettere e cifre'
  return `${soggetto} può contenere solo ${ammessi} (massimo ${max} caratteri).`
}
