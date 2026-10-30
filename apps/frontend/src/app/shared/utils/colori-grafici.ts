import type { TemaEffettivo } from '../../core/services/tema.service'

/**
 * Colori per Chart.js, che li vuole come valori e non legge le variabili CSS.
 * Sono gli stessi valori dei token di src/styles.scss (--text-secondary,
 * --surface-border, --accent-fill, --color-*): se cambi lì, cambia qui.
 * Chi disegna grafici ricalcola dati e opzioni da `TemaService.effettivo()`,
 * così cambiano insieme al tema.
 */
export interface ColoriGrafico {
  /** Etichette, tick, legende (--text-secondary). */
  testo: string
  /** Linee della griglia (--color-gray-200). */
  griglia: string
  /** Serie principale (--accent-fill). */
  primario: string
  /** Bordo dei punti, uguale al fondo della card (--surface-card). */
  fondo: string
  info: string
  successo: string
  attenzione: string
  pericolo: string
  neutro: string
}

const TAVOLOZZE: Record<TemaEffettivo, ColoriGrafico> = {
  chiaro: {
    testo: '#3d5052',
    griglia: '#dce5e5',
    primario: '#0f766e',
    fondo: '#fcfdfd',
    info: '#1d4ed8',
    successo: '#15803d',
    attenzione: '#b45309',
    pericolo: '#b91c1c',
    neutro: '#5e7273',
  },
  scuro: {
    testo: '#b4c4c3',
    griglia: '#243736',
    primario: '#3fc5b5',
    fondo: '#111e1f',
    info: '#8db4ff',
    successo: '#62c987',
    attenzione: '#f1b65a',
    pericolo: '#f4867e',
    neutro: '#8a9e9d',
  },
}

export function coloriGrafico(tema: TemaEffettivo): ColoriGrafico {
  return TAVOLOZZE[tema]
}
