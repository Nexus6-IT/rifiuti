import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import { FormControl, ReactiveFormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { Opzione } from './opzioni-fatturazione'

/**
 * Etichetta, select di una tabella e pulsante "Nuovo …" accanto (aggiunta in linea, D20). Il
 * pulsante emette l'evento del clic: serve a `AggiuntaInLinea` per riportare il focus. Senza
 * `puoCreare` (VIEWER) il pulsante non c'è.
 */
@Component({
  selector: 'app-scelta-con-nuovo',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule],
  template: `
    <label [for]="inputId">{{ etichetta }}</label>
    <div class="scelta">
      <select
        [id]="inputId"
        [formControl]="controllo"
        class="p-inputtext"
        [attr.data-testid]="testid"
      >
        <option value="">{{ vuoto }}</option>
        <option *ngFor="let o of opzioni" [value]="o.id">{{ o.etichetta }}</option>
      </select>
      <p-button
        *ngIf="puoCreare"
        [label]="nuovoEtichetta"
        icon="pi pi-plus"
        [text]="true"
        size="small"
        (onClick)="nuovo.emit($event)"
        [attr.data-testid]="nuovoTestid"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .scelta {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }
      .scelta select {
        flex: 1 1 auto;
        min-width: 0;
      }
    `,
  ],
})
export class SceltaConNuovoComponent {
  @Input({ required: true }) controllo!: FormControl<string>
  @Input({ required: true }) opzioni!: Opzione[]
  @Input({ required: true }) inputId!: string
  @Input({ required: true }) etichetta!: string
  @Input({ required: true }) testid!: string
  @Input({ required: true }) nuovoEtichetta!: string
  @Input({ required: true }) nuovoTestid!: string
  @Input() vuoto = '—'
  @Input() puoCreare = false
  @Output() nuovo = new EventEmitter<unknown>()
}
