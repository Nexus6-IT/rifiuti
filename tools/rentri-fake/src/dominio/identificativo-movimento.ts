import { randomInt } from 'crypto'

/**
 * Pattern di `identificativo` (`IdentificativoMovimentoModel`, dati-registri.yaml
 * riga 3872): `M` seguito da 19 caratteri alfanumerici maiuscoli.
 *
 * A differenza di `anno`/`progressivo` (`AnnoProgressivoMovimentoModel`, scelti
 * dal CHIAMANTE — sono i numeri della propria numerazione di registro),
 * `identificativo` e' assegnato dal RENTRI al momento dell'accettazione della
 * registrazione. Il suo valore non ha alcun significato di dominio verificato
 * da alcun test di questo programma (a differenza di `numero_fir` in
 * `formulari.ts`, che il client deve poter correlare): la fake lo genera
 * quindi da sola, invece di richiederlo al canale di controllo.
 */
export const PATTERN_IDENTIFICATIVO_MOVIMENTO = /^M[0-9A-Z]{19}$/

export function identificativoMovimentoValido(valore: string): boolean {
  return PATTERN_IDENTIFICATIVO_MOVIMENTO.test(valore)
}

const ALFABETO = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function generaIdentificativoMovimento(): string {
  let corpo = ''
  for (let i = 0; i < 19; i++) {
    corpo += ALFABETO[randomInt(ALFABETO.length)]
  }
  return `M${corpo}`
}
