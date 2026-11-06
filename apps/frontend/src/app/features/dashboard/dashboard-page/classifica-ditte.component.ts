import { ChangeDetectionStrategy, Component, Input } from '@angular/core'
import { DecimalPipe } from '@angular/common'
import { VoceClassifica } from './dashboard-dati'
import { STILI_BLOCCO } from './dashboard-stili'

/**
 * Classifica delle ditte piu' frequenti: ragione sociale, P. IVA in grigio mono sotto,
 * numero di FIR a destra, rango come testo («1.»), senza cerchi colorati (bug 7).
 */
@Component({
  selector: 'app-classifica-ditte',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" [attr.aria-label]="titolo" data-testid="classifica-ditte">
      <div class="card__h">
        <h3>{{ titolo }}</h3>
      </div>
      @if (caricamento) {
        <div aria-busy="true">
          <span class="sr-only">Caricamento in corso</span>
          @for (r of [0, 1, 2]; track r) {
            <span class="sk" style="width: 100%; height: 36px; margin-bottom: 8px"></span>
          }
        </div>
      } @else if (voci.length === 0) {
        <p class="vuoto">{{ vuoto }}</p>
      } @else {
        <ol class="classifica">
          @for (v of voci; track $index) {
            <li>
              <span class="rango num" aria-hidden="true">{{ $index + 1 }}.</span>
              <span class="ditta">
                <span class="ditta__nome">{{ v.nome }}</span>
                @if (v.nome !== v.partitaIva) {
                  <span class="ditta__piva mono">{{ v.partitaIva }}</span>
                }
              </span>
              <span class="conteggio num"
                >{{ v.conteggio | number: '1.0-0' }} <span class="unita">FIR</span></span
              >
            </li>
          }
        </ol>
      }
    </section>
  `,
  styles: [
    STILI_BLOCCO,
    `
      .classifica {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .classifica li {
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        padding: 10px 0;
        border-top: 1px solid var(--rule);
      }
      .classifica li:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .rango {
        color: var(--text-tertiary);
      }
      .ditta {
        display: grid;
        min-width: 0;
      }
      .ditta__nome {
        color: var(--text-primary);
        font-weight: var(--font-weight-medium);
        overflow-wrap: anywhere;
      }
      .ditta__piva {
        color: var(--text-tertiary);
        font-size: 12px;
      }
      .conteggio {
        color: var(--text-primary);
        white-space: nowrap;
      }
      .unita {
        color: var(--text-tertiary);
      }
    `,
  ],
})
export class ClassificaDitteComponent {
  @Input() voci: readonly VoceClassifica[] = []
  @Input({ required: true }) titolo!: string
  @Input() vuoto = 'Nessun formulario registrato'
  @Input() caricamento = false
}
