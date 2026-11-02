import { CommonModule } from '@angular/common'
import { Component, Input, OnChanges, SimpleChanges, signal } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { AnteprimaVariazioneContratti } from './listino.model'

const PER_PAGINA = 20

const DECIMALE_CON_PUNTO = /^-?\d+\.\d+$/
const NUMERO = /^-?\d+(,\d+)?$/
/** Prefissi che un foglio di calcolo valuta come formula (OWASP, CSV injection). */
const INIZIO_FORMULA = /^[=+\-@\t\r]/
const SOLO_CIFRE = /^\d+$/

/**
 * Prezzo per l'italiano: virgola decimale. Le righe speciali arrivano come «10.00 / 12.00»: ogni
 * pezzo si converte da solo. Vale per la tabella e per il CSV (M2).
 */
export function prezzoItaliano(v: string): string {
  return v
    .split(' / ')
    .map(p => (DECIMALE_CON_PUNTO.test(p.trim()) ? p.trim().replace('.', ',') : p))
    .join(' / ')
}

/**
 * Cella di TESTO del CSV, un solo helper per I3 e I4:
 *  - una cella che comincia con `=`, `+`, `-`, `@`, TAB o CR è una formula per Excel e LibreOffice
 *    anche fra virgolette: si antepone l'apostrofo `'` (resta visibile, ma neutralizza);
 *  - una cella di sole cifre («001», numero di contratto «0042») perderebbe gli zeri iniziali
 *    aprendo il file con un doppio clic: si scrive `="001"`, che Excel mostra come testo. La forma
 *    `=` non confligge con la neutralizzazione perché si applica solo a cifre pure, quindi mai a
 *    ciò che scrive un utente con un `=` in testa (quello passa dall'apostrofo);
 *  - il resto sta fra virgolette con quelle interne raddoppiate.
 */
export function cellaTesto(v: string | null): string {
  const t = v ?? ''
  if (SOLO_CIFRE.test(t)) return `="${t}"`
  const sicuro = INIZIO_FORMULA.test(t) ? `'${t}` : t
  return `"${sicuro.replace(/"/g, '""')}"`
}

/** Prezzo nel CSV: virgola decimale e niente virgolette; ciò che non è un numero resta testo. */
const prezzo = (v: string): string => {
  const n = prezzoItaliano(v).trim()
  return NUMERO.test(n) ? n : cellaTesto(prezzoItaliano(v))
}

/** CSV dell'anteprima (R46): separatore `;`, decimali con la virgola, BOM per Excel in italiano. */
export function anteprimaInCsv(a: AnteprimaVariazioneContratti): string {
  const righe = [
    ['Cliente', 'Contratto', 'Elenco', 'Voce', 'Prima', 'Dopo', 'Invariata']
      .map(t => `"${t}"`)
      .join(';'),
    ...a.righe.map(r =>
      [
        ...[r.cliente, r.contratto, r.elenco, r.voce].map(cellaTesto),
        prezzo(r.prima),
        prezzo(r.dopo),
        r.invariata ? '"sì"' : '"no"',
      ].join(';')
    ),
  ]
  return '\uFEFF' + righe.join('\r\n') + '\r\n'
}

/**
 * Anteprima di una variazione dei contratti (D20, D22): conteggio, tabella paginata sul client (il
 * backend manda le prime 200 righe), errori che bloccano l'applicazione e "Scarica CSV". Il CSV
 * contiene le righe mostrate, non tutte, e lo dice.
 */
