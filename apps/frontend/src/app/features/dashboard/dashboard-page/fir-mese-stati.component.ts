import { ChangeDetectionStrategy, Component, Input } from '@angular/core'
import { DecimalPipe } from '@angular/common'
import { FIRStato } from '../../../shared/models/fir.model'
import { ETICHETTE_STATO_FIR, TONO_STATO_FIR, TonoStato } from '../../../shared/models/stati-fir'
import { STILI_BLOCCO } from './dashboard-stili'

interface CellaStato {
  stato: FIRStato
  etichetta: string
  tono: TonoStato
  valore: number
}

const ORDINE: readonly FIRStato[] = [
  FIRStato.BOZZA,
  FIRStato.EMESSO,
  FIRStato.IN_TRANSITO,
  FIRStato.CONSEGNATO,
  FIRStato.ANNULLATO,
]

const MESI = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
]

/**
 * «FIR di <mese>»: cinque celle in un solo contenitore diviso, una per stato (D10).
 * Il colore del pallino viene dal TONO dello stato, mai dalla posizione (bug 3).
 * Il totale dell'intestazione e' la somma delle cinque celle.
 */
@Component({
  selector: 'app-fir-mese-stati',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="fir-mese-titolo" data-testid="fir-mese-stati">
      <div class="testa">
        <h2 id="fir-mese-titolo">
          FIR di {{ nomeMese }}
          @if (!caricamento && !errore) {
            · {{ totale | number: '1.0-0' }}
          }
        </h2>
        @if (periodo) {
          <span class="meta">{{ periodo }}</span>
        }
      </div>
      @if (errore) {
        <div class="striscia">
          <p class="vuoto" data-testid="fir-mese-errore">
            Non è stato possibile caricare i FIR del mese.
          </p>
        </div>
      } @else {
        <div class="striscia" [attr.aria-busy]="caricamento ? 'true' : null">
          @for (cella of celle; track cella.stato) {
            <div
              class="cella"
              [class]="'cella tono-' + cella.tono + ' stato-' + cella.stato.toLowerCase()"
              [attr.data-testid]="'fir-mese-' + cella.stato.toLowerCase()"
            >
              <span class="cella__l"
                ><span class="pallino" aria-hidden="true"></span>{{ cella.etichetta }}</span
              >
              @if (caricamento) {
                <span class="sk" style="width: 36px; height: 33px; margin-top: 4px"></span>
              } @else {
                <span class="cella__v num">{{ cella.valore | number: '1.0-0' }}</span>
              }
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [
    STILI_BLOCCO,
    `
      .testa {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 8px;
      }
      h2 {
        margin: 0;
        font-family: var(--font-display);
        font-size: 16px;
        font-weight: var(--font-weight-semibold);
        line-height: 22px;
        color: var(--text-primary);
      }
      .striscia {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        background: var(--surface-card);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-lg);
        overflow: hidden;
      }
      .striscia > p {
        grid-column: 1 / -1;
        padding: 14px 16px;
      }
      .cella {
        padding: 14px 16px;
        border-left: 1px solid var(--surface-border);
        min-width: 0;
      }
      .cella:first-child {
        border-left: 0;
      }
      .cella__l {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--text-secondary);
      }
      .cella__v {
        display: block;
        margin-top: 4px;
        font-size: 30px;
        line-height: 1.1;
        font-weight: var(--font-weight-medium);
        letter-spacing: -0.02em;
        color: var(--text-primary);
      }
      .pallino {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: none;
        background: var(--text-tertiary);
      }
      .tono-todo .pallino {
        background: var(--text-primary);
      }
      .tono-warn .pallino {
        background: var(--stato-warn-ink);
      }
      .tono-ok .pallino {
        background: var(--stato-ok-ink);
      }
      .tono-err .pallino {
        background: var(--stato-err-ink);
      }
      .stato-annullato .pallino {
        background: var(--color-gray-300);
      }
      @media (max-width: 767.98px) {
        .striscia {
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
        .cella:last-child:nth-child(odd) {
          grid-column: 1 / -1;
        }
      }
    `,
  ],
})
export class FirMeseStatiComponent {
  celle: CellaStato[] = []
  totale = 0

  constructor() {
    this.conteggi = null
  }

  @Input() caricamento = false
  @Input() errore = false
  /** Il giorno di riferimento: dice il mese dell'intestazione e il periodo «dal 1° al 5/11». */
  @Input() mese: Date = new Date()
  @Input() set conteggi(valore: Readonly<Record<FIRStato, number>> | null) {
    this.celle = ORDINE.map(stato => ({
      stato,
      etichetta: ETICHETTE_STATO_FIR[stato],
      tono: TONO_STATO_FIR[stato],
      valore: valore?.[stato] ?? 0,
    }))
    this.totale = this.celle.reduce((somma, c) => somma + c.valore, 0)
  }

  get nomeMese(): string {
    return MESI[this.mese.getMonth()]
  }

  get periodo(): string {
    return `dal 1° al ${this.mese.getDate()}/${this.mese.getMonth() + 1}`
  }
}
