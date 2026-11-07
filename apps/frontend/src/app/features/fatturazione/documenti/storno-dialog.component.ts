import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  signal,
} from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { CalendarModule } from 'primeng/calendar'
import { CheckboxModule } from 'primeng/checkbox'
import { DialogModule } from 'primeng/dialog'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { fineGiornoDiOggi, isoLocale } from '../impostazioni/numerazione-scheda.component'
import { MAX_MOTIVO } from './annulla-dialog.component'

export interface DatiStorno {
  motivo: string
  /** `AAAA-MM-GG`. */
  dataDocumento: string
  rifatturabile: boolean
}

/**
 * Storno di un documento definitivo con una nota di credito: motivo (1-200 caratteri), data della
 * nota (mai nel futuro) e «rifatturabile». `maxDate` riceve la fine del giorno ricalcolata a ogni
 * apertura (PrimeNG confronta istanti e svuoterebbe un valore scelto oggi).
 */
@Component({
  selector: 'app-storno-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CalendarModule,
    CheckboxModule,
    DialogModule,
    InputTextareaModule,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="$event ? null : chiudi()"
      header="Storna il documento"
      [modal]="true"
      [draggable]="false"
      [closable]="!inCorso"
      [closeOnEscape]="!inCorso"
      [style]="{ width: '36rem', maxWidth: '96vw' }"
      data-testid="storno-dialog"
    >
      <p>
        Il documento viene stornato con una nota di credito. Indica il motivo e la data della nota.
      </p>
      <label for="storno-motivo">Motivo (obbligatorio)</label>
      <textarea
        id="storno-motivo"
        pInputTextarea
        class="w-full"
        rows="3"
        [maxlength]="maxMotivo"
        [(ngModel)]="motivo"
        [disabled]="inCorso"
        data-testid="storno-motivo"
      ></textarea>
      <div class="storno-campo">
        <label for="storno-data">Data della nota di credito (obbligatorio)</label>
        <p-calendar
          inputId="storno-data"
          [required]="true"
          [(ngModel)]="data"
          [showIcon]="true"
          dateFormat="dd/mm/yy"
          [maxDate]="fineGiorno()"
          (onShow)="aggiornaFineGiorno()"
          (onFocus)="aggiornaFineGiorno()"
          [disabled]="inCorso"
          styleClass="w-full"
          data-testid="storno-data"
        />
      </div>
      <p *ngIf="dataFutura()" role="alert" class="field-error" data-testid="storno-errore-data">
        La data della nota di credito non può essere nel futuro.
      </p>
      <div class="storno-campo storno-riga">
        <p-checkbox
          inputId="storno-rifatturabile"
          [binary]="true"
          [(ngModel)]="rifatturabile"
          [disabled]="inCorso"
          data-testid="storno-rifatturabile"
        />
        <label for="storno-rifatturabile"
          >Rifatturabile: i movimenti tornano disponibili per una nuova fattura</label
        >
      </div>
      <p *ngIf="errore" role="alert" class="field-error" data-testid="storno-errore">
        {{ errore }}
      </p>
      <ng-template pTemplate="footer">
        <p-button
          label="Non stornare"
          [text]="true"
          [disabled]="inCorso"
          (onClick)="chiudi()"
          data-testid="storno-chiudi"
        />
        <p-button
          label="Storna"
          icon="pi pi-undo"
          severity="danger"
          [disabled]="!valido() || inCorso"
          [loading]="inCorso"
          (onClick)="conferma()"
          data-testid="storno-conferma"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .storno-campo {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        margin-top: var(--spacing-md);
      }
      .storno-riga {
        flex-direction: row;
        align-items: center;
        gap: var(--spacing-sm);
      }
    `,
  ],
})
export class StornoDialogComponent implements OnChanges {
  @Input() visible = false
  @Input() inCorso = false
  @Input() errore: string | null = null
  /** Valore iniziale di «rifatturabile» (la pagina degli scostamenti lo accende). */
  @Input() rifatturabileIniziale = false
  @Output() readonly confermato = new EventEmitter<DatiStorno>()
  @Output() readonly chiuso = new EventEmitter<void>()

  motivo = ''
  data: Date | null = null
  rifatturabile = false
  readonly maxMotivo = MAX_MOTIVO
  readonly fineGiorno = signal<Date>(fineGiornoDiOggi())

  ngOnChanges(c: SimpleChanges): void {
    if (!c['visible'] && !c['rifatturabileIniziale']) return
    if (c['visible'] && !this.visible) return
    this.fineGiorno.set(fineGiornoDiOggi())
    if (c['visible']) {
      this.motivo = ''
      this.data = new Date(this.fineGiorno().getTime())
      this.data.setHours(0, 0, 0, 0)
    }
    this.rifatturabile = this.rifatturabileIniziale
  }

  aggiornaFineGiorno(): void {
    this.fineGiorno.set(fineGiornoDiOggi())
  }

  dataFutura(): boolean {
    return !!this.data && this.data.getTime() > this.fineGiorno().getTime()
  }

  valido(): boolean {
    const t = this.motivo.trim()
    return t.length >= 1 && t.length <= MAX_MOTIVO && !!this.data && !this.dataFutura()
  }

  conferma(): void {
    if (this.inCorso || !this.valido() || !this.data) return
    this.confermato.emit({
      motivo: this.motivo.trim(),
      dataDocumento: isoLocale(this.data),
      rifatturabile: this.rifatturabile,
    })
  }

  chiudi(): void {
    if (!this.inCorso) this.chiuso.emit()
  }
}
