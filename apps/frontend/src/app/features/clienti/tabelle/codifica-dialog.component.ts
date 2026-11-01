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
import { CodificaContratto, GenereCodifica } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { ETICHETTE_GENERE } from '../vocabolario-clienti'
import { messaggioErrore } from './tabella-comune'

/**
 * Nuova codifica o modifica. Modalità `rapida` (aggiunta in linea, come F4 di
 * WinWaste): solo la descrizione, Invio salva e il codice lo assegna il server.
 * Nella modalità normale il codice è proposto da `prossimoCodice` e, se lasciato
 * vuoto, lo assegna il server; il toast mostra il codice definitivo.
 */
@Component({
  selector: 'app-codifica-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="chiudi()"
      [header]="(elemento ? 'Modifica ' : 'Nuovo ') + etichettaGenere().toLowerCase()"
      [modal]="true"
      [style]="{ width: '28rem' }"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <ng-container *ngIf="!rapida">
          <label for="codifica-codice">Codice (fino a 3 caratteri, vuoto = automatico)</label>
          <input
            pInputText
            id="codifica-codice"
            formControlName="codice"
            maxlength="3"
            data-testid="codifica-dlg-codice"
          />
        </ng-container>
        <label for="codifica-descrizione">Descrizione</label>
        <input
          pInputText
          id="codifica-descrizione"
          formControlName="descrizione"
          maxlength="60"
          (keydown.enter)="invio($event)"
          data-testid="codifica-dlg-descrizione"
        />
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="codifica-dlg-errore">
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
          data-testid="codifica-dlg-salva"
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
export class CodificaDialogComponent implements OnChanges {
  private readonly servizio = inject(TabelleFatturazioneService)
  private readonly toast = inject(ToastService)

  @Input() visible = false
  @Input() genere: GenereCodifica = 'CATEGORIA'
  /** null = nuova. */
  @Input() elemento: CodificaContratto | null = null
  /** Solo la descrizione; il codice lo assegna il server. */
  @Input() rapida = false
  @Output() salvato = new EventEmitter<CodificaContratto>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  private proposta?: Subscription

  readonly form = new FormGroup({
    codice: new FormControl('', { nonNullable: true }),
    descrizione: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  })

  etichettaGenere(): string {
    return ETICHETTE_GENERE[this.genere]
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private inizializza(): void {
    this.proposta?.unsubscribe()
    const e = this.elemento
    this.form.reset({ codice: e?.codice ?? '', descrizione: e?.descrizione ?? '' })
    this.errore.set(null)
    this.inCorso.set(false)
    if (e || this.rapida) return
    // Informativo: se nel frattempo qualcuno prende il codice, lo ricalcola il server.
    this.proposta = this.servizio.codifiche.prossimoCodice(this.genere).subscribe({
      next: codice => this.form.controls.codice.setValue(codice),
      error: () => undefined,
    })
  }

  invio(evento: Event): void {
    evento.preventDefault()
    this.salva()
  }

  salva(): void {
    if (this.form.invalid || this.inCorso()) return
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
          ...(this.rapida ? {} : { codice: codice === '' ? null : codice }),
        })
    chiamata.subscribe({
      next: salvata => {
        this.inCorso.set(false)
        if (!this.elemento) {
          this.toast.success(`Codice assegnato: ${salvata.codice}.`)
        }
        this.salvato.emit(salvata)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile salvare.'))
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
