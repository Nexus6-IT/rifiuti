import { ChangeDetectionStrategy, Component, Input } from '@angular/core'
import { DecimalPipe } from '@angular/common'
import { DepositoTemporaneoVista } from '../../giacenze/giacenze.service'
import { BarraDeposito, barreDeposito } from './dashboard-dati'
import { STILI_BLOCCO } from './dashboard-stili'

interface GruppoBarre {
  registro: string
  barre: BarraDeposito[]
}

/**
 * «Deposito temporaneo»: quanto manca ai limiti dell'art. 185-bis (P9). Barre a rapporto
 * vero (valore / limite) in inchiostro; in rosso solo quella con un avviso. Le barre
 * seguono il criterio scelto dal registro, in kg come l'API (non in m³).
 */
@Component({
  selector: 'app-deposito-sintesi',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" aria-labelledby="deposito-titolo" data-testid="deposito-sintesi">
      <div class="card__h">
        <h2 id="deposito-titolo">Deposito temporaneo</h2>
        <span class="meta">art. 185-bis</span>
      </div>
      @if (caricamento) {
        <div aria-busy="true" class="barre">
          <span class="sr-only">Caricamento in corso</span>
          @for (r of [0, 1, 2]; track r) {
            <div>
              <span class="sk" style="width: 100%; height: 20px; margin-bottom: 6px"></span>
              <span class="sk" style="width: 100%; height: 8px"></span>
            </div>
          }
        </div>
      } @else if (errore) {
        <p class="vuoto" data-testid="deposito-errore">
          Non è stato possibile caricare il deposito temporaneo.
        </p>
      } @else if (gruppi.length === 0) {
        <p class="vuoto" data-testid="deposito-vuoto">Nessun deposito da controllare</p>
      } @else {
        @for (gruppo of gruppi; track $index) {
          <div class="gruppo">
            @if (gruppi.length > 1) {
              <p class="registro">{{ gruppo.registro }}</p>
            }
            <div class="barre">
              @for (barra of gruppo.barre; track barra.etichetta) {
                <div
                  class="barra"
                  [class.barra--allarme]="barra.allarme"
                  data-testid="deposito-barra"
                >
                  <div class="barra__top num">
                    <b>{{ barra.etichetta }}</b>
                    <span
                      >{{ barra.valore | number: '1.0-0' }} di {{ barra.limite | number: '1.0-0' }}
                      {{ barra.unita }}</span
                    >
                  </div>
                  <div
                    class="barra__pista"
                    role="progressbar"
                    [attr.aria-label]="barra.etichetta"
                    aria-valuemin="0"
                    [attr.aria-valuenow]="barra.valore"
                    [attr.aria-valuemax]="barra.limite"
                  >
                    <span class="barra__riempi" [style.width.%]="percentuale(barra)"></span>
                  </div>
                  @if (barra.nota) {
                    <div class="barra__nota">{{ barra.nota }}</div>
                  }
                </div>
              }
            </div>
          </div>
        }
      }
    </section>
  `,
  styles: [
    STILI_BLOCCO,
    `
      .gruppo + .gruppo {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--rule);
      }
      .registro {
        margin: 0 0 12px;
        font-size: 13px;
        color: var(--text-secondary);
      }
      .barre {
        display: grid;
        gap: 16px;
      }
      .barra__top {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 6px;
      }
      .barra__top b {
        font-weight: var(--font-weight-medium);
      }
      .barra__top span {
        color: var(--text-secondary);
        text-align: right;
      }
      .barra__pista {
        position: relative;
        height: 8px;
        border-radius: var(--radius-full);
        background: var(--rule);
        overflow: hidden;
      }
      .barra__riempi {
        position: absolute;
        inset: 0 auto 0 0;
        border-radius: var(--radius-full);
        background: var(--text-primary);
      }
      .barra__nota {
        margin-top: 6px;
        font-size: 12px;
        line-height: 16px;
        color: var(--text-secondary);
      }
      .barra--allarme .barra__riempi {
        background: var(--color-danger);
      }
      .barra--allarme .barra__nota {
        color: var(--color-danger);
      }
    `,
  ],
})
export class DepositoSintesiComponent {
  gruppi: GruppoBarre[] = []

  @Input() caricamento = false
  @Input() errore = false
  @Input() set vista(valore: DepositoTemporaneoVista | null) {
    this.gruppi = (valore?.registri ?? [])
      .filter(r => r.attivo)
      .map(r => ({ registro: r.registroDescrizione, barre: barreDeposito(r) }))
      .filter(g => g.barre.length > 0)
  }

  /** Rapporto vero, al massimo pieno: un valore oltre il limite resta la barra intera. */
  percentuale(barra: BarraDeposito): number {
    if (barra.limite <= 0) return 0
    return Math.round(Math.min(100, Math.max(0, (barra.valore / barra.limite) * 100)) * 10) / 10
  }
}
