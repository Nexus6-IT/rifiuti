import { ChangeDetectionStrategy, Component, Input } from '@angular/core'
import { TonoStato } from '../../../shared/models/stati-fir'
import { CellaAnalisi } from './dashboard-dati'
import { PillolaStatoComponent } from '../../../shared/components/pillola-stato.component'
import { STILI_BLOCCO } from './dashboard-stili'

/**
 * La striscia «Conformità · Firme · RENTRI · Andamento»: quattro celle in un solo
 * contenitore diviso, testo e cifre, nessuna icona. Una cella senza dato mostra «—» in
 * grigio e nessuna pillola (P11).
 */
@Component({
  selector: 'app-analisi-sintesi',
  standalone: true,
  imports: [PillolaStatoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="striscia"
      data-testid="analisi-sintesi"
      [attr.aria-busy]="caricamento ? 'true' : null"
    >
      @if (caricamento) {
        @for (e of etichetteScheletro(); track e) {
          <div class="cella">
            <span class="cella__l">{{ e }}</span>
            <span class="sk" style="width: 96px; height: 29px; margin-top: 4px"></span>
            <span class="sk" style="width: 80%; height: 16px; margin-top: 6px"></span>
          </div>
        }
      } @else {
        @for (cella of celle; track cella.etichetta) {
          <div
            class="cella"
            [class.cella--vuota]="cella.vuota"
            [attr.data-testid]="'analisi-' + cella.etichetta.toLowerCase().replace('à', 'a')"
          >
            <span class="cella__l">{{ cella.etichetta }}</span>
            <span class="cella__riga">
              <span class="cella__v num">{{ cella.valore }}</span>
              @if (livello && !cella.vuota && cella.etichetta === 'Conformità') {
                <app-pillola-stato [tono]="livello.tono" [testo]="livello.parola" />
              }
            </span>
            @if (cella.variazione) {
              <span class="cella__d">{{ cella.variazione }}</span>
            }
            @if (cella.dettaglio) {
              <span class="cella__d">{{ cella.dettaglio }}</span>
            }
          </div>
        }
      }
    </div>
  `,
  styles: [
    STILI_BLOCCO,
    `
      .striscia {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        background: var(--surface-card);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
      }
      .cella {
        display: grid;
        align-content: start;
        gap: 2px;
        padding: 14px 16px;
        border-left: 1px solid var(--surface-border);
        min-width: 0;
      }
      .cella:first-child {
        border-left: 0;
      }
      .cella__l {
        font-size: 13px;
        color: var(--text-secondary);
      }
      .cella__riga {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 2px;
      }
      .cella__v {
        font-size: 24px;
        line-height: 1.2;
        font-weight: var(--font-weight-medium);
        letter-spacing: -0.02em;
        color: var(--text-primary);
      }
      .cella--vuota .cella__v {
        color: var(--text-tertiary);
      }
      .cella__d {
        font-size: 12px;
        line-height: 16px;
        color: var(--text-tertiary);
      }
      @media (max-width: 991.98px) {
        .striscia {
          grid-auto-flow: row;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .cella {
          border-left: 0;
          border-top: 1px solid var(--surface-border);
        }
        .cella:nth-child(2n) {
          border-left: 1px solid var(--surface-border);
        }
        .cella:nth-child(-n + 2) {
          border-top: 0;
        }
        /* Numero dispari di celle (senza modulo rentri sono 3): l'ultima prende tutta la riga. */
        .cella:last-child:nth-child(odd) {
          grid-column: 1 / -1;
        }
      }
    `,
  ],
})
export class AnalisiSintesiComponent {
  @Input() celle: readonly CellaAnalisi[] = []
  @Input() livello: { parola: string; tono: TonoStato } | null = null
  @Input() caricamento = false
  /** Senza il modulo `rentri` la cella RENTRI non c'e', nemmeno nello scheletro. */
  @Input() conRentri = true

  protected etichetteScheletro(): string[] {
    return ['Conformità', 'Firme', 'RENTRI', 'Andamento'].filter(
      e => this.conRentri || e !== 'RENTRI'
    )
  }
}
