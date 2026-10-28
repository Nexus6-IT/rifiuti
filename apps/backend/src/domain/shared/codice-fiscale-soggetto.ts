import { PartitaIva } from './partita-iva.vo'

/**
 * Codice fiscale di un soggetto del MUD (destinatario, trasportatore): partita IVA di 11 cifre
 * o codice fiscale di persona di 16 caratteri, con il controllo del carattere finale
 * (Decisione 18 del piano MUD).
 *
 * Nel codice ci sono già due controlli parziali, che qui non si riusano (ruling A9):
 * - `FiscalCode.isValid` (`domain/shared/fiscal-code.vo.ts`) verifica solo la forma, senza il
 *   carattere di controllo, e rifiuta l'omocodia (lettere al posto delle cifre);
 * - `validateCodiceFiscaleChecksum` (`infrastructure/security/input-sanitization.service.ts`)
 *   ha le stesse tabelle di questo file, ma è privato a un servizio.
 * Follow-up: far delegare entrambi a questa funzione.
 */

/** Forma del CF di persona, omocodia compresa (lettere LMNPQRSTUV al posto delle cifre). */
const FORMA_CF_PERSONA =
  /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/

const CARATTERI = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Valore dei caratteri in posizione dispari (1ª, 3ª, …), nell'ordine di `CARATTERI`. */
// prettier-ignore
const VALORI_DISPARI = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, // 0-9
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, // A-J
  2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23, // K-Z
]

/** Valore dei caratteri in posizione pari: le cifre valgono sé stesse, A-Z da 0 a 25. */
function valorePari(c: string): number {
  const i = CARATTERI.indexOf(c)
  return i < 10 ? i : i - 10
}

function carattereDiControllo(primi15: string): string {
  let somma = 0
  for (let i = 0; i < 15; i++) {
    const c = primi15[i]
    // i è 0-based: le posizioni dispari dell'algoritmo sono gli indici pari
    somma += i % 2 === 0 ? VALORI_DISPARI[CARATTERI.indexOf(c)] : valorePari(c)
  }
  return String.fromCharCode('A'.charCodeAt(0) + (somma % 26))
}

/** Maiuscolo, senza spazi e senza il prefisso `IT` davanti a una partita IVA. */
export function normalizzaCodiceFiscaleSoggetto(valore: string | null | undefined): string {
  const pulito = (valore ?? '').replace(/\s/g, '').toUpperCase()
  return /^IT\d{11}$/.test(pulito) ? pulito.slice(2) : pulito
}

export function codiceFiscaleSoggettoValido(valore: string): boolean {
  const v = normalizzaCodiceFiscaleSoggetto(valore)
  if (/^\d{11}$/.test(v)) return PartitaIva.isValid(v)
  if (!FORMA_CF_PERSONA.test(v)) return false
  return carattereDiControllo(v.slice(0, 15)) === v[15]
}
