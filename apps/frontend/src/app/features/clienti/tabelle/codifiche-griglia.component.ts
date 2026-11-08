import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import { TableModule } from 'primeng/table'
import { AzioniRigaComponent } from '../../../shared/components/azioni-riga.component'
import { azioniDiRiga, MemoriaAzioni } from './azioni-lista'
import { CodificaBase } from './codifica-comune'

export type AzioneCodifica = 'riga' | 'modifica' | 'attiva' | 'elimina'

/**
 * Tabella delle codifiche con le azioni di riga (R25), uguale per contratto e addebito. I
 * `data-testid` li costruisce il chiamante con `testid(azione, codifica)`: è l'unica cosa che
 * differisce fra le due schede (quella del contratto vi aggiunge il genere).
 */
@Component({
  selector: 'app-codifiche-griglia',
  standalone: true,
  imports: [CommonModule, AzioniRigaComponent, TableModule],
  template: `
    <p-table
      [value]="righe"
      [styleClass]="'p-datatable-sm lista-telefono' + (righe.length === 0 ? ' senza-righe' : '')"
    >
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Codice</th>
          <th scope="col">Descrizione</th>
          <th scope="col">Stato</th>
          <th scope="col" class="num-col azioni-col" *ngIf="puoScrivere">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-c>
        <tr [attr.data-testid]="testid('riga', c)">
          <td>{{ c.codice }}</td>
          <td class="m2">
            {{ c.descrizione }}<span class="solo-tel" *ngIf="!c.attiva"> · Disattivata</span>
          </td>
          <td class="m-hide">{{ c.attiva ? 'Attiva' : 'Disattivata' }}</td>
          <td class="azioni-col" *ngIf="puoScrivere">
            <app-azioni-riga
              [attr.data-testid]="testid('modifica', c)"
              [nome]="c.codice + ' - ' + c.descrizione"
              [principale]="azioni.di(c).principale"
              [altre]="azioni.di(c).altre"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td [attr.colspan]="puoScrivere ? 4 : 3">Nessun elemento.</td>
        </tr>
      </ng-template>
    </p-table>
  `,
  styles: [
    `
      .solo-tel {
        display: none;
      }
      @media (max-width: 640px) {
        .solo-tel {
          display: inline;
        }
      }
    `,
  ],
})
export class CodificheGrigliaComponent<T extends CodificaBase<string> = CodificaBase<string>> {
  @Input() righe: T[] = []
  @Input() puoScrivere = false
  @Input({ required: true }) testid!: (azione: AzioneCodifica, codifica: T) => string
  @Output() modifica = new EventEmitter<T>()
  @Output() cambiaStato = new EventEmitter<T>()
  @Output() elimina = new EventEmitter<T>()

  /** «Modifica» sulla riga; «Disattiva»/«Riattiva» ed «Elimina» (se eliminabile) nel menu ⋯. */
  readonly azioni = new MemoriaAzioni<T>(c =>
    azioniDiRiga({
      modifica: () => this.modifica.emit(c),
      attivo: c.attiva,
      cambiaStato: () => this.cambiaStato.emit(c),
      elimina: c.eliminabile ? () => this.elimina.emit(c) : undefined,
    })
  )
}
