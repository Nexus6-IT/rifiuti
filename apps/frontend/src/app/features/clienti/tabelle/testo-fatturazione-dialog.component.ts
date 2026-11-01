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
import { FormArray, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { InputTextModule } from 'primeng/inputtext'
import { TestoFatturazione } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { messaggioErrore } from './tabella-comune'

const MAX_RIGHE = 16
const MAX_CARATTERI = 60

/** Nuovo testo di fatturazione o modifica: titolo e fino a 16 righe da 60 caratteri. */
@Component({
  selector: 'app-testo-fatturazione-dialog',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, DialogModule, InputTextModule],
  template: `
    <p-dialog
      [visible]="visible"
      (visibleChange)="chiudi()"
      [header]="elemento ? 'Modifica testo di fatturazione' : 'Nuovo testo di fatturazione'"
      [modal]="true"
      [style]="{ width: '40rem' }"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <label for="testo-codice">Codice (fino a 3 caratteri)</label>
        <input
          pInputText
          id="testo-codice"
          formControlName="codice"
          maxlength="3"
          data-testid="testo-dlg-codice"
        />
        <label for="testo-titolo">Titolo</label>
        <input
          pInputText
          id="testo-titolo"
          formControlName="titolo"
          maxlength="60"
          data-testid="testo-dlg-titolo"
        />
        <span>Righe del testo (al massimo {{ maxRighe }})</span>
        <div formArrayName="righe" class="righe">
          <div *ngFor="let r of righe.controls; let i = index" class="riga">
            <input
              pInputText
              [formControlName]="i"
              [maxlength]="maxCaratteri"
              [attr.aria-label]="'Riga ' + (i + 1)"
              [attr.data-testid]="'testo-dlg-riga-' + i"
            />
            <small [attr.data-testid]="'testo-dlg-contatore-' + i">
              {{ r.value.length }}/{{ maxCaratteri }}
            </small>
          </div>
        </div>
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="testo-dlg-errore">
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
          data-testid="testo-dlg-salva"
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
      .righe {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        max-height: 20rem;
        overflow-y: auto;
      }
      .riga {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .riga input {
        flex: 1;
      }
    `,
  ],
})
export class TestoFatturazioneDialogComponent implements OnChanges {
  private readonly servizio = inject(TabelleFatturazioneService)

  @Input() visible = false
  /** null = nuovo. */
  @Input() elemento: TestoFatturazione | null = null
  @Output() salvato = new EventEmitter<TestoFatturazione>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly maxRighe = MAX_RIGHE
  readonly maxCaratteri = MAX_CARATTERI
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)

  readonly righe = new FormArray(
    Array.from({ length: MAX_RIGHE }, () => new FormControl('', { nonNullable: true }))
  )
  readonly form = new FormGroup({
    codice: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    titolo: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    righe: this.righe,
  })

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private inizializza(): void {
    const e = this.elemento
    this.form.reset({
      codice: e?.codice ?? '',
      titolo: e?.titolo ?? '',
      righe: Array.from({ length: MAX_RIGHE }, (_, i) => e?.righe[i] ?? ''),
    })
    this.errore.set(null)
    this.inCorso.set(false)
  }

  /** Righe in ordine, senza quelle vuote in coda (come le toglie il server). */
  private righeDaMandare(): string[] {
    const valori = this.righe.getRawValue().map(r => r.trim())
    while (valori.length > 0 && valori[valori.length - 1] === '') valori.pop()
    return valori
  }

  salva(): void {
    if (this.form.invalid || this.inCorso()) return
    const v = this.form.getRawValue()
    const dati = {
      codice: v.codice.trim(),
      titolo: v.titolo.trim(),
      righe: this.righeDaMandare(),
    }
    this.inCorso.set(true)
    this.errore.set(null)
    const chiamata = this.elemento
      ? this.servizio.testi.modifica(this.elemento.id, {
          ...dati,
          versione: this.elemento.versione,
        })
      : this.servizio.testi.crea(dati)
    chiamata.subscribe({
      next: salvato => {
        this.inCorso.set(false)
        this.salvato.emit(salvato)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile salvare il testo di fatturazione.'))
      },
    })
  }

  chiudi(): void {
    this.form.reset()
    this.errore.set(null)
    this.visibleChange.emit(false)
  }
}
