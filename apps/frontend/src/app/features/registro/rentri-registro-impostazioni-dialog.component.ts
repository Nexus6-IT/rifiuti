/**
 * Impostazioni RENTRI del registro (solo amministratori: la visibilità la decide il backend con
 * `puoConfigurare`, il frontend non deduce il ruolo dal token).
 *
 * - Identificativo del registro (`^R[0-9A-Z]{10}$`) preso dal portale RENTRI.
 * - Invio automatico "da oggi": lo storico del registro NON parte da solo.
 * - "Dichiara già su RENTRI": annotazioni di un intervallo già presenti su RENTRI (per esempio
 *   trasmesse con un altro programma): il registro non le invierà.
 *
 * Gli errori del backend (409 "annotazioni già partite", identificativo già usato, ecc.) sono già
 * in italiano e si mostrano così come arrivano, dentro il dialog.
 */

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
import { CommonModule } from '@angular/common'
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputNumberModule } from 'primeng/inputnumber'
import { InputTextModule } from 'primeng/inputtext'
import { InputTextareaModule } from 'primeng/inputtextarea'
import { ToastService } from '../../core/services/toast.service'
import {
  EsitoDichiarazione,
  ImpostazioniRegistroRentri,
  RentriRegistroService,
  messaggioErroreRentri,
} from './rentri-registro.service'
import { NumeroItalianoDirective } from '../../shared/directives/numero-it.directive'

export const FORMATO_IDENTIFICATIVO = /^R[0-9A-Z]{10}$/

