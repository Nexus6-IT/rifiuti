/**
 * Quantità nei messaggi all'utente, in formato italiano (`0,4`, `1.234,5`).
 * Unico punto in cui si formattano: mai un `toLocaleString` scritto sul posto.
 *
 * `useGrouping: 'always'`: con le opzioni di default CLDR `it` non raggruppa i numeri
 * di 4 cifre (`1234,5`) e l'esito cambierebbe con la versione ICU.
 */
const formato = new Intl.NumberFormat('it-IT', {
  maximumFractionDigits: 3,
  // Con TypeScript 5.4 il tipo di `useGrouping` è ancora `boolean`; Node 20 e 24
  // supportano il valore stringa 'always'.
  useGrouping: 'always' as unknown as boolean,
})

export function formattaQuantita(n: number): string {
  return formato.format(n)
}
