/**
 * Dialog «Non eseguito» con motivo obbligatorio (4.7 T11). Chiama da sé `nonEseguito` e avvisa con
 * `eseguito` a fine; il 409 (FIR attivo, versione cambiata) resta dentro il dialog come errore.
 */
import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { dataItaliana, messaggioErroreRitiri, RitiroVista } from './ritiri.model'
import { RitiriService } from './ritiri.service'
import { STILI_RITIRI } from './ritiri-stili'

@Component({
  selector: 'app-non-eseguito-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DialogModule],
  template: `
    <p-dialog
      [visible]="true"
      (visibleChange)="!$event && chiuso.emit()"
      header="Segna come non eseguito"
      [modal]="true"
      [style]="{ width: '480px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi senza procedere"
    >
      <p class="nota" data-testid="ne-riepilogo">
        Ritiro del {{ data(ritiro.dataPrevista) }} di {{ ritiro.produttore.nome }}.
      </p>
      <div class="field">
        <label for="ne-motivo">Motivo <span class="req" aria-hidden="true">*</span></label>
        <textarea
          id="ne-motivo"
          class="p-inputtext w-full"
          rows="3"
          maxlength="500"
          [(ngModel)]="motivo"
          [attr.aria-invalid]="errore() ? true : null"
          aria-describedby="ne-errore"
          data-testid="ne-motivo"
        ></textarea>
      </div>
      <p
        *ngIf="errore() as e"
        id="ne-errore"
        role="alert"
        class="field-error"
        data-testid="ne-errore"
      >
        {{ e }}
      </p>
      <div class="azioni">
        <p-button
          label="Torna indietro"
          [text]="true"
          (onClick)="chiuso.emit()"
          data-testid="ne-indietro"
          [autofocus]="true"
        ></p-button>
        <p-button
          label="Segna non eseguito"
          [loading]="inCorso()"
          [disabled]="inCorso()"
          (onClick)="conferma()"
          data-testid="ne-conferma"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [STILI_RITIRI],
})
export class NonEseguitoDialogComponent {
  private readonly servizio = inject(RitiriService)

  @Input({ required: true }) ritiro!: RitiroVista
  @Output() readonly eseguito = new EventEmitter<RitiroVista>()
  @Output() readonly chiuso = new EventEmitter<void>()

  motivo = ''
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  readonly data = dataItaliana

  conferma(): void {
    if (this.inCorso()) return
    const motivo = this.motivo.trim()
    if (!motivo) {
      this.errore.set('Il motivo è obbligatorio.')
      return
    }
    this.inCorso.set(true)
    this.errore.set(null)
    this.servizio.nonEseguito(this.ritiro.id, motivo, this.ritiro.versione).subscribe({
      next: r => {
        this.inCorso.set(false)
        this.eseguito.emit(r)
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErroreRitiri(err, 'Operazione non riuscita.'))
      },
    })
  }
}
