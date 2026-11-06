import { DOCUMENT } from '@angular/common'
import { Injectable, InjectionToken, computed, effect, inject, signal } from '@angular/core'

/**
 * Tema chiaro/scuro dell'applicazione.
 *
 * La preferenza dell'utente ("sistema", "chiaro", "scuro") resta nel browser
 * (localStorage `wf_tema`); senza scelta si parte dal chiaro, "sistema" segue
 * `prefers-color-scheme` ed e' una scelta esplicita salvata come le altre. Il tema effettivo si applica in due punti:
 * - `data-theme="light|dark"` su <html>, letto dai token di styles.scss;
 * - il file di tema PrimeNG nel <link id="tema-primeng"> di index.html, perché
 *   il tema Aura di PrimeNG 17 ha i colori scritti nei selettori e non si può
 *   pilotare con le sole variabili CSS.
 *
 * La prima applicazione, prima che Angular parta, la fa assets/tema-iniziale.js
 * con la stessa regola: se cambi le chiavi o i nomi dei file qui, cambiali
 * anche lì.
 */

export type PreferenzaTema = 'sistema' | 'chiaro' | 'scuro'
export type TemaEffettivo = 'chiaro' | 'scuro'

const CHIAVE_PREFERENZA = 'wf_tema'
const ID_LINK_PRIMENG = 'tema-primeng'
/** Colore della barra del browser su mobile: il fondo dell'app. */
const COLORE_BARRA: Record<TemaEffettivo, string> = { chiaro: '#f3f2ef', scuro: '#131311' }

/** Il sottoinsieme di MediaQueryList che serve qui (sostituibile nei test). */
export interface MediaTemaScuro {
  readonly matches: boolean
  addEventListener(tipo: 'change', ascoltatore: (e: { matches: boolean }) => void): void
}

export const MEDIA_TEMA_SCURO = new InjectionToken<MediaTemaScuro | null>('MEDIA_TEMA_SCURO', {
  providedIn: 'root',
  factory: () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null,
})

export function risolviTema(preferenza: PreferenzaTema, sistemaScuro: boolean): TemaEffettivo {
  if (preferenza === 'sistema') return sistemaScuro ? 'scuro' : 'chiaro'
  return preferenza
}

export function prossimaPreferenzaTema(preferenza: PreferenzaTema): PreferenzaTema {
  const ordine: PreferenzaTema[] = ['chiaro', 'scuro', 'sistema']
  return ordine[(ordine.indexOf(preferenza) + 1) % ordine.length]
}

/** Assente o sconosciuto vale chiaro: il tema di partenza e' il chiaro. */
export function leggiPreferenzaTema(valore: string | null): PreferenzaTema {
  return valore === 'chiaro' || valore === 'scuro' || valore === 'sistema' ? valore : 'chiaro'
}

export function etichettaPreferenzaTema(
  preferenza: PreferenzaTema
): 'Chiaro' | 'Scuro' | 'Sistema' {
  switch (preferenza) {
    case 'chiaro':
      return 'Chiaro'
    case 'scuro':
      return 'Scuro'
    case 'sistema':
      return 'Sistema'
  }
}

export function hrefTemaPrimeng(tema: TemaEffettivo): string {
  return `tema-primeng-${tema}.css`
}

function leggiStorage(): string | null {
  try {
    return localStorage.getItem(CHIAVE_PREFERENZA)
  } catch {
    return null
  }
}

function scriviStorage(preferenza: PreferenzaTema): void {
  try {
    localStorage.setItem(CHIAVE_PREFERENZA, preferenza)
  } catch {
    // Storage bloccato (navigazione privata, policy): la scelta vale per la sessione.
  }
}

@Injectable({ providedIn: 'root' })
export class TemaService {
  private readonly document = inject(DOCUMENT)
  private readonly media = inject(MEDIA_TEMA_SCURO)

  private readonly _preferenza = signal<PreferenzaTema>(leggiPreferenzaTema(leggiStorage()))
  private readonly sistemaScuro = signal<boolean>(this.media?.matches ?? false)

  readonly preferenza = this._preferenza.asReadonly()
  readonly effettivo = computed(() => risolviTema(this._preferenza(), this.sistemaScuro()))

  constructor() {
    this.media?.addEventListener('change', e => this.sistemaScuro.set(e.matches))
    effect(() => this.applica(this.effettivo()))
  }

  imposta(preferenza: PreferenzaTema): void {
    this._preferenza.set(preferenza)
    scriviStorage(preferenza)
  }

  cicla(): void {
    this.imposta(prossimaPreferenzaTema(this._preferenza()))
  }

  private applica(tema: TemaEffettivo): void {
    const radice = this.document.documentElement
    radice.setAttribute('data-theme', tema === 'scuro' ? 'dark' : 'light')

    const link = this.document.getElementById(ID_LINK_PRIMENG)
    const href = hrefTemaPrimeng(tema)
    if (link && link.getAttribute('href') !== href) link.setAttribute('href', href)

    // index.html ne ha due (uno per schema di colori): si aggiornano tutti.
    this.document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach(meta => meta.setAttribute('content', COLORE_BARRA[tema]))
  }
}
