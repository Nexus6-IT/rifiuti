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
import { CheckboxModule } from 'primeng/checkbox'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { RegistroIva } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { messaggioErrore } from './tabella-comune'

/**
 * Nuovo registro IVA o modifica. Il codice è mandato come scritto: se è di una
 * cifra lo completa il server, e la tabella mostra il valore che ritorna.
 */
@Component({
  selector: 'app-registro-iva-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    InputTextModule,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="chiudi()"
      [header]="elemento ? 'Modifica registro IVA' : 'Nuovo registro IVA'"
      [modal]="true"
      [style]="{ width: '30rem' }"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <label for="registro-codice">Codice (due cifre, da 01 a 99)</label>
        <input
          pInputText
          id="registro-codice"
          formControlName="codice"
          maxlength="2"
          data-testid="registro-dlg-codice"
        />
        <label for="registro-descrizione">Descrizione</label>
        <input
          pInputText
          id="registro-descrizione"
          formControlName="descrizione"
          maxlength="60"
          data-testid="registro-dlg-descrizione"
        />
        <label for="registro-suffisso">Suffisso del numero di fattura (facoltativo)</label>
        <div
          [attr.title]="suffissoModificabile ? null : motivoSuffisso"
          data-testid="registro-dlg-suffisso-box"
        >
          <input
            pInputText
            id="registro-suffisso"
            formControlName="suffissoNumero"
            maxlength="10"
            placeholder="es. /A"
            [attr.aria-invalid]="form.controls.suffissoNumero.invalid ? 'true' : null"
            data-testid="registro-dlg-suffisso"
          />
        </div>
        <small
          *ngIf="form.controls.suffissoNumero.invalid"
          role="alert"
          class="field-error"
          data-testid="registro-dlg-suffisso-errore"
          >Da 1 a 10 caratteri: lettere, cifre, «/» e «-».</small
        >
        <small
          *ngIf="!suffissoModificabile"
          class="field-hint"
          data-testid="registro-dlg-suffisso-motivo"
          >{{ motivoSuffisso }}</small
        >
        <div>
          <p-checkbox
            inputId="registro-split"
            formControlName="ricevuteSplit"
            [binary]="true"
            data-testid="registro-dlg-split"
          />
          <label for="registro-split"> Registro delle ricevute split payment</label>
        </div>
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="registro-dlg-errore">
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
          data-testid="registro-dlg-salva"
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
export class RegistroIvaDialogComponent implements OnChanges {
  private readonly servizio = inject(TabelleFatturazioneService)

  @Input() visible = false
  /** null = nuovo. */
  @Input() elemento: RegistroIva | null = null
  @Output() salvato = new EventEmitter<RegistroIva>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly motivoSuffisso =
    "Il registro ha già fatture definitive nell'anno in corso: il suffisso non si può più cambiare."
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)

  readonly form = new FormGroup({
    codice: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    descrizione: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    ricevuteSplit: new FormControl(false, { nonNullable: true }),
    suffissoNumero: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^[A-Za-z0-9/-]{1,10}$/)],
    }),
  })

  /** Un registro nuovo ha sempre il suffisso libero. */
  get suffissoModificabile(): boolean {
    return this.elemento?.suffissoModificabile ?? true
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private inizializza(): void {
    const e = this.elemento
    this.form.reset({
      codice: e?.codice ?? '',
      descrizione: e?.descrizione ?? '',
      ricevuteSplit: e?.ricevuteSplit ?? false,
      suffissoNumero: e?.suffissoNumero ?? '',
    })
    if (this.suffissoModificabile) this.form.controls.suffissoNumero.enable()
    else this.form.controls.suffissoNumero.disable()
    this.errore.set(null)
    this.inCorso.set(false)
  }

  salva(): void {
    if (this.form.invalid || this.inCorso()) return
    const v = this.form.getRawValue()
    const dati = {
      codice: v.codice.trim(),
      descrizione: v.descrizione.trim(),
      ricevuteSplit: v.ricevuteSplit,
      // Bloccato: non si rimanda, il backend risponderebbe 409 SUFFISSO_NON_MODIFICABILE.
      ...(this.suffissoModificabile ? { suffissoNumero: v.suffissoNumero.trim() || null } : {}),
    }
    this.inCorso.set(true)
    this.errore.set(null)
    const chiamata = this.elemento
      ? this.servizio.registri.modifica(this.elemento.id, {
          ...dati,
          versione: this.elemento.versione,
        })
      : this.servizio.registri.crea(dati)
    chiamata.subscribe({
      next: salvato => {
        this.inCorso.set(false)
        this.salvato.emit(salvato)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile salvare il registro IVA.'))
      },
    })
  }

  chiudi(): void {
    this.form.reset()
    this.errore.set(null)
    this.visibleChange.emit(false)
  }
}
