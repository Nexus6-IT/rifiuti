import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { RipristinaFocusDirective } from '../../../shared/directives/ripristina-focus.directive'
import { formattaGiorno } from '../../giacenze/giorno'

/** Intervallo di numeri previsto per un registro (da `numerazionePrevista`). */
export interface IntervalloRegistro {
  codice: string
  da: string
  a: string
}

export interface RiepilogoConferma {
  /** `null` se non si riesce a ricavare il conteggio dai numeri. */
  documenti: number | null
  registri: IntervalloRegistro[]
  /** `AAAA-MM-GG`. */
  dataDocumento: string
}

/**
 * «Verranno emessi N documenti, numeri da X a Y del registro R, data gg/mm/aaaa.» (un solo
 * documento: «Verrà emesso 1 documento, numero X del registro R, ...»; più registri: un
 * intervallo per registro).
 */
export function testoConferma(r: RiepilogoConferma): string {
  const uno = r.documenti === 1
  const soggetto =
    r.documenti === null
      ? 'Verranno emessi i documenti'
      : uno
        ? 'Verrà emesso 1 documento'
        : `Verranno emessi ${r.documenti} documenti`
  const intervalli = r.registri.map(x =>
    x.da === x.a
      ? `${x.da} del registro ${x.codice}`
      : `da ${x.da} a ${x.a} del registro ${x.codice}`
  )
  const numeri =
    r.registri.length === 1 && r.registri[0].da === r.registri[0].a
      ? `numero ${intervalli[0]}`
      : `numeri ${intervalli.join(', ')}`
  return `${soggetto}, ${numeri}, data ${formattaGiorno(r.dataDocumento)}.`
}

/**
 * Conferma di «Rendi definitiva» (4.4c, Task 32): riepiloga quanti documenti verranno emessi, con
 * quali numeri e con quale data. Chiusura e conferma sono bloccate mentre la richiesta è in corso.
 */
@Component({
  selector: 'app-conferma-definitiva-dialog',
  standalone: true,
  imports: [CommonModule, ButtonModule, DialogModule, RipristinaFocusDirective],
  template: `
    <p-dialog
      [appRipristinaFocus]="visible"
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Rendi definitiva"
      [modal]="true"
      [draggable]="false"
      [closable]="!inCorso"
      [closeOnEscape]="!inCorso"
      [style]="{ width: '34rem', maxWidth: '96vw' }"
      data-testid="conferma-definitiva-dialog"
    >
      <p *ngIf="riepilogo as r" data-testid="conferma-testo">{{ testo(r) }}</p>
      <p class="text-secondary">
        I numeri sono previsti: vengono assegnati in modo definitivo alla conferma.
      </p>
      <ng-template pTemplate="footer">
        <p-button
          label="Annulla"
          [text]="true"
          [disabled]="inCorso"
          (onClick)="chiudi()"
          data-testid="conferma-annulla"
        />
        <p-button
          label="Rendi definitiva"
          icon="pi pi-check"
          [disabled]="inCorso"
          [loading]="inCorso"
          (onClick)="conferma()"
          data-testid="conferma-ok"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class ConfermaDefinitivaDialogComponent {
  @Input() visible = false
  @Input() riepilogo: RiepilogoConferma | null = null
  @Input() inCorso = false
  @Output() readonly confermato = new EventEmitter<void>()
  @Output() readonly chiuso = new EventEmitter<void>()

  readonly testo = testoConferma

  conferma(): void {
    if (!this.inCorso) this.confermato.emit()
  }

  chiudi(): void {
    if (!this.inCorso) this.chiuso.emit()
  }
}
