/**
 * Riferimento interno del FIR: `FIR-<anno>-<progressivo>`, con il progressivo su
 * almeno 6 cifre e mai troncato oltre (il milionesimo FIR resta univoco).
 *
 * È il riferimento interno del gestionale, assegnato all'emissione e
 * progressivo per tenant e anno di emissione. In regime RENTRI il numero legale
 * del formulario è quello vidimato (`rentriNumeroFir`), non questo (Decisione 7).
 */
export function formattaNumeroFir(anno: number, progressivo: number): string {
  return `FIR-${anno}-${String(progressivo).padStart(6, '0')}`
}
