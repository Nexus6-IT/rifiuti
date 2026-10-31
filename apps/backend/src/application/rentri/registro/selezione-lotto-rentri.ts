/**
 * Selezione pura del lotto da trasmettere a RENTRI (D8). Nessun accesso a database o HTTP.
 */
import type { StatoTrasmissioneRentri } from '@prisma/client'
import type { NumeroRegistrazione } from './mappa-registrazione-rentri'

/** Annotazioni per invio: sotto il limite contrattuale di 1000. */
export const LOTTO_MASSIMO_RENTRI = 100

export interface CandidataLotto {
  movimentoId: string
  numero: NumeroRegistrazione
  /** Annotazione corretta (rettifica o annullamento); null per le ordinarie. */
  predecessoreId: string | null
  /** Stato di trasmissione del predecessore; `NON_TRASMESSA` = nessuna riga, null = non e' una correzione. */
  statoPredecessore: StatoTrasmissioneRentri | 'NON_TRASMESSA' | null
}

const PREDECESSORE_SU_RENTRI: ReadonlyArray<CandidataLotto['statoPredecessore']> = [
  'TRASMESSA',
  'GIA_SU_RENTRI',
]

/**
 * Ordina per (anno, progressivo) e prende al piu' `massimo` annotazioni. Una correzione entra
 * solo se il predecessore e' `TRASMESSA` o `GIA_SU_RENTRI` (Q7): altrimenti (anche se il
 * predecessore e' nello stesso lotto, `DA_TRASMETTERE`, `INCERTA`, mai trasmesso) resta in
 * `inAttesa` e parte al giro successivo. `inAttesa` elenca tutte le correzioni in attesa,
 * anche a lotto pieno; le annotazioni che non entrano per il limite non compaiono ne' in
 * `lotto` ne' in `inAttesa`: restano `DA_TRASMETTERE` e partono al giro dopo. Le righe
 * `NON_TRASMISSIBILE` non sono candidate e non bloccano le successive (nessuna contiguita').
 */
export function selezionaLotto(
  candidate: readonly CandidataLotto[],
  massimo: number
): { lotto: string[]; inAttesa: string[] } {
  if (!Number.isInteger(massimo) || massimo < 1) {
    throw new RangeError('Il massimo del lotto deve essere un intero maggiore di zero')
  }
  const ordinate = [...candidate].sort(
    (a, b) => a.numero.anno - b.numero.anno || a.numero.progressivo - b.numero.progressivo
  )
  const lotto: string[] = []
  const inAttesa: string[] = []
  for (const c of ordinate) {
    if (c.predecessoreId !== null && !PREDECESSORE_SU_RENTRI.includes(c.statoPredecessore)) {
      inAttesa.push(c.movimentoId)
    } else if (lotto.length < massimo) {
      lotto.push(c.movimentoId)
    }
  }
  return { lotto, inAttesa }
}
