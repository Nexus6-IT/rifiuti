import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { RipristinaFocusDirective } from '../../../shared/directives/ripristina-focus.directive'
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
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    DialogModule,
    RipristinaFocusDirective,
    InputTextareaModule,
  ],
  template: `
    <p-dialog
      [appRipristinaFocus]="visible"
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      [header]="scarto ? 'Annulla e rifattura' : 'Annulla il documento'"
      [modal]="true"
      [draggable]="false"
      [closable]="!inCorso"
      [closeOnEscape]="!inCorso"
      [style]="{ width: '34rem', maxWidth: '96vw' }"
      data-testid="annulla-dialog"
    >
      <p *ngIf="!scarto">Il numero torna disponibile. Indica il motivo dell'annullo.</p>
      <p *ngIf="scarto" data-testid="annulla-scarto">
        Lo SDI ha scartato la fattura. Il numero resta consumato dal documento annullato e le righe
        tornano da fatturare: potrai emettere una nuova fattura col numero successivo.
      </p>
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
      <label *ngIf="chiediDuplicato" class="block" data-testid="annulla-duplicato">
        <input
          type="checkbox"
          [ngModel]="duplicatoControllato"
          (ngModelChange)="duplicatoCambiato.emit($event)"
          [disabled]="inCorso"
          data-testid="annulla-duplicato-check"
        />
        Ho controllato nel cassetto fiscale: la fattura non risulta ricevuta dallo SDI.
      </label>
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
          [label]="scarto ? 'Annulla e rifattura' : 'Annulla il documento'"
          icon="pi pi-times"
          severity="danger"
          [disabled]="!valido() || inCorso || (chiediDuplicato && !duplicatoControllato)"
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
  /** Emesso scartato dallo SDI (4.5d): testo dedicato e motivo precompilato. */
  @Input() scarto = false
  @Input() motivoIniziale = ''
  /** Scarto «duplicato» (00404): serve la conferma di aver controllato. */
  @Input() chiediDuplicato = false
  @Input() duplicatoControllato = false
  @Output() readonly duplicatoCambiato = new EventEmitter<boolean>()
  @Output() readonly confermato = new EventEmitter<string>()
  @Output() readonly chiuso = new EventEmitter<void>()

  motivo = ''
  readonly maxMotivo = MAX_MOTIVO

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible']) this.motivo = this.motivoIniziale
  }

  valido(): boolean {
    const t = this.motivo.trim()
    return t.length >= 1 && t.length <= MAX_MOTIVO
  }

  conferma(): void {
    if (this.inCorso || !this.valido()) return
    if (this.chiediDuplicato && !this.duplicatoControllato) return
    this.confermato.emit(this.motivo.trim())
  }

  chiudi(): void {
    if (!this.inCorso) this.chiuso.emit()
  }
}
