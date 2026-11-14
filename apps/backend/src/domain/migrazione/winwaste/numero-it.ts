import { errore, Esito, ok } from './risultato'

/**
 * Numeri a testo di WinWaste.
 *
 * Pesi, prezzi e quantita' di `MOVIMENTI`/`FORMULARI` sono `varchar` in
 * formato it-IT (virgola decimale, punto delle migliaia). Mai `parseFloat`
 * grezzo: `1.234` e' ambiguo (milleduecentotrentaquattro o uno virgola due
 * tre quattro) e si rifiuta; il punto e' ammesso solo come separatore delle
 * migliaia in presenza della virgola decimale (`1.234,56`).
 *
 * Le colonne `decimal` (`GIASCAR`, `KGNUM`, `MCNUM`) arrivano nello staging
 * come testo con il punto decimale (`1000.000000`): `decodificaDecimaleSql`.
 */
const IT_CON_VIRGOLA = /^-?(\d+|\d{1,3}(\.\d{3})+),\d+$/
const IT_INTERO = /^-?\d+$/
const SQL_DECIMALE = /^-?\d+(\.\d+)?$/

function normalizza(n: number): number {
  return n === 0 ? 0 : n // evita -0
}

export function decodificaNumeroIt(valore: string | null): Esito<number | null, 'NUMERO_IT'> {
  const t = (valore ?? '').trim()
  if (t === '') return ok(null)
  if (IT_INTERO.test(t)) return ok(normalizza(Number(t)))
  if (IT_CON_VIRGOLA.test(t)) {
    return ok(normalizza(Number(t.replace(/\./g, '').replace(',', '.'))))
  }
  return errore('NUMERO_IT', 'numero non in formato it-IT (1.234,56) o ambiguo')
}

export function decodificaDecimaleSql(valore: string | null): Esito<number | null, 'DECIMALE_SQL'> {
  const t = (valore ?? '').trim()
  if (t === '') return ok(null)
  if (!SQL_DECIMALE.test(t)) return errore('DECIMALE_SQL', 'decimale non in formato 1234.5678')
  return ok(normalizza(Number(t)))
}

/** Arrotonda a 6 decimali (la precisione delle colonne `decimal(18,6)`). */
export function arrotonda6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}
