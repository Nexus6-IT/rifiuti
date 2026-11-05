import type { TemaEffettivo } from '../../core/services/tema.service'

/**
 * Colori per Chart.js, che li vuole come valori e non legge le variabili CSS.
 * Sono gli stessi valori dei token di src/styles.scss (--text-secondary,
 * --surface-border, --accent-fill, --color-*): se cambi lì, cambia qui.
 * Chi disegna grafici ricalcola dati e opzioni da `TemaService.effettivo()`,
 * così cambiano insieme al tema.
 */
export interface ColoriGrafico {
  /** Etichette, tick, legende (--text-tertiary). */
  testo: string
  /** Linee della griglia (--rule). */
  griglia: string
  /** Serie principale (--brand-primary). */
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
    testo: '#6b6964',
    griglia: '#eeece8',
    primario: '#b9440f',
    fondo: '#ffffff',
    info: '#504e4a',
    successo: '#1d5a35',
    attenzione: '#6b4b00',
    pericolo: '#b91c1c',
    neutro: '#d3d0c9',
  },
  scuro: {
    testo: '#96938c',
    griglia: '#2c2b27',
    primario: '#ff8a5c',
    fondo: '#1d1d1a',
    info: '#bdbab3',
    successo: '#c4ecd2',
    attenzione: '#ffe9a8',
    pericolo: '#f87171',
    neutro: '#4a4843',
  },
}

export function coloriGrafico(tema: TemaEffettivo): ColoriGrafico {
  return TAVOLOZZE[tema]
}
