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
import { InputTextModule } from 'primeng/inputtext'
import { Subscription } from 'rxjs'
import { ToastService } from '../../../core/services/toast.service'
import { messaggioErrore, permessoScrittura } from '../../clienti/tabelle/tabella-comune'
import { ListinoService } from '../listino.service'
import { CodificaAddebito, GenereCodificaAddebito } from '../listino.model'
import { CONCORDANZA_GENERE_ADDEBITO, ETICHETTE_GENERE_ADDEBITO } from '../vocabolario-listino'

/**
 * Nuova codifica di addebito o modifica. Modalità `rapida` (aggiunta in linea): solo la
 * descrizione, Invio salva e il codice lo assegna il server. Nella modalità normale il codice
 * (da 1 a 3 cifre, completato a tre dal server) è proposto da `prossimoCodice`; se lasciato
 * vuoto o ancora quello proposto lo assegna il server e il toast mostra il codice definitivo.
 */
@Component({
  selector: 'app-codifica-addebito-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="chiudi()"
      [header]="
        (elemento ? 'Modifica ' : concordanza().nuovo + ' ') + etichettaGenere().toLowerCase()
      "
      [modal]="true"
      [style]="{ width: '28rem' }"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <ng-container *ngIf="!rapida">
          <label for="codifica-add-codice">Codice (da 1 a 3 cifre, vuoto = automatico)</label>
          <input
            pInputText
            id="codifica-add-codice"
            formControlName="codice"
            maxlength="3"
            inputmode="numeric"
            data-testid="codifica-add-dlg-codice"
          />
        </ng-container>
        <label for="codifica-add-descrizione">Descrizione</label>
        <input
          pInputText
          id="codifica-add-descrizione"
          formControlName="descrizione"
          maxlength="45"
          (keydown.enter)="invio($event)"
          data-testid="codifica-add-dlg-descrizione"
        />
        <p
          *ngIf="errore() as e"
          role="alert"
          class="field-error"
          data-testid="codifica-add-dlg-errore"
        >
          {{ e }}
        </p>
      </form>
      <ng-template pTemplate="footer">
        <p-button label="Annulla" [text]="true" (onClick)="chiudi()" />
        <p-button
          label="Salva"
          icon="pi pi-check"
          [disabled]="form.invalid || inCorso() || !puoScrivere()"
          (onClick)="salva()"
          data-testid="codifica-add-dlg-salva"
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
export class CodificaAddebitoDialogComponent implements OnChanges {
  private readonly servizio = inject(ListinoService)
  private readonly toast = inject(ToastService)
  readonly puoScrivere = permessoScrittura()

  @Input() visible = false
  @Input() genere: GenereCodificaAddebito = 'GRUPPO'
  /** null = nuova. */
  @Input() elemento: CodificaAddebito | null = null
  /** Solo la descrizione; il codice lo assegna il server. */
  @Input() rapida = false
  @Output() salvato = new EventEmitter<CodificaAddebito>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  private proposta?: Subscription
  /** Codice proposto da `prossimoCodice` e non ancora modificato dall'utente. */
  private codiceProposto: string | null = null

  readonly form = new FormGroup({
    codice: new FormControl('', {
      nonNullable: true,
      validators: [Validators.pattern(/^\d{0,3}$/)],
    }),
    descrizione: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  })

  concordanza(): { nuovo: string; articolo: string } {
    return CONCORDANZA_GENERE_ADDEBITO[this.genere]
  }

  etichettaGenere(): string {
    return ETICHETTE_GENERE_ADDEBITO[this.genere]
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private inizializza(): void {
    this.proposta?.unsubscribe()
    this.codiceProposto = null
    const e = this.elemento
    this.form.reset({ codice: e?.codice ?? '', descrizione: e?.descrizione ?? '' })
    this.errore.set(null)
    this.inCorso.set(false)
    if (e || this.rapida) return
    // Informativo: se nel frattempo qualcuno prende il codice, lo ricalcola il server.
    this.proposta = this.servizio.codifiche.prossimoCodice(this.genere).subscribe({
      next: codice => {
        this.codiceProposto = codice
        this.form.controls.codice.setValue(codice)
      },
      error: () => undefined,
    })
  }

  invio(evento: Event): void {
    evento.preventDefault()
    this.salva()
  }

  salva(): void {
    if (this.form.invalid || this.inCorso() || !this.puoScrivere()) return
    const v = this.form.getRawValue()
    const descrizione = v.descrizione.trim()
    const codice = v.codice.trim()
    this.inCorso.set(true)
    this.errore.set(null)
    const chiamata = this.elemento
      ? this.servizio.codifiche.modifica(this.elemento.id, {
          codice,
          descrizione,
          versione: this.elemento.versione,
        })
      : this.servizio.codifiche.crea({
          genere: this.genere,
          descrizione,
          ...(this.rapida
            ? {}
            : { codice: codice === '' || codice === this.codiceProposto ? null : codice }),
        })
    chiamata.subscribe({
      next: salvata => {
        this.inCorso.set(false)
        if (!this.elemento) this.toast.success(`Codice assegnato: ${salvata.codice}.`)
        this.salvato.emit(salvata)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        const e = err as { status?: number; error?: { error?: string } }
        const terzoOperatore =
          this.rapida &&
          !this.elemento &&
          e?.status === 409 &&
          e.error?.error === 'CODIFICA_ADDEBITO_CODICE_DUPLICATO'
        this.errore.set(
          terzoOperatore
            ? 'Un collega ha appena usato lo stesso codice: riprova.'
            : messaggioErrore(err, 'Impossibile salvare.')
        )
      },
    })
  }

  chiudi(): void {
    // Nessuna proposta di codice in volo dopo la chiusura.
    this.proposta?.unsubscribe()
    this.form.reset()
    this.errore.set(null)
    this.visibleChange.emit(false)
  }
}
