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
import { ContoCorrente, ContoCorrenteInElenco } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { messaggioErrore } from './tabella-comune'

/**
 * Nuovo conto o modifica. L'elenco ha solo l'IBAN mascherato: in modifica il
 * dialog carica il record intero con `GET :id`.
 */
@Component({
  selector: 'app-conto-corrente-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="chiudi()"
      [header]="elemento ? 'Modifica conto corrente' : 'Nuovo conto corrente'"
      [modal]="true"
      [style]="{ width: '34rem' }"
    >
      <p *ngIf="caricamento()" role="status">Caricamento…</p>
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <label for="conto-codice">Codice</label>
        <input
          pInputText
          id="conto-codice"
          formControlName="codice"
          maxlength="10"
          data-testid="conto-dlg-codice"
        />
        <label for="conto-descrizione">Descrizione</label>
        <input
          pInputText
          id="conto-descrizione"
          formControlName="descrizione"
          maxlength="100"
          data-testid="conto-dlg-descrizione"
        />
        <label for="conto-banca">Banca</label>
        <input
          pInputText
          id="conto-banca"
          formControlName="banca"
          maxlength="80"
          data-testid="conto-dlg-banca"
        />
        <label for="conto-iban">IBAN</label>
        <input
          pInputText
          id="conto-iban"
          formControlName="iban"
          maxlength="42"
          data-testid="conto-dlg-iban"
        />
        <label for="conto-bic">BIC (facoltativo)</label>
        <input
          pInputText
          id="conto-bic"
          formControlName="bic"
          maxlength="11"
          data-testid="conto-dlg-bic"
        />
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="conto-dlg-errore">
          {{ e }}
        </p>
      </form>
      <ng-template pTemplate="footer">
        <p-button label="Annulla" [text]="true" (onClick)="chiudi()" />
        <p-button
          label="Salva"
          icon="pi pi-check"
          [disabled]="form.invalid || inCorso() || caricamento()"
          (onClick)="salva()"
          data-testid="conto-dlg-salva"
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
export class ContoCorrenteDialogComponent implements OnChanges {
  private readonly servizio = inject(TabelleFatturazioneService)

  @Input() visible = false
  /** null = nuovo. */
  @Input() elemento: ContoCorrenteInElenco | null = null
  @Output() salvato = new EventEmitter<ContoCorrente>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)
  readonly caricamento = signal(false)
  /** Versione del record caricato (in modifica). */
  private versione = 0
  private lettura?: Subscription

  readonly form = new FormGroup({
    codice: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    descrizione: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    banca: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    iban: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    bic: new FormControl('', { nonNullable: true }),
  })

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private inizializza(): void {
    this.lettura?.unsubscribe()
    this.form.reset()
    this.errore.set(null)
    this.inCorso.set(false)
    const e = this.elemento
    this.versione = e?.versione ?? 0
    if (!e) return
    this.caricamento.set(true)
    this.lettura = this.servizio.conti.get(e.id).subscribe({
      next: d => {
        this.versione = d.versione
        this.form.reset({
          codice: d.codice,
          descrizione: d.descrizione,
          banca: d.banca,
          iban: d.iban,
          bic: d.bic ?? '',
        })
        this.caricamento.set(false)
      },
      error: err => {
        this.caricamento.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile caricare il conto corrente.'))
      },
    })
  }

  salva(): void {
    if (this.form.invalid || this.inCorso() || this.caricamento()) return
    const v = this.form.getRawValue()
    const dati = {
      codice: v.codice.trim(),
      descrizione: v.descrizione.trim(),
      banca: v.banca.trim(),
      iban: v.iban.trim(),
      bic: v.bic.trim() === '' ? null : v.bic.trim(),
    }
    this.inCorso.set(true)
    this.errore.set(null)
    const chiamata = this.elemento
      ? this.servizio.conti.modifica(this.elemento.id, { ...dati, versione: this.versione })
      : this.servizio.conti.crea(dati)
    chiamata.subscribe({
      next: salvato => {
        this.inCorso.set(false)
        this.salvato.emit(salvato)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile salvare il conto corrente.'))
      },
    })
  }

  chiudi(): void {
    // Niente IBAN intero nel componente nascosto, e nessuna lettura in volo.
    this.lettura?.unsubscribe()
    this.caricamento.set(false)
    this.form.reset()
    this.visibleChange.emit(false)
  }
}
