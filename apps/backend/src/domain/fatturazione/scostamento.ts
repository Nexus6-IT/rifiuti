// Valore attuale di un legame fatturato dopo una correzione del registro (fase 4.4b1, Task 21,
// spec §5.7). Funzione pura, sola lettura: la fattura non cambia, la lista degli scostamenti
// mostra la differenza fra quanto e' stato fatturato e quanto varrebbe oggi la testa della catena.
import { Prisma } from '@prisma/client'
import { importoRiga } from '../listino/importi-riga'
import type { TipoRigaDocumento } from './codici'

/** Una riga `MOVIMENTO` del legame nel documento (una per riga del legame, Q40). */
export interface RigaFatturataScostamento {
  quantita: string | null
  prezzoTotale: string
  prezzoUnitario: string
  sconto: string | null
  tipoRiga: TipoRigaDocumento
  /** Vero per la riga a prezzo speciale (prezzo 0 del Task 2): l'importo sta nelle fasce. */
  prezzoSpeciale: boolean
}

export interface ValoreAttualeScostamento {
  quantitaAttuale: string | null
  importoAttuale: string | null
  soloQuantita: boolean
}

const QUANTITA_ZERO = '0.000'

/**
 * Quantita' e importo che il legame avrebbe oggi, ricalcolati dalla testa della catena col prezzo
 * congelato in fattura. L'importo e' la somma delle righe `MOVIMENTO` del legame (CER e V hanno
 * prezzi diversi, Q40); e' `null` se almeno una riga e' a prezzo speciale (`soloQuantita`), se non
 * ci sono righe `MOVIMENTO` o se la testa non ha quantita'. La quantita' e' quella del movimento
 * (la testa), non la somma delle righe. Le righe `FASCIA_SPECIALE` e `QUANTITA_MOVIMENTI` non si
 * ricalcolano: l'effetto su fasce e su `TT`/`TF` lo dice la differenza di quantita'.
 */
export function valoreAttualeScostamento(i: {
  fatturato: readonly RigaFatturataScostamento[]
  testa: { quantita: string | null; annullato: boolean }
}): ValoreAttualeScostamento {
  const righe = i.fatturato.filter(r => r.tipoRiga === 'MOVIMENTO')
  const quantitaAttuale = i.testa.annullato ? QUANTITA_ZERO : i.testa.quantita
  const soloQuantita = righe.some(r => r.prezzoSpeciale)
  if (soloQuantita || righe.length === 0 || quantitaAttuale === null) {
    return { quantitaAttuale, importoAttuale: null, soloQuantita }
  }
  const totale = righe.reduce(
    (somma, r) => somma.plus(importoRiga(quantitaAttuale, r.prezzoUnitario, r.sconto).netto),
    new Prisma.Decimal(0)
  )
  return { quantitaAttuale, importoAttuale: totale.toFixed(2), soloQuantita }
}

/** Somma degli importi fatturati sulle righe `MOVIMENTO` del legame nel documento. */
export function importoFatturatoScostamento(
  righe: readonly Pick<RigaFatturataScostamento, 'prezzoTotale' | 'tipoRiga'>[]
): string {
  return righe
    .filter(r => r.tipoRiga === 'MOVIMENTO')
    .reduce((somma, r) => somma.plus(r.prezzoTotale), new Prisma.Decimal(0))
    .toFixed(2)
}

export type TipoCorrezioneScostamento = 'RETTIFICA' | 'ANNULLO' | 'CAMBIO_CER' | 'CAMBIO_CAUSALE'

/**
 * Tipo di correzione dalla testa della catena: `ANNULLAMENTO` e' un annullo; un CER diverso da
 * quello fatturato (se la riga lo porta) e' un cambio di CER; la quantita' uguale con CER uguale
 * vuol dire che e' cambiata la causale; altrimenti e' una rettifica.
 */
export function tipoCorrezioneScostamento(i: {
  tipoAnnotazione: 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'
  cerTesta: string | null
  cerFatturato: string | null
  quantitaTesta: string | null
  quantitaFatturata: string | null
}): TipoCorrezioneScostamento {
  if (i.tipoAnnotazione === 'ANNULLAMENTO') return 'ANNULLO'
  if (i.cerTesta !== null && i.cerFatturato !== null && i.cerTesta !== i.cerFatturato) {
    return 'CAMBIO_CER'
  }
  if (
    i.tipoAnnotazione === 'RETTIFICA' &&
    i.quantitaTesta !== null &&
    i.quantitaFatturata !== null &&
    new Prisma.Decimal(i.quantitaTesta).equals(i.quantitaFatturata)
  ) {
    return 'CAMBIO_CAUSALE'
  }
  return 'RETTIFICA'
}
