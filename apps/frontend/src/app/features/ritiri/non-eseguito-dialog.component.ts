/**
 * Dialog del motivo per «Non eseguito» e «Annulla» (4.7 T11, unificato in T14). Chiama da sé
 * `nonEseguito` o `annulla` e avvisa con `eseguito` a fine; il 409 (FIR attivo, versione cambiata)
 * resta dentro il dialog come errore. `prefisso` dà gli id di test (`<prefisso>-motivo`, `-errore`,
 * `-conferma`, `-indietro`, `-riepilogo`); `motivo` è a due vie, così chi apre può precompilarlo.
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
      [header]="titolo"
      [modal]="true"
      [style]="{ width: '480px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi senza procedere"
    >
      <p class="nota" [attr.data-testid]="prefisso + '-riepilogo'">
        Ritiro del {{ data(ritiro.dataPrevista) }} di {{ ritiro.produttore.nome }}.
      </p>
      <div class="field">
        <label [for]="prefisso + '-motivo'"
          >Motivo <span class="req" aria-hidden="true">*</span></label
        >
        <textarea
          [id]="prefisso + '-motivo'"
          class="p-inputtext w-full"
          rows="3"
          maxlength="500"
          [ngModel]="motivo"
          (ngModelChange)="impostaMotivo($event)"
          [attr.aria-invalid]="errore() ? true : null"
          [attr.aria-describedby]="errore() ? prefisso + '-errore' : null"
          [attr.data-testid]="prefisso + '-motivo'"
        ></textarea>
      </div>
      <p
        *ngIf="errore() as e"
        [id]="prefisso + '-errore'"
        role="alert"
        class="field-error"
        [attr.data-testid]="prefisso + '-errore'"
      >
        {{ e }}
      </p>
      <div class="azioni">
        <p-button
          label="Torna indietro"
          [text]="true"
          (onClick)="chiuso.emit()"
          [attr.data-testid]="prefisso + '-indietro'"
          [autofocus]="true"
        ></p-button>
        <p-button
          [label]="etichettaConferma"
          [severity]="pericolosa ? 'danger' : undefined"
          [styleClass]="pericolosa ? 'p-button-danger' : ''"
          [loading]="inCorso()"
          [disabled]="inCorso()"
          (onClick)="conferma()"
          [attr.data-testid]="prefisso + '-conferma'"
        ></p-button>
      </div>
    </p-dialog>
  `,
  styles: [STILI_RITIRI],
})
export class NonEseguitoDialogComponent {
  private readonly servizio = inject(RitiriService)

  @Input({ required: true }) ritiro!: RitiroVista
  @Input() azione: 'NON_ESEGUITO' | 'ANNULLA' = 'NON_ESEGUITO'
  @Input() titolo = 'Segna come non eseguito'
  @Input() etichettaConferma = 'Segna non eseguito'
  @Input() pericolosa = false
  @Input() prefisso = 'ne'
  @Input() motivo = ''
  @Output() readonly motivoChange = new EventEmitter<string>()
  @Output() readonly eseguito = new EventEmitter<RitiroVista>()
  @Output() readonly chiuso = new EventEmitter<void>()

  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  readonly data = dataItaliana

  impostaMotivo(valore: string): void {
    this.motivo = valore
    this.motivoChange.emit(valore)
  }

  conferma(): void {
    if (this.inCorso()) return
    const motivo = this.motivo.trim()
    if (!motivo) {
      this.errore.set('Il motivo è obbligatorio.')
      return
    }
    this.inCorso.set(true)
    this.errore.set(null)
    const richiesta =
      this.azione === 'ANNULLA'
        ? this.servizio.annulla(this.ritiro.id, motivo, this.ritiro.versione)
        : this.servizio.nonEseguito(this.ritiro.id, motivo, this.ritiro.versione)
    richiesta.subscribe({
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
