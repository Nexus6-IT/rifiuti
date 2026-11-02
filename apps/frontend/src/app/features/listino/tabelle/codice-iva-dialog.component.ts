import { CommonModule } from '@angular/common'
import {
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { messaggioErrore } from '../../clienti/tabelle/tabella-comune'
import { ListinoService } from '../listino.service'
import { CodiceIva } from '../listino.model'
import { OPZIONI_NATURA_IVA } from '../vocabolario-listino'

/**
 * Nuovo codice IVA o modifica. L'aliquota è un campo di testo (mai `p-inputNumber`, R12) e
 * viaggia come stringa; la coerenza aliquota/natura la decide il backend e il suo messaggio si
 * mostra così com'è.
 */
@Component({
  selector: 'app-codice-iva-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="chiudi()"
      [header]="elemento ? 'Modifica codice IVA' : 'Nuovo codice IVA'"
      [modal]="true"
      [style]="{ width: '32rem' }"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <label for="iva-codice">Codice (da 1 a 3 lettere o cifre)</label>
        <input
          pInputText
          id="iva-codice"
          formControlName="codice"
          maxlength="3"
          data-testid="iva-dlg-codice"
        />
        <label for="iva-descrizione">Descrizione</label>
        <input
          pInputText
          id="iva-descrizione"
          formControlName="descrizione"
          maxlength="60"
          data-testid="iva-dlg-descrizione"
        />
        <label for="iva-aliquota">Aliquota (%)</label>
        <input
          pInputText
          id="iva-aliquota"
          formControlName="aliquota"
          inputmode="decimal"
          maxlength="6"
          data-testid="iva-dlg-aliquota"
        />
        <label for="iva-natura">Natura dell'operazione (solo con aliquota zero)</label>
        <p-dropdown
          inputId="iva-natura"
          formControlName="natura"
          [options]="nature"
          optionLabel="label"
          optionValue="value"
          [showClear]="true"
          placeholder="Nessuna"
          appendTo="body"
          data-testid="iva-dlg-natura"
        />
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="iva-dlg-errore">
          {{ e }}
        </p>
      </form>
      <ng-template pTemplate="footer">
        <p-button label="Annulla" [text]="true" (onClick)="chiudi()" />
        <p-button
          label="Salva"
          icon="pi pi-check"
          [disabled]="form.invalid || inCorso()"
          (onClick)="salva()"
          data-testid="iva-dlg-salva"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
      .dlg-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
    `,
  ],
})
export class CodiceIvaDialogComponent implements OnChanges {
  private readonly servizio = inject(ListinoService)

  @Input() visible = false
  /** null = nuovo. */
  @Input() elemento: CodiceIva | null = null
  @Output() salvato = new EventEmitter<CodiceIva>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly nature = OPZIONI_NATURA_IVA
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)

  readonly form = new FormGroup({
    codice: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    descrizione: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    aliquota: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    natura: new FormControl<string | null>(null),
  })

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private inizializza(): void {
    const e = this.elemento
    this.form.reset({
      codice: e?.codice ?? '',
      descrizione: e?.descrizione ?? '',
      aliquota: e?.aliquota ?? '',
      natura: e?.natura ?? null,
    })
    this.errore.set(null)
    this.inCorso.set(false)
  }

  salva(): void {
    if (this.form.invalid || this.inCorso()) return
    const v = this.form.getRawValue()
    const dati = {
      codice: v.codice.trim(),
      descrizione: v.descrizione.trim(),
      aliquota: v.aliquota.trim(),
      natura: v.natura ?? null,
    }
    this.inCorso.set(true)
    this.errore.set(null)
    const chiamata = this.elemento
      ? this.servizio.codiciIva.modifica(this.elemento.id, {
          ...dati,
          versione: this.elemento.versione,
        })
      : this.servizio.codiciIva.crea(dati)
    chiamata.subscribe({
      next: salvato => {
        this.inCorso.set(false)
        this.salvato.emit(salvato)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile salvare il codice IVA.'))
      },
    })
  }

  chiudi(): void {
    this.form.reset()
    this.errore.set(null)
    this.visibleChange.emit(false)
  }
}
