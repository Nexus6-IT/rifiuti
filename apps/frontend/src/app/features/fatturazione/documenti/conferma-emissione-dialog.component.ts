import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { RipristinaFocusDirective } from '../../../shared/directives/ripristina-focus.directive'

/** Decisione 12: scaricare l'XML o esportare rende il documento emesso. */
export const MSG_EMISSIONE = 'La fattura diventerà emessa e non si potrà più annullare.'
export const MSG_EMISSIONE_PIU_DOCUMENTI =
  'I documenti non ancora emessi diventeranno emessi e non si potranno più annullare.'
/** Decisione 15. */
export const MSG_TRACCIATO_NON_VERIFICATO = "Tracciato non verificato su un'installazione reale"

/**
 * Conferma di un'operazione che rende «emesso» un documento (XML, export non CSV, «Segna come
 * emesso»). Il testo e l'etichetta del pulsante li dà chi la usa; `avviso` è facoltativo (per
 * esempio il tracciato TeamSystem non verificato). Chiusura e conferma sono bloccate mentre la
 * richiesta è in corso, così un secondo clic non spedisce due volte.
 */
@Component({
  selector: 'app-conferma-emissione-dialog',
  standalone: true,
  imports: [CommonModule, ButtonModule, DialogModule, RipristinaFocusDirective],
  template: `
    <p-dialog
      [appRipristinaFocus]="visible"
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      [header]="titolo"
      [modal]="true"
      [draggable]="false"
      [closable]="!inCorso"
      [closeOnEscape]="!inCorso"
      [style]="{ width: '34rem', maxWidth: '96vw' }"
      data-testid="conferma-emissione-dialog"
    >
      <p data-testid="conferma-emissione-testo">{{ messaggio }}</p>
      <p *ngIf="avviso" class="avviso-nota" role="note" data-testid="conferma-emissione-avviso">
        {{ avviso }}
      </p>
      <p *ngIf="errore" role="alert" class="field-error" data-testid="conferma-emissione-errore">
        {{ errore }}
      </p>
      <ng-template pTemplate="footer">
        <p-button
          label="Annulla"
          [text]="true"
          [disabled]="inCorso"
          (onClick)="chiudi()"
          data-testid="conferma-emissione-annulla"
        />
        <p-button
          [label]="etichettaConferma"
          icon="pi pi-check"
          [disabled]="inCorso"
          [loading]="inCorso"
          (onClick)="conferma()"
          data-testid="conferma-emissione-ok"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class ConfermaEmissioneDialogComponent {
  @Input() visible = false
  @Input() titolo = 'Conferma'
  @Input() messaggio = MSG_EMISSIONE
  @Input() avviso: string | null = null
  @Input() errore: string | null = null
  @Input() etichettaConferma = 'Conferma'
  @Input() inCorso = false
  @Output() readonly confermato = new EventEmitter<void>()
  @Output() readonly chiuso = new EventEmitter<void>()

  conferma(): void {
    if (!this.inCorso) this.confermato.emit()
  }

  chiudi(): void {
    if (!this.inCorso) this.chiuso.emit()
  }
}
