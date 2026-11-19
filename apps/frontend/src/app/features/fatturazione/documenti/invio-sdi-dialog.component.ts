import { CommonModule } from '@angular/common'
import { Component, EventEmitter, Input, Output } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { CheckboxModule } from 'primeng/checkbox'
import { DialogModule } from 'primeng/dialog'
import { RipristinaFocusDirective } from '../../../shared/directives/ripristina-focus.directive'
import {
  EsitoAccodamentoSdi,
  MOTIVI_SALTO_SDI_ETICHETTE,
  MotivoSaltoSdi,
} from '../../sdi/sdi.model'

export const MSG_INVIO_SDI =
  'I documenti scelti verranno accodati e inviati allo SDI. Dopo l’invio diventano emessi e non si potranno più annullare.'
export const MSG_GIA_EMESSI =
  'Se hai già caricato questi documenti su un altro canale, lo SDI li scarterà come duplicati.'

/**
 * Conferma di «Invia allo SDI» (4.5b). Mostra quanti documenti si accodano e, se fra i selezionati
 * ce ne sono di già emessi (XML scaricato o «segnato come emesso»), chiede una conferma esplicita
 * in piu'. Dopo la risposta (202) mostra quanti sono stati accodati e, per ogni documento saltato,
 * il motivo. Chiusura e conferma sono bloccate mentre la richiesta e' in corso.
 */
@Component({
  selector: 'app-invio-sdi-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    RipristinaFocusDirective,
  ],
  template: `
    <p-dialog
      [appRipristinaFocus]="visible"
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Invia allo SDI"
      [modal]="true"
      [draggable]="false"
      [closable]="!inCorso"
      [closeOnEscape]="!inCorso"
      [style]="{ width: '36rem', maxWidth: '96vw' }"
      data-testid="invio-sdi-dialog"
    >
      <ng-container *ngIf="esito === null">
        <p data-testid="invio-sdi-conteggio">
          {{ quanti === 1 ? '1 documento selezionato.' : quanti + ' documenti selezionati.' }}
        </p>
        <p data-testid="invio-sdi-testo">{{ msgInvio }}</p>
        <div
          *ngIf="giaEmessi > 0"
          class="avviso-nota"
          role="note"
          data-testid="invio-sdi-gia-emessi"
        >
          <p>
            {{
              giaEmessi === 1
                ? '1 documento risulta già emesso.'
                : giaEmessi + ' documenti risultano già emessi.'
            }}
            {{ msgGiaEmessi }}
          </p>
          <label class="invio-sdi-conferma">
            <p-checkbox
              [binary]="true"
              [(ngModel)]="confermaGiaEmesso"
              inputId="invio-sdi-conferma-gia-emesso"
              data-testid="invio-sdi-conferma-gia-emesso"
            />
            <span>Confermo l’invio dei documenti già emessi</span>
          </label>
        </div>
      </ng-container>

      <ng-container *ngIf="esito as e">
        <p role="status" data-testid="invio-sdi-esito">
          {{
            e.accodate.length === 1
              ? '1 documento accodato per l’invio.'
              : e.accodate.length + ' documenti accodati per l’invio.'
          }}
        </p>
        <div *ngIf="e.saltate.length > 0" data-testid="invio-sdi-saltate">
          <p>
            {{
              e.saltate.length === 1
                ? '1 documento non è stato accodato:'
                : e.saltate.length + ' documenti non sono stati accodati:'
            }}
          </p>
          <ul>
            <li *ngFor="let s of e.saltate" data-testid="invio-sdi-saltato">
              {{ nome(s.documentoId) }}: {{ motivo(s.motivo) }}
            </li>
          </ul>
        </div>
      </ng-container>

      <p *ngIf="errore" role="alert" class="field-error" data-testid="invio-sdi-errore">
        {{ errore }}
      </p>
      <ng-template pTemplate="footer">
        <ng-container *ngIf="esito === null; else chiusura">
          <p-button
            label="Annulla"
            [text]="true"
            [disabled]="inCorso"
            (onClick)="chiudi()"
            data-testid="invio-sdi-annulla"
          />
          <p-button
            label="Invia allo SDI"
            icon="pi pi-send"
            [disabled]="inCorso || (giaEmessi > 0 && !confermaGiaEmesso)"
            [loading]="inCorso"
            (onClick)="conferma()"
            data-testid="invio-sdi-ok"
          />
        </ng-container>
        <ng-template #chiusura>
          <p-button label="Chiudi" (onClick)="chiudi()" data-testid="invio-sdi-chiudi" />
        </ng-template>
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .invio-sdi-conferma {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
      }
    `,
  ],
})
export class InvioSdiDialogComponent {
  @Input() visible = false
  /** Documenti selezionati. */
  @Input() quanti = 0
  /** Fra i selezionati, quelli gia' emessi. */
  @Input() giaEmessi = 0
  @Input() inCorso = false
  @Input() errore: string | null = null
  /** Risposta del backend, dopo la conferma. */
  @Input() esito: EsitoAccodamentoSdi | null = null
  /** Numero leggibile di un documento dal suo id (per l'elenco dei saltati). */
  @Input() nomi: Readonly<Record<string, string>> = {}
  @Output() readonly confermato = new EventEmitter<{ confermaGiaEmesso: boolean }>()
  @Output() readonly chiuso = new EventEmitter<void>()

  confermaGiaEmesso = false
  readonly msgInvio = MSG_INVIO_SDI
  readonly msgGiaEmessi = MSG_GIA_EMESSI

  nome(id: string): string {
    return this.nomi[id] ?? 'Documento'
  }

  motivo(m: MotivoSaltoSdi): string {
    return MOTIVI_SALTO_SDI_ETICHETTE[m] ?? m
  }

  conferma(): void {
    if (this.inCorso || (this.giaEmessi > 0 && !this.confermaGiaEmesso)) return
    this.confermato.emit({ confermaGiaEmesso: this.giaEmessi > 0 && this.confermaGiaEmesso })
  }

  chiudi(): void {
    if (this.inCorso) return
    this.confermaGiaEmesso = false
    this.chiuso.emit()
  }
}