@Component({
  selector: 'app-anteprima-contratti',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <h3 class="sezione">Anteprima: {{ anteprima.totale }} prezzi da modificare</h3>
    <p
      *ngIf="anteprima.righe.length === 0 && !anteprima.invariate"
      data-testid="anteprima-nessuna-riga"
    >
      Nessun prezzo corrisponde ai criteri.
    </p>
    <p
      *ngIf="anteprima.totale === 0 && anteprima.righe.length > 0"
      role="status"
      data-testid="anteprima-nessun-cambio"
    >
      Nessun prezzo cambia: non c'è niente da applicare.
    </p>
    <p
      *ngIf="anteprima.invariate && anteprima.invariate > 0"
      class="field-hint"
      data-testid="anteprima-invariate"
    >
      {{ anteprima.invariate }}
      {{ anteprima.invariate === 1 ? 'riga invariata' : 'righe invariate' }}: il prezzo arrotondato
      non cambia, quindi non viene scritto.
    </p>
    <ng-container *ngIf="anteprima.righe.length > 0">
      <p
        *ngIf="anteprima.righe.length < perimetro()"
        class="field-hint"
        data-testid="anteprima-parziale"
      >
        Si vedono le prime {{ anteprima.righe.length }} righe su {{ perimetro() }}; l'applicazione
        riguarda tutti i prezzi che cambiano.
      </p>
      <table class="anteprima" data-testid="anteprima-righe">
        <caption class="sr-only">
          Anteprima delle righe che cambiano
        </caption>
        <thead>
          <tr>
            <th scope="col">Cliente</th>
            <th scope="col">Contratto</th>
            <th scope="col">Elenco</th>
            <th scope="col">Voce</th>
            <th scope="col">Prima</th>
            <th scope="col" aria-label="diventa"></th>
            <th scope="col">Dopo</th>
            <th scope="col">Esito</th>
          </tr>
        </thead>
        <tbody>
          <tr
            *ngFor="let r of pagina()"
            [class.invariata]="r.invariata"
            [attr.data-testid]="r.invariata ? 'anteprima-riga-invariata' : null"
          >
            <td>{{ r.cliente ?? '—' }}</td>
            <td>{{ r.contratto }}</td>
            <td>{{ r.elenco }}</td>
            <td>{{ r.voce }}</td>
            <td>{{ italiano(r.prima) }}</td>
            <td aria-hidden="true">→</td>
            <td>{{ italiano(r.dopo) }}</td>
            <td>{{ r.invariata ? 'invariata' : 'cambia' }}</td>
          </tr>
        </tbody>
      </table>
      <div class="navigazione">
        <p-button
          icon="pi pi-chevron-left"
          [text]="true"
          size="small"
          ariaLabel="Pagina precedente"
          [disabled]="indice() === 0"
          (onClick)="indice.set(indice() - 1)"
          data-testid="anteprima-precedente"
        />
        <span data-testid="anteprima-pagina">Pagina {{ indice() + 1 }} di {{ pagine() }}</span>
        <p-button
          icon="pi pi-chevron-right"
          [text]="true"
          size="small"
          ariaLabel="Pagina successiva"
          [disabled]="indice() >= pagine() - 1"
          (onClick)="indice.set(indice() + 1)"
          data-testid="anteprima-successiva"
        />
        <p-button
          label="Scarica CSV"
          icon="pi pi-download"
          [text]="true"
          size="small"
          (onClick)="scarica()"
          data-testid="anteprima-csv"
        />
      </div>
    </ng-container>
    <div
      *ngIf="anteprima.avvisi?.length"
      class="avvisi"
      role="status"
      data-testid="anteprima-avvisi"
    >
      <p *ngFor="let a of anteprima.avvisi">
        <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> {{ a }}
      </p>
      <p class="field-hint">Gli avvisi non bloccano l'applicazione.</p>
    </div>
    <div *ngIf="anteprima.errori.length > 0" data-testid="anteprima-errori">
      <h4>Errori nell'anteprima</h4>
      <p role="alert" class="field-error">
        Con questi errori la variazione non può essere applicata: correggi le righe indicate o
        restringi i criteri, poi rifai l'anteprima.
      </p>
      <ul>
        <li *ngFor="let e of anteprima.errori">{{ e.voce }}: {{ e.messaggio }}</li>
      </ul>
    </div>
  `,
  styles: [
    `
      .anteprima {
        width: 100%;
        border-collapse: collapse;
      }
      .anteprima th,
      .anteprima td {
        padding: 0.25rem 0.5rem;
        text-align: left;
      }
      .avvisi {
        border-left: 3px solid var(--yellow-500, #f59e0b);
        padding: 0.25rem 0.75rem;
        margin: 0.5rem 0;
      }
      .invariata {
        color: var(--text-color-secondary, #6b7280);
        opacity: 0.7;
      }
      .navigazione {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .sezione {
        margin: 0.75rem 0 0.25rem;
      }
    `,
  ],
})
export class AnteprimaContrattiComponent implements OnChanges {
  @Input({ required: true }) anteprima!: AnteprimaVariazioneContratti
  @Input() nomeFile = 'anteprima-variazione.csv'

  readonly indice = signal(0)
  readonly italiano = prezzoItaliano

  ngOnChanges(c: SimpleChanges): void {
    if (c['anteprima']) this.indice.set(0)
  }

  /** Righe nel perimetro: quelle che cambiano più quelle invariate (`totale` non conta le seconde). */
  perimetro(): number {
    return this.anteprima.totale + (this.anteprima.invariate ?? 0)
  }

  pagine(): number {
    return Math.max(1, Math.ceil(this.anteprima.righe.length / PER_PAGINA))
  }

  pagina(): AnteprimaVariazioneContratti['righe'] {
    const da = this.indice() * PER_PAGINA
    return this.anteprima.righe.slice(da, da + PER_PAGINA)
  }

  scarica(): void {
    const blob = new Blob([anteprimaInCsv(this.anteprima)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = this.nomeFile
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
