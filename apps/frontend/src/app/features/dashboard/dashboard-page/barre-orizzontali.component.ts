import { ChangeDetectionStrategy, Component, Input } from '@angular/core'
import { DecimalPipe } from '@angular/common'
import { STILI_BLOCCO } from './dashboard-stili'

export interface VoceBarra {
  etichetta: string
  valore: number
  /** Codici (CER): in carattere mono. */
  mono?: boolean
}

/**
 * Barre orizzontali a rapporto vero sul massimo, in un solo grigio (D1: l'arancio e' del
 * dato principale, qui non c'e' una serie principale). Usato per Destinazione e Top 10 CER.
 */
@Component({
  selector: 'app-barre-orizzontali',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" [attr.aria-label]="titolo" data-testid="barre-orizzontali">
      <div class="card__h">
        <h3>{{ titolo }}</h3>
      </div>
      @if (caricamento) {
        <div aria-busy="true">
          <span class="sr-only">Caricamento in corso</span>
          @for (r of [0, 1, 2]; track r) {
            <span class="sk" style="width: 100%; height: 20px; margin-bottom: 12px"></span>
          }
        </div>
      } @else if (voci.length === 0) {
        <p class="vuoto">{{ vuoto }}</p>
      } @else {
        <ul class="barre">
          @for (v of voci; track $index) {
            <li class="barra">
              <span class="barra__e" [class.mono]="v.mono" [title]="v.etichetta">{{
                v.etichetta
              }}</span>
              <span class="barra__pista" aria-hidden="true">
                <span class="barra__riempi" [style.width.%]="larghezza(v)"></span>
              </span>
              <span class="barra__v num"
                >{{ v.valore | number: '1.0-0' }} <span class="unita">{{ unita }}</span></span
              >
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: [
    STILI_BLOCCO,
    `
      .barre {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 10px;
      }
      .barra {
        display: grid;
        grid-template-columns: minmax(72px, 112px) minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        min-height: 24px;
      }
      .barra__e {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--text-primary);
      }
      .barra__pista {
        height: 8px;
        border-radius: var(--radius-full);
        background: var(--rule);
        overflow: hidden;
      }
      .barra__riempi {
        display: block;
        height: 100%;
        border-radius: var(--radius-full);
        background: var(--text-secondary);
      }
      .barra__v {
        text-align: right;
        color: var(--text-primary);
        white-space: nowrap;
      }
      .unita {
        color: var(--text-tertiary);
      }
    `,
  ],
})
export class BarreOrizzontaliComponent {
  @Input() voci: readonly VoceBarra[] = []
  @Input() unita = 'kg'
  @Input({ required: true }) titolo!: string
  @Input() vuoto = 'Nessun formulario registrato'
  @Input() caricamento = false

  /** Rapporto vero con la voce piu' grande (che occupa tutta la pista). */
  larghezza(voce: VoceBarra): number {
    const massimo = Math.max(0, ...this.voci.map(v => v.valore))
    if (massimo <= 0) return 0
    return Math.round((voce.valore / massimo) * 1000) / 10
  }
}
