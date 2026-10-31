/**
 * Partita IVA casuale con cifra di controllo valida, per i test e2e (F2-10).
 *
 * Il backend controlla il checksum quando una partita IVA viene impostata su una ditta: le
 * vecchie P.IVA "di comodo" (11 cifre a caso) vengono rifiutate con 400.
 *
 * Stesso algoritmo di `apps/backend/src/domain/shared/partita-iva.vo.ts` (`PartitaIva.isValid`):
 * le cifre in posizione dispari (la seconda, la quarta, ...) si raddoppiano togliendo 9 se
 * superano 9, si sommano a quelle in posizione pari, e la cifra di controllo e'
 * `(10 - somma % 10) % 10`.
 */
export function partitaIvaCasualeValida(): string {
  // 10 cifre: 4 dal timestamp e 6 casuali, per non collidere fra worker e run diverse
  const dieci =
    String(Date.now()).slice(-4) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
  const cifre = dieci.split('').map(Number)
  let somma = 0
  for (let i = 0; i < 10; i++) {
    let c = cifre[i]
    if (i % 2 !== 0) {
      c *= 2
      if (c > 9) c -= 9
    }
    somma += c
  }
  return dieci + String((10 - (somma % 10)) % 10)
}
