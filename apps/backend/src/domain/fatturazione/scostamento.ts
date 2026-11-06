// Valore attuale di un legame fatturato dopo una correzione del registro (fase 4.4b1, Task 21,
// spec §5.7). Funzione pura, sola lettura: la fattura non cambia, la lista degli scostamenti
// mostra la differenza fra quanto e' stato fatturato e quanto varrebbe oggi la testa della catena.
import { Prisma } from '@prisma/client'
import { quantitaPerRiga } from '../legami-movimento/proposta-righe'
import { importoRiga } from '../listino/importi-riga'
import type { TipoRigaDocumento } from './codici'

/**
 * Una riga `MOVIMENTO` del legame nel documento (una per riga del legame, Q40), con i dati della
 * riga del legame che dicono come se ne ricalcola la quantita' (`tipoQuantita`, `unitaMisura`,
 * `quantitaOrigine`, `prezzoSpeciale`).
 */
export interface RigaFatturataScostamento {
  quantita: string | null
  prezzoTotale: string
  prezzoUnitario: string
  sconto: string | null
  tipoRiga: TipoRigaDocumento
  /** Dalla riga del legame: l'importo sta nelle fasce, la riga porta solo la quantita'. */
  prezzoSpeciale: boolean
  tipoQuantita: 'PESO_NETTO' | 'PESO_LORDO' | 'VOLUME' | 'UNO' | 'ALTRO' | null
  unitaMisura: string | null
  quantitaOrigine: 'DA_MOVIMENTO' | 'MANUALE' | null
}

export interface ValoreAttualeScostamento {
  quantitaAttuale: string | null
  importoAttuale: string | null
  soloQuantita: boolean
}

const QUANTITA_ZERO = '0.000'

/**
 * Quantita' e importo che il legame avrebbe oggi, ricalcolati dalla testa della catena col prezzo
 * congelato in fattura.
 *
 * La quantita' di ogni riga e' nella UM della RIGA (kg, t, L, MC...), non nella UM del movimento:
 * si ricava con `quantitaPerRiga`, la stessa conversione della proposta del legame. Le righe `UNO`
 * e quelle a quantita' `MANUALE` non dipendono dal movimento: il loro valore attuale e' quello
 * fatturato. Con l'annullo le righe da movimento valgono zero.
 *
 * L'importo e' la somma delle righe `MOVIMENTO` del legame (CER e V hanno prezzi diversi, Q40); e'
 * `null` se almeno una riga e' a prezzo speciale (`soloQuantita`), se non ci sono righe
 * `MOVIMENTO`, se la testa non ha quantita' o se la quantita' non si converte. La quantita'
 * mostrata e' quella del movimento (la testa), non la somma delle righe. Le righe
 * `FASCIA_SPECIALE` e `QUANTITA_MOVIMENTI` non si ricalcolano: l'effetto su fasce e su `TT`/`TF`
 * lo dice la differenza di quantita'.
 */
export function valoreAttualeScostamento(i: {
  fatturato: readonly RigaFatturataScostamento[]
  testa: { quantity: string | null; unit: string | null; annullato: boolean }
}): ValoreAttualeScostamento {
  const righe = i.fatturato.filter(r => r.tipoRiga === 'MOVIMENTO')
  const quantitaAttuale = i.testa.annullato ? QUANTITA_ZERO : i.testa.quantity
  const soloQuantita = righe.some(r => r.prezzoSpeciale)
  if (soloQuantita || righe.length === 0 || quantitaAttuale === null) {
    return { quantitaAttuale, importoAttuale: null, soloQuantita }
  }
  let totale = new Prisma.Decimal(0)
  for (const r of righe) {
    if (r.quantitaOrigine === 'MANUALE' || r.tipoQuantita === 'UNO') {
      totale = totale.plus(r.prezzoTotale)
      continue
    }
    let quantitaRiga: string | null
    if (i.testa.annullato) {
      quantitaRiga = '0'
    } else if (r.tipoQuantita === null || i.testa.unit === null) {
      quantitaRiga = null
    } else {
      quantitaRiga = quantitaPerRiga(
        { tipoQuantita: r.tipoQuantita, unitaMisura: r.unitaMisura ?? '' },
        { quantity: quantitaAttuale, unit: i.testa.unit }
      )
    }
    if (quantitaRiga === null) return { quantitaAttuale, importoAttuale: null, soloQuantita }
    totale = totale.plus(importoRiga(quantitaRiga, r.prezzoUnitario, r.sconto).netto)
  }
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

const stessaQuantita = (a: string, b: string): boolean => new Prisma.Decimal(a).equals(b)

/**
 * Tipo di correzione dal confronto fra il movimento fatturato e la testa della catena:
 * `ANNULLAMENTO` e' un annullo; `cer_code` diverso e' un cambio di CER; `quantity`/`unit` diverse
 * sono una rettifica; `causale` diversa e' un cambio di causale; altrimenti (cambia altro, per
 * esempio la data o il FIR) e' una rettifica.
 */
export function tipoCorrezioneScostamento(i: {
  tipoAnnotazione: 'ORDINARIA' | 'RETTIFICA' | 'ANNULLAMENTO'
  cerTesta: string | null
  cerFatturato: string | null
  quantitaTesta: string | null
  unitaTesta: string | null
  quantitaFatturata: string | null
  unitaFatturata: string | null
  causaleTesta: string | null
  causaleFatturata: string | null
}): TipoCorrezioneScostamento {
  if (i.tipoAnnotazione === 'ANNULLAMENTO') return 'ANNULLO'
  if (i.cerTesta !== i.cerFatturato) return 'CAMBIO_CER'
  const quantitaUguale =
    i.quantitaTesta !== null && i.quantitaFatturata !== null
      ? stessaQuantita(i.quantitaTesta, i.quantitaFatturata)
      : i.quantitaTesta === i.quantitaFatturata
  if (!quantitaUguale || i.unitaTesta !== i.unitaFatturata) return 'RETTIFICA'
  if (i.causaleTesta !== i.causaleFatturata) return 'CAMBIO_CAUSALE'
  return 'RETTIFICA'
}
