import { ChangeDetectionStrategy, Component, Input } from '@angular/core'
import { formatNumber } from '@angular/common'
import { RouterLink } from '@angular/router'
import { FIR } from '../../../shared/models/fir.model'
import { ETICHETTE_STATO_FIR, TONO_STATO_FIR, TonoStato } from '../../../shared/models/stati-fir'
import { FIRStato } from '../../../shared/models/fir.model'
import { PillolaStatoComponent } from './pillola-stato.component'
import { STILI_BLOCCO } from './dashboard-stili'

/** «Oggi 09:14», «Ieri 15:02», «3/11 17:50». */
export function etichettaDataFir(iso: string, adesso: Date = new Date()): string {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return '—'
  const ora = `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`
  const giorno = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const differenza = Math.round((giorno(adesso) - giorno(data)) / 86_400_000)
  if (differenza === 0) return `Oggi ${ora}`
  if (differenza === 1) return `Ieri ${ora}`
  return `${data.getDate()}/${data.getMonth() + 1} ${ora}`
}

/**
 * «FIR recenti»: gli ultimi cinque, su due linee (numero e stato; CER, produttore,
 * quantita' e data). Il numero e' un identificativo di riga: resta in inchiostro (P13).
 */
@Component({
  selector: 'app-fir-recenti',
  standalone: true,
  imports: [RouterLink, PillolaStatoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" aria-labelledby="fir-recenti-titolo" data-testid="fir-recenti">
      <div class="card__h">
        <h2 id="fir-recenti-titolo">FIR recenti</h2>
        <span class="meta">ultimi 5</span>
      </div>
      @if (caricamento) {
        <div aria-busy="true">
          <span class="sr-only">Caricamento in corso</span>
          @for (r of [0, 1, 2, 3, 4]; track r) {
            <div class="riga-sk">
              <span class="sk" style="width: 55%; height: 20px"></span>
              <span class="sk" style="width: 85%; height: 18px"></span>
            </div>
          }
        </div>
      } @else if (errore) {
        <p class="vuoto" data-testid="fir-recenti-errore">
          Non è stato possibile caricare i FIR recenti.
        </p>
      } @else if (fir.length === 0) {
        <p class="vuoto" data-testid="fir-recenti-vuoto">Nessun FIR registrato</p>
        @if (puoCreare) {
          <p class="vuoto-azione">
            <a class="link" routerLink="/fir" [queryParams]="{ nuovo: 1 }">Nuovo FIR</a>
          </p>
        }
      } @else {
        <ul class="righe">
          @for (f of fir; track f.id) {
            <li [attr.data-testid]="'fir-recente-' + f.id">
              <a class="r1 mono num" [routerLink]="['/fir', f.id]">{{ numero(f) }}</a>
              <span class="dx">
                <app-pillola-stato
                  [tono]="tono(f)"
                  [testo]="etichetta(f)"
                  [barrato]="f.stato === annullato"
                />
              </span>
              <span class="r2">{{ f.rifiuto.cerCode }}{{ produttore(f) }}</span>
              <span class="r2 dx num">{{ quantita(f) }} · {{ data(f) }}</span>
            </li>
          }
        </ul>
        <p class="vedi"><a class="link" routerLink="/fir">Vedi tutti i FIR</a></p>
      }
    </section>
  `,
  styles: [
    STILI_BLOCCO,
    `
      .righe {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .righe li {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 4px 12px;
        padding: 10px 0;
        border-top: 1px solid var(--rule);
        align-items: center;
      }
      .righe li:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .r1 {
        color: var(--text-primary);
        font-weight: var(--font-weight-medium);
        text-decoration: none;
      }
      .r1:hover,
      .r1:focus-visible {
        text-decoration: underline;
        text-underline-offset: 3px;
      }
      .r1:focus-visible {
        outline: 2px solid var(--focus-ring-color);
        outline-offset: 2px;
      }
      .r2 {
        font-size: 13px;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .dx {
        text-align: right;
        justify-self: end;
        max-width: 100%;
      }
      .vedi {
        display: flex;
        justify-content: center;
        margin: 12px 0 0;
      }
      .vuoto-azione {
        margin: 8px 0 0;
      }
      .riga-sk {
        display: grid;
        gap: 6px;
        padding: 10px 0;
      }
    `,
  ],
})
export class FirRecentiComponent {
  protected readonly annullato = FIRStato.ANNULLATO

  @Input() fir: readonly FIR[] = []
  @Input() caricamento = false
  @Input() errore = false
  /** Mostra il link «Nuovo FIR» nello stato vuoto (solo per i ruoli che possono crearlo). */
  @Input() puoCreare = false

  numero(f: FIR): string {
    return f.numeroProgressivo?.trim() ? f.numeroProgressivo : 'Bozza'
  }

  etichetta(f: FIR): string {
    return ETICHETTE_STATO_FIR[f.stato] ?? f.stato
  }

  tono(f: FIR): TonoStato {
    return TONO_STATO_FIR[f.stato] ?? 'none'
  }

  produttore(f: FIR): string {
    const nome = f.produttore?.ragioneSociale?.trim()
    return nome ? ` · ${nome}` : ''
  }

  quantita(f: FIR): string {
    const q = f.rifiuto.quantita
    if (q === null || q === undefined || Number.isNaN(Number(q))) return '—'
    return `${formatNumber(Number(q), 'it-IT', '1.0-2')} ${f.rifiuto.unitaMisura ?? ''}`.trim()
  }

  data(f: FIR): string {
    return etichettaDataFir(f.createdAt)
  }
}
