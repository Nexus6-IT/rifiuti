import type { TipoRigaDocumento } from './codici'

/** TD24 (fattura differita) con almeno una riga MOVIMENTO o FASCIA_SPECIALE (S19), altrimenti TD01. */
export function tipoDocumento(righe: readonly { tipoRiga: TipoRigaDocumento }[]): 'TD01' | 'TD24' {
  return righe.some(r => r.tipoRiga === 'MOVIMENTO' || r.tipoRiga === 'FASCIA_SPECIALE')
    ? 'TD24'
    : 'TD01'
}

/** Vero se la data del documento supera il 15 del mese successivo a `periodoAl` (AAAA-MM-GG). */
export function oltreTermineDifferita(dataDocumento: string, periodoAl: string): boolean {
  const [a, m] = periodoAl.split('-').map(Number)
  const anno = m === 12 ? a + 1 : a
  const mese = m === 12 ? 1 : m + 1
  const limite = `${String(anno).padStart(4, '0')}-${String(mese).padStart(2, '0')}-15`
  return dataDocumento > limite
}
