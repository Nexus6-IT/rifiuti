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
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { CondizionePagamento, ModalitaPagamento } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { OPZIONI_MODALITA } from '../vocabolario-clienti'
import { messaggioErrore } from './tabella-comune'

/**
 * Nuova condizione o modifica. Le rate sono chip numerici: il frontend manda i
 * numeri nell'ordine in cui sono stati inseriti e mostra il valore normalizzato
 * restituito dal backend (che ordina e rifiuta i duplicati).
 */
@Component({
  selector: 'app-condizione-pagamento-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonModule,
    CheckboxModule,
    DialogModule,
    DropdownModule,
    InputTextModule,
  ],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="chiudi()"
      [header]="elemento ? 'Modifica condizione di pagamento' : 'Nuova condizione di pagamento'"
      [modal]="true"
      [style]="{ width: '34rem' }"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <label for="cond-codice">Codice</label>
        <input
          pInputText
          id="cond-codice"
          formControlName="codice"
          maxlength="10"
          data-testid="cond-dlg-codice"
        />
        <label for="cond-descrizione">Descrizione</label>
        <input
          pInputText
          id="cond-descrizione"
          formControlName="descrizione"
          maxlength="100"
          data-testid="cond-dlg-descrizione"
        />
        <label for="cond-modalita">Modalità di pagamento</label>
        <p-dropdown
          inputId="cond-modalita"
          formControlName="modalita"
          [options]="modalita"
          optionLabel="label"
          optionValue="value"
          appendTo="body"
          data-testid="cond-dlg-modalita"
        />
        <label for="cond-giorno">Rate (giorni dalla fattura)</label>
        <div class="dlg-riga">
          <input
            pInputText
            id="cond-giorno"
            inputmode="numeric"
            [value]="giornoNuovo()"
            (input)="giornoNuovo.set($any($event.target).value)"
            (keydown.enter)="$event.preventDefault(); aggiungiGiorno()"
            placeholder="Es. 30"
            data-testid="cond-dlg-giorno"
          />
          <p-button
            label="Aggiungi rata"
            icon="pi pi-plus"
            [outlined]="true"
            (onClick)="aggiungiGiorno()"
            data-testid="cond-dlg-aggiungi-giorno"
          />
        </div>
        <div class="dlg-chip" data-testid="cond-dlg-rate">
          <span *ngFor="let g of giorni(); let i = index" class="chip">
            {{ g }} gg
            <button
              type="button"
              class="chip-x"
              (click)="togliGiorno(i)"
              [attr.aria-label]="'Togli la rata a ' + g + ' giorni'"
            >
              ×
            </button>
          </span>
          <span *ngIf="giorni().length === 0" class="nota">Nessuna rata: pagamento a vista.</span>
        </div>
        <p-checkbox
          formControlName="fineMese"
          [binary]="true"
          label="Fine mese"
          data-testid="cond-dlg-fine-mese"
        />
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="cond-dlg-errore">
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
          data-testid="cond-dlg-salva"
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
      .dlg-riga {
        display: flex;
        gap: 0.5rem;
      }
      .dlg-chip {
        display: flex;
        flex-wrap: wrap;
        gap: 0.4rem;
        min-height: 1.8rem;
      }
      .chip {
        background: var(--surface-200);
        border-radius: 1rem;
        padding: 0.15rem 0.6rem;
      }
      .chip-x {
        border: 0;
        background: transparent;
        cursor: pointer;
        margin-left: 0.3rem;
      }
      .nota {
        color: var(--text-color-secondary);
      }
    `,
  ],
})
export class CondizionePagamentoDialogComponent implements OnChanges {
  private readonly servizio = inject(TabelleFatturazioneService)

  @Input() visible = false
  /** null = nuova. */
  @Input() elemento: CondizionePagamento | null = null
  @Output() salvato = new EventEmitter<CondizionePagamento>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly modalita = OPZIONI_MODALITA
  readonly giorni = signal<number[]>([])
  readonly giornoNuovo = signal('')
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)

  readonly form = new FormGroup({
    codice: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    descrizione: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    modalita: new FormControl<ModalitaPagamento>('MP05', { nonNullable: true }),
    fineMese: new FormControl(false, { nonNullable: true }),
  })

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private inizializza(): void {
    const e = this.elemento
    this.form.reset({
      codice: e?.codice ?? '',
      descrizione: e?.descrizione ?? '',
      modalita: e?.modalita ?? 'MP05',
      fineMese: e?.fineMese ?? false,
    })
    this.giorni.set(e ? [...e.giorniRate] : [])
    this.giornoNuovo.set('')
    this.errore.set(null)
    this.inCorso.set(false)
  }

  aggiungiGiorno(): void {
    const testo = this.giornoNuovo().trim()
    if (!/^\d{1,3}$/.test(testo)) {
      this.errore.set('Inserire i giorni della rata come numero intero.')
      return
    }
    this.errore.set(null)
    // Nessun riordino: lo fa il backend.
    this.giorni.update(g => [...g, Number(testo)])
    this.giornoNuovo.set('')
  }

  togliGiorno(indice: number): void {
    this.giorni.update(g => g.filter((_, i) => i !== indice))
  }

  salva(): void {
    if (this.form.invalid || this.inCorso()) return
    const v = this.form.getRawValue()
    const dati = {
      codice: v.codice.trim(),
      descrizione: v.descrizione.trim(),
      modalita: v.modalita,
      // Senza rate il dominio intende "a vista": una sola rata a 0 giorni.
      giorniRate: this.giorni().length === 0 ? [0] : this.giorni(),
      fineMese: v.fineMese,
    }
    this.inCorso.set(true)
    this.errore.set(null)
    const chiamata = this.elemento
      ? this.servizio.condizioni.modifica(this.elemento.id, {
          ...dati,
          versione: this.elemento.versione,
        })
      : this.servizio.condizioni.crea(dati)
    chiamata.subscribe({
      next: salvata => {
        this.inCorso.set(false)
        this.salvato.emit(salvata)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile salvare la condizione di pagamento.'))
      },
    })
  }

  chiudi(): void {
    this.visibleChange.emit(false)
  }
}
