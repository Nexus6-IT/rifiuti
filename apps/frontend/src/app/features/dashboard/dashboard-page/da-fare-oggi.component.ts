import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core'
import { RouterLink } from '@angular/router'
import { VoceAttenzione } from '../attenzione.service'
import { TonoStato } from '../../../shared/models/stati-fir'
import { PillolaStatoComponent } from './pillola-stato.component'
import { STILI_BLOCCO } from './dashboard-stili'

const PAROLA_GRAVITA: Record<VoceAttenzione['gravita'], string> = {
  critico: 'Urgente',
  avviso: 'In scadenza',
  informativo: 'Da sapere',
}
const TONO_GRAVITA: Record<VoceAttenzione['gravita'], TonoStato> = {
  critico: 'err',
  avviso: 'warn',
  informativo: 'none',
}

/**
 * «Da fare oggi»: le scadenze e i controlli che chiedono un gesto oggi (D5).
 * Compare solo con voci o con un errore: se la verifica e' andata bene e non c'e' nulla
 * non si disegna un riquadro vuoto permanente. Nessun tetto di righe.
 */
@Component({
  selector: 'app-da-fare-oggi',
  standalone: true,
  imports: [RouterLink, PillolaStatoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (caricamento) {
      <section class="card" aria-busy="true" data-testid="da-fare-oggi-caricamento">
        <div class="card__h"><h2>Da fare oggi</h2></div>
        <span class="sr-only">Caricamento in corso</span>
        @for (r of [0, 1, 2]; track r) {
          <div class="riga-sk">
            <span class="sk" style="width: 88px; height: 22px"></span>
            <span class="sk" style="width: 60%; height: 36px"></span>
          </div>
        }
      </section>
    } @else if (voci.length > 0 || errore) {
      <section class="card" aria-labelledby="da-fare-oggi-titolo" data-testid="attenzione-fascia">
        <div class="card__h">
          <h2 id="da-fare-oggi-titolo">Da fare oggi</h2>
          <span class="meta num">{{ conteggio }}</span>
        </div>
        <ul class="todo">
          @if (errore) {
            <li class="g-critico" data-testid="attenzione-voce-verifica-fallita">
              <app-pillola-stato tono="err" testo="Urgente" />
              <span class="todo__t">
                <b>Verifica delle scadenze non riuscita</b>
                <span
                  >Non è stato possibile controllare oggi certificato RENTRI e autorizzazioni.
                  Riprova.</span
                >
              </span>
              <button
                type="button"
                class="azione"
                data-testid="attenzione-azione-verifica-fallita"
                aria-label="Riprova a verificare le scadenze"
                (click)="riprova.emit()"
              >
                Riprova
              </button>
            </li>
          }
          @for (voce of voci; track $index) {
            <li [attr.data-testid]="'attenzione-voce-' + voce.chiave">
              <app-pillola-stato [tono]="tono(voce)" [testo]="parola(voce)" />
              <span class="todo__t">
                <b>{{ voce.titolo }}</b>
                <span>{{ voce.dettaglio }}</span>
              </span>
              @if (voce.azione; as azione) {
                <a
                  class="azione"
                  [routerLink]="azione.rotta"
                  [attr.aria-label]="azione.etichetta + ': ' + voce.titolo"
                  [attr.data-testid]="'attenzione-azione-' + voce.chiave"
                  >{{ azione.etichetta }}</a
                >
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
  styles: [
    STILI_BLOCCO,
    `
      .todo {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .todo li {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        gap: 16px;
        align-items: center;
        padding: 12px 0;
        border-top: 1px solid var(--rule);
      }
      .todo li:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .todo li:last-child {
        padding-bottom: 0;
      }
      .todo__t {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .todo__t b {
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
      }
      .todo__t span {
        color: var(--text-secondary);
        font-size: 13px;
        line-height: 18px;
      }
      .riga-sk {
        display: flex;
        gap: 16px;
        align-items: center;
        padding: 12px 0;
      }
      @media (max-width: 575.98px) {
        .todo li {
          grid-template-columns: 1fr;
          gap: 6px;
        }
        .todo li app-pillola-stato {
          justify-self: start;
        }
        .todo li .azione {
          justify-self: start;
          padding-left: 0;
        }
      }
    `,
  ],
})
export class DaFareOggiComponent {
  @Input() voci: readonly VoceAttenzione[] = []
  /** La verifica delle scadenze non e' riuscita: «non lo so» non e' «tutto a posto». */
  @Input() errore = false
  @Input() caricamento = false
  @Output() readonly riprova = new EventEmitter<void>()

  get conteggio(): string {
    const n = this.voci.length + (this.errore ? 1 : 0)
    return n === 1 ? '1 voce' : `${n} voci`
  }

  parola(voce: VoceAttenzione): string {
    return PAROLA_GRAVITA[voce.gravita]
  }

  tono(voce: VoceAttenzione): TonoStato {
    return TONO_GRAVITA[voce.gravita]
  }
}
