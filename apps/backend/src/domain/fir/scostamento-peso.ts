/**
 * Scostamento fra la quantità dichiarata sul FIR e quella verificata a destino
 * (F2-7, D14). Non è più un blocco: la conferma di consegna accetta qualunque
 * quantità valida e lo scostamento è solo un avviso calcolato.
 *
 * La funzione gemella del frontend è `apps/frontend/src/app/features/fir/scostamento-peso.ts`:
 * le regole devono restare identiche.
 */

/** Soglia oltre la quale si segnala lo scostamento (era il blocco ±10%). */
export const SOGLIA_AVVISO_SCOSTAMENTO_PESO_PERCENTO = 10

export interface ScostamentoPeso {
  /** verificato − dichiarata, a 2 decimali. */
  differenza: number
  /** Scostamento percentuale a 1 decimale (solo visualizzazione); null con dichiarata <= 0. */
  percentuale: number | null
  /** Unità del FIR, nella quale sono espressi entrambi i pesi. */
  unita: string
  /** true se |scostamento| supera la soglia; null con dichiarata <= 0. */
  oltreSoglia: boolean | null
}

export function calcolaScostamentoPeso(
  dichiarata: number,
  verificato: number,
  unita: string
): ScostamentoPeso {
  // Centesimi interi: evita gli errori della virgola mobile (36,63/33,3 > 1,1).
  const centDichiarata = Math.round(dichiarata * 100)
  const centVerificato = Math.round(verificato * 100)
  const centDifferenza = centVerificato - centDichiarata
  const differenza = centDifferenza / 100

  if (dichiarata <= 0 || centDichiarata <= 0) {
    return { differenza, percentuale: null, unita, oltreSoglia: null }
  }

  const oltreSoglia =
    Math.abs(centDifferenza) * 100 > SOGLIA_AVVISO_SCOSTAMENTO_PESO_PERCENTO * centDichiarata
  const percentuale = Math.round((centDifferenza / centDichiarata) * 1000) / 10

  return { differenza, percentuale, unita, oltreSoglia }
}
