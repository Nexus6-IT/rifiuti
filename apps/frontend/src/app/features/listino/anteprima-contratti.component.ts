import { CommonModule } from '@angular/common'
import { Component, Input, OnChanges, SimpleChanges, signal } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { AnteprimaVariazioneContratti } from './listino.model'

const PER_PAGINA = 20

const cella = (v: string | null): string => `"${(v ?? '').replace(/"/g, '""')}"`

/** CSV dell'anteprima (R46): separatore `;` e BOM, per aprirlo in Excel in italiano. */
export function anteprimaInCsv(a: AnteprimaVariazioneContratti): string {
  const righe = [
    ['Cliente', 'Contratto', 'Elenco', 'Voce', 'Prima', 'Dopo'].map(cella).join(';'),
    ...a.righe.map(r =>
      [r.cliente, r.contratto, r.elenco, r.voce, r.prima, r.dopo].map(cella).join(';')
    ),
  ]
  return '﻿' + righe.join('\r\n') + '\r\n'
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
    <p *ngIf="anteprima.righe.length === 0" data-testid="anteprima-nessuna-riga">
      Nessun prezzo corrisponde ai criteri.
    </p>
    <ng-container *ngIf="anteprima.righe.length > 0">
      <p
        *ngIf="anteprima.righe.length < anteprima.totale"
        class="field-hint"
        data-testid="anteprima-parziale"
      >
        Si vedono le prime {{ anteprima.righe.length }} righe su {{ anteprima.totale }}; la
        variazione le riguarda tutte.
      </p>
      <table class="anteprima" data-testid="anteprima-righe">
        <thead>
          <tr>
            <th scope="col">Cliente</th>
            <th scope="col">Contratto</th>
            <th scope="col">Elenco</th>
            <th scope="col">Voce</th>
            <th scope="col">Prima</th>
            <th scope="col" aria-label="diventa"></th>
            <th scope="col">Dopo</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let r of pagina()">
            <td>{{ r.cliente ?? '—' }}</td>
            <td>{{ r.contratto }}</td>
            <td>{{ r.elenco }}</td>
            <td>{{ r.voce }}</td>
            <td>{{ r.prima }}</td>
            <td aria-hidden="true">→</td>
            <td>{{ r.dopo }}</td>
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

  ngOnChanges(c: SimpleChanges): void {
    if (c['anteprima']) this.indice.set(0)
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
