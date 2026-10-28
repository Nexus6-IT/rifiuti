import type { ScostamentoPeso } from '../../shared/models/fir.model'

/**
 * Scostamento fra quantità dichiarata sul FIR e quantità verificata a destino (F2-7).
 *
 * Funzione gemella di `apps/backend/src/domain/fir/scostamento-peso.ts`: le regole devono
 * restare identiche (soglia 10%, confronto in centesimi interi, percentuale a 1 decimale solo
 * per la visualizzazione, `null` con dichiarata <= 0). Serve a mostrare l'avviso nel dialog di
 * consegna prima dell'invio; dopo la consegna fa fede quello restituito dal backend.
 */
export const SOGLIA_AVVISO_SCOSTAMENTO_PESO_PERCENTO = 10

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

/**
 * Testo dell'avviso non bloccante, identico per dialog e toast.
 * Es. "La quantità verificata differisce del +10,1% da quella dichiarata (100 kg): …".
 */
export function testoAvvisoScostamento(s: ScostamentoPeso, dichiarata: number): string {
  const pct = s.percentuale === null ? '' : formattaPercentuale(s.percentuale)
  return (
    `La quantità verificata differisce del ${pct} da quella dichiarata (${formattaNumero(dichiarata)} ${s.unita}): ` +
    `puoi confermare, lo scostamento resta registrato sul FIR.`
  )
}

export function formattaPercentuale(p: number): string {
  const segno = p > 0 ? '+' : ''
  return `${segno}${p.toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`
}

export function formattaNumero(n: number): string {
  return n.toLocaleString('it-IT', { maximumFractionDigits: 2 })
}
