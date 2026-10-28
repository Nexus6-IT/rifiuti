/**
 * Dati fiscali validi per i test delle anagrafiche (F2-10). Servono perche' l'applicazione
 * controlla il checksum quando un identificativo viene impostato: una P.IVA "di comodo" come
 * `12345678901` verrebbe rifiutata.
 */

/** Partita IVA con checksum valido. */
export const PIVA_VALIDA = '12345678903'

/** Codice fiscale di persona fisica con carattere di controllo valido. */
export const CF_PERSONA_VALIDO = 'RSSMRA80A01H501U'

/** Stesso codice fiscale scritto con l'omocodia (cifre sostituite da lettere). */
export const CF_PERSONA_OMOCODICO = 'RSSMRA80A01H5RMD'

/** Un secondo codice fiscale valido, diverso dal primo. */
export const CF_PERSONA_ALTRO = 'BNCLRA85M41F205C'

/**
 * Partita IVA valida derivata da un seme numerico (matricola di 7 cifre piu' codice ufficio
 * `000`, poi la cifra di controllo). Semi diversi danno P.IVA diverse.
 */
export function partitaIvaValida(seme: number): string {
  const nove = String(Math.abs(Math.trunc(seme)) % 10_000_000).padStart(7, '0') + '000'
  const cifre = nove.split('').map(Number)
  let somma = 0
  for (let i = 0; i < 10; i++) {
    let c = cifre[i]
    if (i % 2 !== 0) {
      c *= 2
      if (c > 9) c -= 9
    }
    somma += c
  }
  return nove + String((10 - (somma % 10)) % 10)
}

/** Partita IVA di 11 cifre con checksum SBAGLIATO (per i dati "da verificare"). */
export const PIVA_CHECKSUM_ERRATO = '12345678901'
