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
import { SpesaAccessoria, TipoSpesa } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { ETICHETTE_TIPO_SPESA, OPZIONI_TIPO_SPESA } from '../vocabolario-clienti'
import { messaggioErrore } from './tabella-comune'

/**
 * Nuova spesa o modifica. Con `tipo` fissato (dialog aperto dal campo bollo o
 * incasso) il tipo non si sceglie. L'importo è una stringa decimale col punto.
 */
@Component({
  selector: 'app-spesa-accessoria-dialog',
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
      [header]="elemento ? 'Modifica spesa accessoria' : 'Nuova spesa accessoria'"
      [modal]="true"
      [style]="{ width: '34rem' }"
    >
      <form [formGroup]="form" (ngSubmit)="salva()" class="dlg-form">
        <ng-container *ngIf="tipo; else sceltaTipo">
          <span>Tipo</span>
          <strong data-testid="spesa-dlg-tipo-fisso">{{ etichettaTipo(tipo) }}</strong>
        </ng-container>
        <ng-template #sceltaTipo>
          <label for="spesa-tipo">Tipo</label>
          <p-dropdown
            inputId="spesa-tipo"
            formControlName="tipo"
            [options]="tipi"
            optionLabel="label"
            optionValue="value"
            appendTo="body"
            data-testid="spesa-dlg-tipo"
          />
        </ng-template>
        <label for="spesa-codice">Codice</label>
        <input
          pInputText
          id="spesa-codice"
          formControlName="codice"
          maxlength="10"
          data-testid="spesa-dlg-codice"
        />
        <label for="spesa-descrizione">Descrizione</label>
        <input
          pInputText
          id="spesa-descrizione"
          formControlName="descrizione"
          maxlength="100"
          data-testid="spesa-dlg-descrizione"
        />
        <label for="spesa-importo">Importo (euro)</label>
        <input
          pInputText
          id="spesa-importo"
          formControlName="importo"
          inputmode="decimal"
          placeholder="0,00"
          data-testid="spesa-dlg-importo"
        />
        <p *ngIf="errore() as e" role="alert" class="field-error" data-testid="spesa-dlg-errore">
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
          data-testid="spesa-dlg-salva"
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
export class SpesaAccessoriaDialogComponent implements OnChanges {
  private readonly servizio = inject(TabelleFatturazioneService)

  @Input() visible = false
  /** null = nuova. */
  @Input() elemento: SpesaAccessoria | null = null
  /** Tipo fissato: non modificabile. */
  @Input() tipo?: TipoSpesa
  @Output() salvato = new EventEmitter<SpesaAccessoria>()
  @Output() visibleChange = new EventEmitter<boolean>()

  readonly tipi = OPZIONI_TIPO_SPESA
  readonly errore = signal<string | null>(null)
  readonly inCorso = signal(false)

  readonly form = new FormGroup({
    tipo: new FormControl<TipoSpesa>('INCASSO', { nonNullable: true }),
    codice: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    descrizione: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    importo: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  })

  etichettaTipo(t: TipoSpesa): string {
    return ETICHETTE_TIPO_SPESA[t]
  }

  ngOnChanges(c: SimpleChanges): void {
    if (c['visible'] && this.visible) this.inizializza()
  }

  private inizializza(): void {
    const e = this.elemento
    this.form.reset({
      tipo: e?.tipo ?? this.tipo ?? 'INCASSO',
      codice: e?.codice ?? '',
      descrizione: e?.descrizione ?? '',
      importo: e?.importo ?? '',
    })
    this.errore.set(null)
    this.inCorso.set(false)
  }

  salva(): void {
    if (this.form.invalid || this.inCorso()) return
    const v = this.form.getRawValue()
    const dati = {
      tipo: this.tipo ?? v.tipo,
      codice: v.codice.trim(),
      descrizione: v.descrizione.trim(),
      // Il backend vuole il punto; il resto della normalizzazione è suo.
      importo: v.importo.trim().replace(',', '.'),
    }
    this.inCorso.set(true)
    this.errore.set(null)
    const chiamata = this.elemento
      ? this.servizio.spese.modifica(this.elemento.id, {
          ...dati,
          versione: this.elemento.versione,
        })
      : this.servizio.spese.crea(dati)
    chiamata.subscribe({
      next: salvata => {
        this.inCorso.set(false)
        this.salvato.emit(salvata)
        this.chiudi()
      },
      error: err => {
        this.inCorso.set(false)
        this.errore.set(messaggioErrore(err, 'Impossibile salvare la spesa accessoria.'))
      },
    })
  }

  chiudi(): void {
    this.visibleChange.emit(false)
  }
}
