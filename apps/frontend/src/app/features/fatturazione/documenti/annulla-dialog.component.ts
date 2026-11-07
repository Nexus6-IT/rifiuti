import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextareaModule } from 'primeng/inputtextarea'

/** Lunghezza massima del motivo di annullo e di storno (come il backend). */
export const MAX_MOTIVO = 200

/**
 * Annullo di un documento definitivo: chiede il motivo (1-200 caratteri dopo il trim). Il pulsante
 * resta disattivato a motivo vuoto e mentre la richiesta è in corso.
 */
@Component({
  selector: 'app-annulla-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DialogModule, InputTextareaModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Annulla il documento"
      [modal]="true"
      [draggable]="false"
      [closable]="!inCorso"
      [closeOnEscape]="!inCorso"
      [style]="{ width: '34rem', maxWidth: '96vw' }"
      data-testid="annulla-dialog"
    >
      <p>Il numero torna disponibile. Indica il motivo dell'annullo.</p>
      <label for="annulla-motivo">Motivo (obbligatorio)</label>
      <textarea
        id="annulla-motivo"
        pInputTextarea
        class="w-full"
        rows="3"
        [maxlength]="maxMotivo"
        [(ngModel)]="motivo"
        [disabled]="inCorso"
        data-testid="annulla-motivo"
      ></textarea>
      <p *ngIf="errore" role="alert" class="field-error" data-testid="annulla-errore">
        {{ errore }}
      </p>
      <ng-template pTemplate="footer">
        <p-button
          label="Non annullare"
          [text]="true"
          [disabled]="inCorso"
          (onClick)="chiudi()"
          data-testid="annulla-chiudi"
        />
        <p-button
          label="Annulla il documento"
          icon="pi pi-times"
          severity="danger"
          [disabled]="!valido() || inCorso"
          [loading]="inCorso"
          (onClick)="conferma()"
          data-testid="annulla-conferma"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class AnnullaDialogComponent implements OnChanges {
  @Input() visible = false
  @Input() inCorso = false
  @Input() errore: string | null = null
  @Output() readonly confermato = new EventEmitter<string>()
  @Output() readonly chiuso = new EventEmitter<void>()

  motivo = ''
  readonly maxMotivo = MAX_MOTIVO

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible']) this.motivo = ''
  }

  valido(): boolean {
    const t = this.motivo.trim()
    return t.length >= 1 && t.length <= MAX_MOTIVO
  }

  conferma(): void {
    if (this.inCorso || !this.valido()) return
    this.confermato.emit(this.motivo.trim())
  }

  chiudi(): void {
    if (!this.inCorso) this.chiuso.emit()
  }
}
