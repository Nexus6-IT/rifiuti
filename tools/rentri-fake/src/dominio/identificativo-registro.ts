/**
 * Pattern di `identificativo_registro` come dichiarato dal contratto
 * ufficiale (`docs/contracts/rentri/dati-registri.yaml`, ricorrente su ogni
 * path/parametro di questo servizio, es. riga 252): `R` seguito da 10
 * caratteri alfanumerici maiuscoli — es. `R1234ABCDEF`.
 *
 * Il registro NON si apre tramite alcuna API di questo contratto (nessun
 * path lo crea): tutti gli endpoint presuppongono un `identificativo_registro`
 * gia' esistente, ottenuto sul portale RENTRI. Questo modulo valida solo il
 * FORMATO del parametro; l'ESISTENZA del registro e' responsabilita' di
 * `Registri.registroConosciuto` (v. `stato/registri.ts`).
 */
export const PATTERN_IDENTIFICATIVO_REGISTRO = /^R[0-9A-Z]{10}$/

export function identificativoRegistroValido(valore: string): boolean {
  return PATTERN_IDENTIFICATIVO_REGISTRO.test(valore)
}
