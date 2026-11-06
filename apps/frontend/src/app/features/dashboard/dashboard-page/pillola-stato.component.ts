import { ChangeDetectionStrategy, Component, Input } from '@angular/core'
import { TonoStato } from '../../../shared/models/stati-fir'

/**
 * Pillola di stato da 22 px: parola + pallino + tinta tenue (mai il solo colore).
 * I toni usano le coppie `--stato-<tono>-*` del tema; «todo» e' il contorno (Emesso).
 */
@Component({
  selector: 'app-pillola-stato',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span
    class="pillola"
    [class]="'pillola tono-' + tono"
    [class.pillola--barrata]="barrato"
    >{{ testo }}</span
  >`,
  styles: [
    `
      :host {
        display: inline-flex;
        flex: none;
      }
      .pillola {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 22px;
        padding: 0 8px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: var(--font-weight-medium);
        white-space: nowrap;
        border: 1px solid transparent;
      }
      .pillola::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }
      .tono-ok {
        background: var(--stato-ok-bg);
        color: var(--stato-ok-ink);
      }
      .tono-warn {
        background: var(--stato-warn-bg);
        color: var(--stato-warn-ink);
      }
      .tono-err {
        background: var(--stato-err-bg);
        color: var(--stato-err-ink);
      }
      .tono-none {
        background: var(--stato-none-bg);
        color: var(--stato-none-ink);
      }
      .tono-todo {
        background: var(--stato-todo-bg);
        color: var(--stato-todo-ink);
        border-color: var(--stato-todo-edge);
      }
      .pillola--barrata {
        color: var(--text-tertiary);
      }
      .pillola--barrata::before {
        display: none;
      }
    `,
  ],
})
export class PillolaStatoComponent {
  @Input({ required: true }) tono!: TonoStato
  @Input({ required: true }) testo!: string
  /** Annullato: parola barrata e niente pallino. */
  @Input() barrato = false
}
