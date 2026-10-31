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

/**
 * Due annotazioni con lo stesso (anno, progressivo) nello stesso lotto: errore di programmazione,
 * non un esito di RENTRI. Si solleva PRIMA della POST (selezione) o, se arriva comunque all'esito,
 * il chiamante tratta il lotto come incerto (INCERTA, verifica D11), mai come RIFIUTATA reinviabile.
 */
export class NumeroDuplicatoNelLottoError extends Error {
  constructor(readonly numero: NumeroRegistrazione) {
    super(`Numero di registrazione duplicato nel lotto: ${numero.anno}/${numero.progressivo}`)
    this.name = 'NumeroDuplicatoNelLottoError'
  }
}

/** Perche' una correzione resta in attesa: il predecessore arrivera' da solo o richiede un intervento. */
export type MotivoAttesaCorrezione = 'PREDECESSORE_IN_CORSO' | 'PREDECESSORE_BLOCCATO'

const PREDECESSORE_IN_CORSO: ReadonlyArray<CandidataLotto['statoPredecessore']> = [
  'DA_TRASMETTERE',
  'IN_INVIO',
  'ATTESA_ESITO',
  'INCERTA',
]

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
 * `rimanenti` conta le annotazioni escluse dal solo limite. `motivoAttesa` distingue il
 * predecessore in volo o da trasmettere (`IN_CORSO`, include INCERTA: si risolve con la verifica)
 * dal predecessore bloccato (`BLOCCATO`: RIFIUTATA, NON_TRASMISSIBILE, mai trasmesso).
 * @throws NumeroDuplicatoNelLottoError se due candidate hanno lo stesso (anno, progressivo)
 */
export function selezionaLotto(
  candidate: readonly CandidataLotto[],
  massimo: number
): {
  lotto: string[]
  inAttesa: string[]
  rimanenti: number
  motivoAttesa: Record<string, MotivoAttesaCorrezione>
} {
  if (!Number.isInteger(massimo) || massimo < 1) {
    throw new RangeError('Il massimo del lotto deve essere un intero maggiore di zero')
  }
  const ordinate = [...candidate].sort(
    (a, b) => a.numero.anno - b.numero.anno || a.numero.progressivo - b.numero.progressivo
  )
  for (let i = 1; i < ordinate.length; i++) {
    const a = ordinate[i - 1].numero
    const b = ordinate[i].numero
    if (a.anno === b.anno && a.progressivo === b.progressivo) {
      throw new NumeroDuplicatoNelLottoError(b)
    }
  }
  const lotto: string[] = []
  const inAttesa: string[] = []
  const motivoAttesa: Record<string, MotivoAttesaCorrezione> = {}
  let rimanenti = 0
  for (const c of ordinate) {
    if (c.predecessoreId !== null && !PREDECESSORE_SU_RENTRI.includes(c.statoPredecessore)) {
      inAttesa.push(c.movimentoId)
      motivoAttesa[c.movimentoId] = PREDECESSORE_IN_CORSO.includes(c.statoPredecessore)
        ? 'PREDECESSORE_IN_CORSO'
        : 'PREDECESSORE_BLOCCATO'
    } else if (lotto.length < massimo) {
      lotto.push(c.movimentoId)
    } else {
      rimanenti++
    }
  }
  return { lotto, inAttesa, rimanenti, motivoAttesa }
}
