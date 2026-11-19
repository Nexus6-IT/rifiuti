/**
 * IBAN italiano casuale con cifre di controllo valide, per i test e2e.
 *
 * BBAN = CIN ('X') + ABI (5 cifre) + CAB (5 cifre) + 12 cifre di conto; cifre di controllo =
 * 98 - (BBAN + "IT00" con lettere A=10 ... Z=35) mod 97. Stessa regola di
 * `apps/backend/src/domain/clienti/iban.ts` (`ibanValido`), che il test
 * `tests/utils/iban-di-test.spec.ts` usa come oracolo su migliaia di campioni.
 *
 * Il numero di conto e' casuale perche' l'IBAN e' unico per azienda: il chiamante lo genera
 * DENTRO il test (non a livello di modulo), cosi' un retry non riusa un valore gia' scritto.
 */
export function ibanCasualeValido(): string {
  const cifre = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('')
  const bban = `X${cifre(5)}${cifre(5)}${cifre(12)}`
  const numerico = (bban + 'IT00')
    .split('')
    .map(ch => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch))
    .join('')
  const resto = Number(BigInt(numerico) % 97n)
  const controllo = String(98 - resto).padStart(2, '0')
  return `IT${controllo}${bban}`
}
