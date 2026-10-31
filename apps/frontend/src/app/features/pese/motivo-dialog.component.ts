/**
 * Dialog di conferma con motivo obbligatorio: annullamento di un accesso e revoca di un
 * collegamento. Il testo di conferma nomina l'oggetto (il numero dell'accesso) cosi' chi
 * conferma sa che cosa sta annullando. Un errore del backend (409/422/...) si mostra testuale.
 */
import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { STILI_PESE } from './pese-stili'

@Component({
  selector: 'app-motivo-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DialogModule],
  template: `
    <p-dialog
      [visible]="true"
      (visibleChange)="!$event && annulla.emit()"
      [header]="titolo"
      [modal]="true"
      [style]="{ width: '520px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi la finestra"
      (onShow)="mettiAFuoco()"
    >
      <p data-testid="md-messaggio" class="nota">{{ messaggio }}</p>
      <div class="field">
        <label for="md-motivo">Motivo <span class="req" aria-hidden="true">*</span></label>
        <textarea
          id="md-motivo"
          class="p-inputtext w-full"
          rows="3"
          maxlength="500"
          [(ngModel)]="motivo"
          aria-required="true"
          [attr.aria-invalid]="tentato && !motivo.trim() ? true : null"
          [attr.aria-describedby]="tentato && !motivo.trim() ? 'md-motivo-errore' : null"
          data-testid="md-motivo"
        ></textarea>
        <small
          *ngIf="tentato && !motivo.trim()"
          id="md-motivo-errore"
          class="field-error"
          role="alert"
          data-testid="md-motivo-errore"
          >Il motivo è obbligatorio.</small
        >
      </div>
      <p *ngIf="errore" class="field-error" role="alert" data-testid="md-errore">{{ errore }}</p>
      <div class="azioni">
        <p-button label="Indietro" [text]="true" (onClick)="annulla.emit()"></p-button>
        <p-button
          [label]="etichettaConferma"
          severity="danger"
          [loading]="inCorso"
          [disabled]="inCorso"
          (onClick)="conferma_()"
          data-testid="md-conferma"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [STILI_PESE],
})
export class MotivoDialogComponent {
  @Input() titolo = ''
  @Input() messaggio = ''
  @Input() etichettaConferma = 'Conferma'
  @Input() inCorso = false
  @Input() errore: string | null = null
  @Output() conferma = new EventEmitter<string>()
  @Output() annulla = new EventEmitter<void>()

  motivo = ''
  tentato = false

  mettiAFuoco(): void {
    setTimeout(() => document.getElementById('md-motivo')?.focus())
  }

  conferma_(): void {
    if (this.inCorso) return
    this.tentato = true
    const m = this.motivo.trim()
    if (!m) {
      document.getElementById('md-motivo')?.focus()
      return
    }
    this.conferma.emit(m)
  }
}
