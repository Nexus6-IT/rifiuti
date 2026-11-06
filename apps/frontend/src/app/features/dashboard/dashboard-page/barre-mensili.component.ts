import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core'
import { DecimalPipe, formatNumber } from '@angular/common'
import { AndamentoMensileVoce } from '../andamento.service'
import { STILI_BLOCCO } from './dashboard-stili'

interface Barra {
  mese: string
  etichetta: string
  conteggio: number
  x: number
  y: number
  larghezza: number
  altezza: number
  corrente: boolean
}

const MESI_BREVI = [
  'gen',
  'feb',
  'mar',
  'apr',
  'mag',
  'giu',
  'lug',
  'ago',
  'set',
  'ott',
  'nov',
  'dic',
]

// Coordinate interne dell'SVG: la larghezza si stira sul contenitore (preserveAspectRatio none),
// quindi le etichette stanno fuori, in HTML, e restano leggibili anche a 390 px.
const L = 1200
const H = 200
const SOPRA = 8

function etichettaMese(mese: string): string {
  const numero = Number(mese.split('-')[1])
  return MESI_BREVI[numero - 1] ?? mese
}

function annoMese(mese: string): string {
  return `${etichettaMese(mese)} ${mese.split('-')[0]}`
}

/**
 * «Formulari per mese»: dodici barre in un SVG del componente (P6). Il mese corrente
 * (l'ultimo) e' l'unica barra in arancio, le altre sono neutre; la media e' una linea
 * tratteggiata. Le etichette vengono dal campo `mese` della serie, mai dalla data di oggi.
 */
