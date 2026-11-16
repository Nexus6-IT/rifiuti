import { errore, Esito, ok } from './risultato'
import { arrotonda6, decodificaNumeroIt } from './numero-it'

/**
 * Quantita' di un movimento: `NETTO` in kg, `VOLU` con `UM` (`M` = m³,
 * `L` = litri, convertiti in m³ dividendo per 1000; `docs/movimenti.md` §2.2
 * pos. 35-39 e §2.5 per `KGNUM`/`MCNUM`).
 *
 * Un `VOLU` senza `UM` riconosciuta e' uno scarto `UM_SCONOSCIUTA`: non si
 * assume ne' m³ ne' litri.
 */
export interface Quantita {
  readonly nettoKg: number | null
  readonly volumeM3: number | null
}

export type CodiceQuantita = 'NUMERO_IT' | 'UM_SCONOSCIUTA'

export function decodificaQuantita(campi: {
  netto: string | null
  volu: string | null
  um: string | null
}): Esito<Quantita, CodiceQuantita> {
  const netto = decodificaNumeroIt(campi.netto)
  if (!netto.ok) return errore('NUMERO_IT', 'NETTO: numero non valido')
  const volu = decodificaNumeroIt(campi.volu)
  if (!volu.ok) return errore('NUMERO_IT', 'VOLU: numero non valido')
  let volumeM3: number | null = null
  if (volu.valore !== null) {
    const um = (campi.um ?? '').trim().toUpperCase()
    if (um === 'M') volumeM3 = volu.valore
    else if (um === 'L') volumeM3 = arrotonda6(volu.valore / 1000)
    else return errore('UM_SCONOSCIUTA', 'UM: attesa M o L accanto a VOLU')
  }
  return ok({ nettoKg: netto.valore, volumeM3 })
}

export type AvvisoQuantita = 'KGNUM_INCOERENTE' | 'MCNUM_INCOERENTE'

/**
 * Confronto fra la quantita' letta dal testo e i numerici scritti dal server
 * (`KGNUM`, `MCNUM`). Differenze oltre la tolleranza sono AVVISI. Per
 * `FORMULARI`, dove `KGNUM` e `MCNUM` sono `decimal(18,0)`, la tolleranza va
 * alzata a 1.
 */
export function confrontaConNumerici(
  q: Quantita,
  kgnum: number | null,
  mcnum: number | null,
  tolleranza = 0.001
): AvvisoQuantita[] {
  const avvisi: AvvisoQuantita[] = []
  const eps = 1e-9
  if (kgnum !== null && Math.abs((q.nettoKg ?? 0) - kgnum) > tolleranza + eps) {
    avvisi.push('KGNUM_INCOERENTE')
  }
  if (mcnum !== null && Math.abs((q.volumeM3 ?? 0) - mcnum) > tolleranza + eps) {
    avvisi.push('MCNUM_INCOERENTE')
  }
  return avvisi
}