@Component({
  selector: 'app-rentri-registro-impostazioni-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    DialogModule,
    InputNumberModule,
    NumeroItalianoDirective,
    InputTextModule,
    InputTextareaModule,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="visibleChange.emit($event)"
      header="Impostazioni RENTRI del registro"
      [modal]="true"
      [closable]="true"
      [closeOnEscape]="true"
      [style]="{ width: '640px', maxWidth: '95vw' }"
      closeAriaLabel="Chiudi le impostazioni RENTRI"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" data-testid="rentri-imp-form" novalidate>
        <div class="field">
          <label for="rentri-imp-identificativo">Identificativo del registro su RENTRI</label>
          <input
            id="rentri-imp-identificativo"
            type="text"
            pInputText
            class="w-full"
            formControlName="identificativo"
            autocomplete="off"
            maxlength="11"
            data-testid="rentri-imp-identificativo"
            [attr.aria-invalid]="erroreIdentificativo() ? true : null"
            [attr.aria-describedby]="
              erroreIdentificativo()
                ? 'rentri-imp-identificativo-hint rentri-imp-identificativo-err'
                : 'rentri-imp-identificativo-hint'
            "
          />
          <small id="rentri-imp-identificativo-hint" class="field-hint"
            >Lo trovi sul portale RENTRI, nella scheda del registro. Lasciando il campo vuoto il
            registro non è collegato a RENTRI.</small
          >
          <small
            *ngIf="erroreIdentificativo()"
            id="rentri-imp-identificativo-err"
            class="field-error"
            role="alert"
            data-testid="rentri-imp-identificativo-err"
            >L'identificativo è una R seguita da 10 tra lettere maiuscole e cifre (11 caratteri in
            tutto).</small
          >
        </div>

        <div class="field">
          <label class="rentri-imp-check">
            <input
              type="checkbox"
              formControlName="invioAutomatico"
              data-testid="rentri-imp-auto"
              aria-describedby="rentri-imp-auto-nota"
            />
            Trasmetti automaticamente le nuove annotazioni da oggi
          </label>
          <small id="rentri-imp-auto-nota" class="field-hint" data-testid="rentri-imp-auto-nota"
            >Partono da sole solo le annotazioni registrate da quando attivi l'interruttore. Lo
            storico già presente nel registro non parte: per quello usa «Trasmetti lo storico
            dell'anno». Serve l'identificativo del registro.</small
          >
        </div>

        <p *ngIf="errore() as e" class="field-error" role="alert" data-testid="rentri-imp-errore">
          {{ e }}
        </p>

        <div class="rentri-imp-azioni">
          <p-button
            type="submit"
            label="Salva le impostazioni"
            icon="pi pi-check"
            [loading]="salvataggio()"
            data-testid="rentri-imp-salva"
            ariaLabel="Salva le impostazioni RENTRI del registro"
          ></p-button>
        </div>
      </form>

      <hr />

      <section aria-labelledby="rentri-dic-titolo" data-testid="rentri-dic">
        <h3 id="rentri-dic-titolo" class="rentri-imp-titolo">Dichiara già su RENTRI</h3>
        <p class="field-hint" id="rentri-dic-nota">
          Per annotazioni già presenti su RENTRI, per esempio trasmesse con un altro programma. Il
          registro non le invierà e le mostrerà come «Già su RENTRI».
        </p>
        <form [formGroup]="formDichiara" (ngSubmit)="chiediDichiarazione()" novalidate>
          <div class="grid">
            <div class="col-12 sm:col-4">
              <div class="field">
                <label id="rentri-dic-anno-label" for="rentri-dic-anno">Anno</label>
                <p-inputNumber
                  appNumeroIt
                  locale="it-IT"
                  soloIntero
                  [maxFractionDigits]="0"
                  formControlName="anno"
                  inputId="rentri-dic-anno"
                  [useGrouping]="false"
                  [min]="2000"
                  [max]="2100"
                  ariaLabelledBy="rentri-dic-anno-label"
                  data-testid="rentri-dic-anno-wrap"
                ></p-inputNumber>
              </div>
            </div>
            <div class="col-12 sm:col-4">
              <div class="field">
                <label for="rentri-dic-da">Dal numero</label>
                <p-inputNumber
                  appNumeroIt
                  soloIntero
                  locale="it-IT"
                  [useGrouping]="false"
                  [maxFractionDigits]="0"
                  inputId="rentri-dic-da"
                  [min]="1"
                  styleClass="w-full"
                  inputStyleClass="w-full"
                  formControlName="da"
                  data-testid="rentri-dic-da"
                  aria-describedby="rentri-dic-nota"
                ></p-inputNumber>
              </div>
            </div>
            <div class="col-12 sm:col-4">
              <div class="field">
                <label for="rentri-dic-a">Al numero</label>
                <p-inputNumber
                  appNumeroIt
                  soloIntero
                  locale="it-IT"
                  [useGrouping]="false"
                  [maxFractionDigits]="0"
                  inputId="rentri-dic-a"
                  [min]="1"
                  styleClass="w-full"
                  inputStyleClass="w-full"
                  formControlName="a"
                  data-testid="rentri-dic-a"
                  aria-describedby="rentri-dic-nota"
                ></p-inputNumber>
              </div>
            </div>
          </div>
          <div class="field">
            <label for="rentri-dic-motivo">Motivo</label>
            <textarea
              id="rentri-dic-motivo"
              pInputTextarea
              rows="2"
              maxlength="500"
              class="w-full"
              formControlName="motivo"
              data-testid="rentri-dic-motivo"
            ></textarea>
          </div>

          <p
            *ngIf="erroreDichiarazione() as e"
            class="field-error"
            role="alert"
            data-testid="rentri-dic-errore"
          >
            {{ e }}
          </p>
          <p *ngIf="esitoDichiarazione() as s" role="status" data-testid="rentri-dic-esito">
            {{ s }}
          </p>

          <div *ngIf="!inConferma(); else conferma">
            <p-button
              type="submit"
              label="Dichiara già su RENTRI…"
              icon="pi pi-check-square"
              [outlined]="true"
              [disabled]="formDichiara.invalid"
              data-testid="rentri-dic-avvia"
              ariaLabel="Dichiara già presenti su RENTRI le annotazioni dell'intervallo"
            ></p-button>
          </div>
          <ng-template #conferma>
            <div
              class="rentri-imp-conferma"
              role="alertdialog"
              (keydown.escape)="annullaConferma(); $event.stopPropagation()"
              aria-labelledby="rentri-dic-conferma-testo"
              data-testid="rentri-dic-conferma"
            >
              <p id="rentri-dic-conferma-testo">
                Dichiari che fino a {{ quante() }}
                {{ quante() === 1 ? 'annotazione' : 'annotazioni' }} (dal numero
                {{ formDichiara.value.da }} al {{ formDichiara.value.a }} del
                {{ formDichiara.value.anno }}) sono già presenti su RENTRI. Il registro non le
                invierà. Confermi?
              </p>
              <p-button
                label="Sì, dichiara"
                severity="danger"
                size="small"
                [loading]="salvataggio()"
                (onClick)="dichiara()"
                data-testid="rentri-dic-conferma-si"
                ariaLabel="Conferma la dichiarazione"
              ></p-button>
              <p-button
                label="No"
                [text]="true"
                size="small"
                (onClick)="annullaConferma()"
                data-testid="rentri-dic-conferma-no"
                ariaLabel="Annulla la dichiarazione"
              ></p-button>
            </div>
          </ng-template>
        </form>
      </section>
    </p-dialog>
  `,
  styles: [
    `
      .rentri-imp-check {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        font-weight: 600;
      }
      .rentri-imp-azioni {
        margin-top: 0.75rem;
      }
      .rentri-imp-titolo {
        margin: 0 0 0.25rem;
        font-size: 1.05rem;
      }
      .rentri-imp-conferma {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: center;
      }
    `,
  ],
})
export class RentriRegistroImpostazioniDialogComponent implements OnChanges {
  private readonly fb = inject(FormBuilder)
  private readonly servizio = inject(RentriRegistroService)
  private readonly toast = inject(ToastService)

  @Input() visible = false
  @Input({ required: true }) registro!: ImpostazioniRegistroRentri
  @Input() annoCorrente = new Date().getFullYear()
  @Output() visibleChange = new EventEmitter<boolean>()
  /** Le impostazioni o i conteggi sono cambiati: la pagina le rilegge. */
  @Output() aggiornato = new EventEmitter<void>()

  readonly salvataggio = signal(false)
  readonly errore = signal<string | null>(null)
  readonly erroreDichiarazione = signal<string | null>(null)
  readonly esitoDichiarazione = signal<string | null>(null)
  readonly inConferma = signal(false)
  readonly identificativoNonValido = signal(false)

  readonly form = this.fb.nonNullable.group({
    identificativo: [''],
    invioAutomatico: [false],
  })

  readonly formDichiara = this.fb.group({
    anno: [this.annoCorrente as number | null, [Validators.required]],
    da: [null as number | null, [Validators.required, Validators.min(1)]],
    a: [null as number | null, [Validators.required, Validators.min(1)]],
    motivo: ['', [Validators.required, Validators.maxLength(500)]],
  })

  constructor() {
    this.form.controls.identificativo.valueChanges.subscribe(v => {
      this.identificativoNonValido.set(false)
      this.aggiornaInterruttore(v)
    })
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['visible'] && this.visible) {
      this.form.reset(
        {
          identificativo: this.registro.identificativoRentri ?? '',
          invioAutomatico: this.registro.invioAutomatico,
        },
        { emitEvent: false }
      )
      this.aggiornaInterruttore(this.registro.identificativoRentri ?? '')
      this.formDichiara.reset({ anno: this.annoCorrente, da: null, a: null, motivo: '' })
      this.errore.set(null)
      this.erroreDichiarazione.set(null)
      this.esitoDichiarazione.set(null)
      this.inConferma.set(false)
      this.identificativoNonValido.set(false)
    }
  }

  private normalizzato(): string {
    return this.form.controls.identificativo.value.trim().toUpperCase()
  }

  /** L'invio automatico richiede un identificativo valido: senza, l'interruttore è spento e bloccato. */
  private aggiornaInterruttore(valore: string): void {
    const ctrl = this.form.controls.invioAutomatico
    const valido = FORMATO_IDENTIFICATIVO.test(valore.trim().toUpperCase())
    if (valido) ctrl.enable({ emitEvent: false })
    else {
      ctrl.setValue(false, { emitEvent: false })
      ctrl.disable({ emitEvent: false })
    }
  }

  erroreIdentificativo(): boolean {
    return this.identificativoNonValido()
  }

  salva(): void {
    const id = this.normalizzato()
    if (id !== '' && !FORMATO_IDENTIFICATIVO.test(id)) {
      this.identificativoNonValido.set(true)
      return
    }
    this.errore.set(null)
    this.salvataggio.set(true)
    this.servizio
      .imposta(this.registro.registroId, {
        identificativoRentri: id === '' ? null : id,
        invioAutomatico: id === '' ? false : this.form.controls.invioAutomatico.value,
      })
      .subscribe({
        next: () => {
          this.salvataggio.set(false)
          this.toast.success('Impostazioni RENTRI salvate.')
          this.aggiornato.emit()
          this.visibleChange.emit(false)
        },
        error: err => {
          this.salvataggio.set(false)
          this.errore.set(messaggioErroreRentri(err))
        },
      })
  }

  /** Al massimo quante annotazioni tocca l'intervallo (il backend conta quelle davvero presenti). */
  quante(): number {
    const { da, a } = this.formDichiara.value
    return da != null && a != null && a >= da ? a - da + 1 : 0
  }

  chiediDichiarazione(): void {
    this.erroreDichiarazione.set(null)
    this.esitoDichiarazione.set(null)
    const { da, a } = this.formDichiara.value
    if (this.formDichiara.invalid || da == null || a == null || a < da) {
      this.erroreDichiarazione.set(
        "Controlla l'intervallo: il numero finale non può essere minore del primo."
      )
      return
    }
    this.inConferma.set(true)
    setTimeout(() =>
      document.body
        .querySelector<HTMLElement>('[data-testid="rentri-dic-conferma-si"] button')
        ?.focus()
    )
  }

  annullaConferma(): void {
    this.inConferma.set(false)
    setTimeout(() =>
      document.body.querySelector<HTMLElement>('[data-testid="rentri-dic-avvia"] button')?.focus()
    )
  }

  dichiara(): void {
    const v = this.formDichiara.value
    this.salvataggio.set(true)
    this.servizio
      .dichiaraGiaSuRentri({
        registroId: this.registro.registroId,
        anno: v.anno as number,
        daProgressivo: v.da as number,
        aProgressivo: v.a as number,
        motivo: (v.motivo ?? '').trim(),
      })
      .subscribe({
        next: (e: EsitoDichiarazione) => {
          this.salvataggio.set(false)
          this.inConferma.set(false)
          this.esitoDichiarazione.set(
            `Dichiarate già su RENTRI: ${e.dichiarate}. Lasciate come sono: ${e.saltate} (già in coda, in invio, incerte o trasmesse).`
          )
          this.aggiornato.emit()
        },
        error: err => {
          this.salvataggio.set(false)
          this.inConferma.set(false)
          this.erroreDichiarazione.set(messaggioErroreRentri(err))
        },
      })
  }
}