@Component({
  selector: 'app-barre-mensili',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card" aria-labelledby="mesi-titolo" data-testid="barre-mensili">
      <div class="card__h">
        <h2 id="mesi-titolo">Formulari per mese</h2>
        @if (!caricamento && !errore && barre.length > 0) {
          <span class="meta num"
            >{{ periodo }} · {{ totale | number: '1.0-0' }} FIR, media
            {{ media | number: '1.0-1' }} al mese</span
          >
        }
      </div>

      @if (caricamento) {
        <div aria-busy="true">
          <span class="sr-only">Caricamento in corso</span>
          <span class="sk" style="width: 100%; height: 232px"></span>
        </div>
      } @else if (errore) {
        <p class="vuoto" data-testid="andamento-errore">
          Non è stato possibile caricare l'andamento mensile.
          <button type="button" class="azione" (click)="riprova.emit()">Riprova</button>
        </p>
      } @else {
        @if (vuoto) {
          <p class="vuoto vuoto--grafico" data-testid="andamento-vuoto">
            Nessun formulario negli ultimi dodici mesi
          </p>
        }
        <svg
          class="grafico"
          [attr.viewBox]="'0 0 ' + L + ' ' + H"
          preserveAspectRatio="none"
          role="img"
          [attr.aria-label]="'Formulari creati per mese: ' + periodo"
          data-testid="andamento-grafico"
        >
          <line class="base" x1="0" [attr.x2]="L" [attr.y1]="H - 0.5" [attr.y2]="H - 0.5" />
          @if (!vuoto) {
            @for (b of barre; track b.mese) {
              <rect
                [attr.data-mese]="b.mese"
                [class]="b.corrente ? 'barra barra--corrente' : 'barra'"
                [attr.x]="b.x"
                [attr.y]="b.y"
                [attr.width]="b.larghezza"
                [attr.height]="b.altezza"
                rx="3"
              />
            }
            <line
              class="media"
              data-testid="andamento-media"
              x1="0"
              [attr.x2]="L"
              [attr.y1]="yMedia"
              [attr.y2]="yMedia"
              [attr.aria-label]="'Media ' + mediaTesto + ' al mese'"
            />
          }
        </svg>
        <div class="colonne num" aria-hidden="true">
          @for (b of barre; track b.mese) {
            <span class="colonna" [class.colonna--corrente]="b.corrente">
              <span class="colonna__v">{{ b.conteggio | number: '1.0-0' }}</span>
              <span class="colonna__m">{{ b.etichetta }}</span>
            </span>
          }
        </div>
      }

      <!-- Alternativa testuale: il grafico da solo non dice nulla a uno screen reader. -->
      <table class="sr-only" data-testid="andamento-tabella-testuale">
        <caption>
          Formulari creati per mese, ultimi dodici mesi
        </caption>
        <thead>
          <tr>
            <th scope="col">Mese</th>
            <th scope="col" style="text-align: right">Formulari creati</th>
          </tr>
        </thead>
        <tbody>
          @for (b of barre; track b.mese) {
            <tr>
              <td>{{ b.etichetta }} {{ b.mese.split('-')[0] }}</td>
              <td style="text-align: right">{{ b.conteggio }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>
  `,
  styles: [
    STILI_BLOCCO,
    `
      .grafico {
        display: block;
        width: 100%;
        height: 200px;
        overflow: visible;
      }
      .base {
        stroke: var(--surface-border-strong);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }
      .barra {
        fill: var(--color-gray-300);
      }
      .barra--corrente {
        fill: var(--brand-primary);
      }
      .media {
        stroke: var(--text-secondary);
        stroke-width: 1.5;
        stroke-dasharray: 5 4;
        vector-effect: non-scaling-stroke;
      }
      .colonne {
        display: grid;
        grid-template-columns: repeat(12, minmax(0, 1fr));
        margin-top: 6px;
      }
      .colonna {
        display: grid;
        justify-items: center;
        gap: 2px;
        font-size: 12px;
        line-height: 16px;
        min-width: 0;
      }
      .colonna__v {
        color: var(--text-secondary);
      }
      .colonna__m {
        color: var(--text-tertiary);
      }
      .colonna--corrente .colonna__v {
        color: var(--text-primary);
        font-weight: var(--font-weight-medium);
      }
      .colonna--corrente .colonna__m {
        color: var(--text-primary);
      }
      .vuoto--grafico {
        margin-bottom: 8px;
      }
      @media (max-width: 575.98px) {
        .colonna {
          font-size: 11px;
        }
        .meta {
          text-align: left;
        }
        .card__h {
          flex-direction: column;
          gap: 4px;
          align-items: flex-start;
        }
      }
    `,
  ],
})
export class BarreMensiliComponent {
  protected readonly L = L
  protected readonly H = H

  barre: Barra[] = []
  totale = 0
  media = 0
  yMedia = H
  vuoto = true
  periodo = ''

  @Input() caricamento = false
  @Input() errore = false
  @Output() readonly riprova = new EventEmitter<void>()

  constructor() {
    this.mesi = []
  }

  @Input() set mesi(valore: readonly AndamentoMensileVoce[]) {
    const mesi = valore ?? []
    const massimo = Math.max(0, ...mesi.map(m => m.conteggio))
    const passo = mesi.length > 0 ? L / mesi.length : L
    const spazio = passo * 0.28
    const area = H - SOPRA
    this.totale = mesi.reduce((s, m) => s + m.conteggio, 0)
    const mediaVera = mesi.length > 0 ? this.totale / mesi.length : 0
    // Sotto 10 al mese l'intero direbbe «0»: si tiene un decimale.
    this.media = mediaVera < 10 ? Math.round(mediaVera * 10) / 10 : Math.round(mediaVera)
    this.vuoto = this.totale === 0
    this.barre = mesi.map((m, i) => {
      const altezza = massimo > 0 ? (m.conteggio / massimo) * area : 0
      return {
        mese: m.mese,
        etichetta: etichettaMese(m.mese),
        conteggio: m.conteggio,
        x: i * passo + spazio / 2,
        y: H - altezza,
        larghezza: passo - spazio,
        altezza,
        corrente: i === mesi.length - 1,
      }
    })
    this.yMedia = massimo > 0 ? H - (mediaVera / massimo) * area : H
    this.periodo =
      mesi.length > 0 ? `${annoMese(mesi[0].mese)} – ${annoMese(mesi[mesi.length - 1].mese)}` : ''
  }

  get mediaTesto(): string {
    return formatNumber(this.media, 'it-IT', '1.0-1')
  }
}
