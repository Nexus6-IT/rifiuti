import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
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
  imports: [CommonModule, ButtonModule, TableModule],
  template: `
    <p-table [value]="righe" styleClass="p-datatable-sm">
      <ng-template pTemplate="header">
        <tr>
          <th scope="col">Codice</th>
          <th scope="col">Descrizione</th>
          <th scope="col">Stato</th>
          <th scope="col" *ngIf="puoScrivere">Azioni</th>
        </tr>
      </ng-template>
      <ng-template pTemplate="body" let-c>
        <tr [attr.data-testid]="testid('riga', c)">
          <td>{{ c.codice }}</td>
          <td>{{ c.descrizione }}</td>
          <td>{{ c.attiva ? 'Attiva' : 'Disattivata' }}</td>
          <td *ngIf="puoScrivere">
            <p-button
              label="Modifica"
              icon="pi pi-pencil"
              [text]="true"
              size="small"
              (onClick)="modifica.emit(c)"
              [attr.data-testid]="testid('modifica', c)"
            />
            <p-button
              [label]="c.attiva ? 'Disattiva' : 'Riattiva'"
              [icon]="c.attiva ? 'pi pi-ban' : 'pi pi-replay'"
              [text]="true"
              size="small"
              (onClick)="cambiaStato.emit(c)"
              [attr.data-testid]="testid('attiva', c)"
            />
            <p-button
              *ngIf="c.eliminabile"
              label="Elimina"
              icon="pi pi-trash"
              severity="danger"
              [text]="true"
              size="small"
              (onClick)="elimina.emit(c)"
              [attr.data-testid]="testid('elimina', c)"
            />
          </td>
        </tr>
      </ng-template>
      <ng-template pTemplate="emptymessage">
        <tr>
          <td colspan="4">Nessun elemento.</td>
        </tr>
      </ng-template>
    </p-table>
  `,
})
export class CodificheGrigliaComponent<T extends CodificaBase<string> = CodificaBase<string>> {
  @Input() righe: T[] = []
  @Input() puoScrivere = false
  @Input({ required: true }) testid!: (azione: AzioneCodifica, codifica: T) => string
  @Output() modifica = new EventEmitter<T>()
  @Output() cambiaStato = new EventEmitter<T>()
  @Output() elimina = new EventEmitter<T>()
}
