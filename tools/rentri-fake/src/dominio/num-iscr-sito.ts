/**
 * Pattern di `num_iscr_sito` come dichiarato dal contratto ufficiale
 * (`docs/contracts/rentri/formulari.yaml`, es. riga 684, ricorrente su ogni
 * path/parametro che referenzia il numero di iscrizione dell'unità locale):
 * `OP` seguito da 4 cifre, 3 alfanumerici, 6 cifre, un trattino, 2 lettere e
 * 4 cifre — es. `OP1234ABC123456-RM1234`.
 */
export const PATTERN_NUM_ISCR_SITO = /^OP[0-9]{4}[A-Z0-9]{3}[0-9]{6}-[A-Z]{2}[0-9]{4}$/

export function numIscrSitoValido(valore: string): boolean {
  return PATTERN_NUM_ISCR_SITO.test(valore)
}
