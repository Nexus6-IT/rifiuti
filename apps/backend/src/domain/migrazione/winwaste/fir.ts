import { decodificaDataDocumento } from './data-registrazione'
import { DataIso } from './risultato'

/**
 * Deduzioni sui FIR di `FORMULARI` (pezzo I5). Pure e senza valori nei messaggi.
 *
 * STATO DEDOTTO (piano I5, T1): `COMPLETED` solo se ci sono la data di fine trasporto (`DATF`,
 * `gg-mm-aaaa` come `DATD`: forma PRESUNTA, da riverificare sul primo `.bak`) E il peso a destino
 * (`NETTO` > 0); altrimenti `AWAITING_RECEIVER`. Una `DATF` illeggibile non completa il FIR: non si
 * inventa un completamento da un dato che non si capisce.
 */
export type StatoFirImportato = 'COMPLETED' | 'AWAITING_RECEIVER'

export function deduciStatoFir(campi: { datf: string | null; nettoKg: number | null }): {
  stato: StatoFirImportato
  dataFine: DataIso | null
} {
  const d = decodificaDataDocumento(campi.datf)
  if (d.ok && d.valore !== null && campi.nettoKg !== null && campi.nettoKg > 0) {
    return { stato: 'COMPLETED', dataFine: d.valore }
  }
  return { stato: 'AWAITING_RECEIVER', dataFine: null }
}

/**
 * `C6` del FIR (`docs/formulari.md` §2.1): `''` cartaceo, `DIGITALE`, `INVIATO A RENTRI DA <utente>`.
 * I FIR digitali non si copiano: si riacquisiscono da RENTRI (Q5 del 14/11).
 */
export function firDigitale(c6: string | null | undefined): boolean {
  const t = (c6 ?? '').trim().toUpperCase()
  return t.startsWith('DIGITALE') || t.startsWith('INVIATO A RENTRI')
}
