import { CommonModule } from '@angular/common'
import {
  Component,
  computed,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  inject,
  signal,
} from '@angular/core'
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms'
import { Subscription } from 'rxjs'
import { ButtonModule } from 'primeng/button'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { InputTextModule } from 'primeng/inputtext'
import { CodiceIva } from '../../listino/listino.model'
import { ListinoService } from '../../listino/listino.service'
import {
  formatNumero,
  leggiNumero,
  messaggioNumero,
  validatoreNumero,
} from '../../../shared/utils/numero-modificabile'
import { SpesaAccessoria, TipoSpesa } from '../clienti.model'
import { TabelleFatturazioneService } from '../tabelle-fatturazione.service'
import { ETICHETTE_TIPO_SPESA, OPZIONI_TIPO_SPESA } from '../vocabolario-clienti'
import { messaggioErrore } from './tabella-comune'

/**
 * Nuova spesa o modifica. Con `tipo` fissato (dialog aperto dal campo bollo o
 * incasso) il tipo non si sceglie. L'importo si scrive con la virgola (il punto è vietato, niente migliaia) e parte come stringa
 * decimale col punto.
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
          [attr.aria-invalid]="erroreImporto() ? 'true' : null"
          [attr.aria-describedby]="erroreImporto() ? 'spesa-importo-errore' : null"
          data-testid="spesa-dlg-importo"
        />
        <small
          *ngIf="erroreImporto() as ei"
          id="spesa-importo-errore"
          role="alert"
          class="field-error"
          data-testid="spesa-dlg-importo-errore"
          >{{ ei }}</small
        >
        <label for="spesa-codice-iva">Codice IVA</label>
        <p-dropdown
          inputId="spesa-codice-iva"
          formControlName="codiceIvaId"
          [options]="opzioniIva()"
          optionLabel="etichetta"
          optionValue="id"
          [showClear]="true"
          placeholder="Nessuno"
          appendTo="body"
          data-testid="spesa-dlg-codice-iva"
        />
        <small
          *ngIf="suggerimentoBollo()"
          class="field-hint"
          data-testid="spesa-dlg-suggerimento-bollo"
          >{{ testoSuggerimentoBollo }}</small
        >
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
export class SpesaAccessoriaDialogComponent implements OnChanges, OnDestroy {
  private readonly servizio = inject(TabelleFatturazioneService)
  private readonly listino = inject(ListinoService)

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
  readonly testoSuggerimentoBollo = 'Per addebitare il bollo serve un codice IVA con natura N1'
  /** Tutti i codici IVA, anche disattivati (lista senza paginazione: il backend non ne ha). */
  private readonly codici = signal<CodiceIva[]>([])
  /** false finché la lista non è arrivata: il suggerimento non deve lampeggiare. */
  private readonly caricati = signal(false)
  private lettura?: Subscription
  private readonly codiceIvaScelto = signal<string | null>(null)
  private readonly tipoScelto = signal<TipoSpesa>('INCASSO')

  readonly opzioniIva = computed(() => {
    // Solo i codici attivi; la spesa può citarne uno poi disattivato: resta scelto, così il
    // salvataggio non lo perde, e la sua etichetta dice che è disattivato.
    const corrente = this.elemento?.codiceIvaId
    return this.codici()
      .filter(c => c.attivo || c.id === corrente)
      .map(c => ({
        id: c.id,
        etichetta: `${c.codice} - ${c.descrizione}${c.attivo ? '' : ' (disattivato)'}`,
      }))
  })

  /** Il bollo si addebita solo con un codice IVA di natura N1. */
  readonly suggerimentoBollo = computed(() => {
    if (this.tipoScelto() !== 'BOLLO' || !this.caricati()) return false
    // Anche un codice disattivato conta: ne conosciamo la natura.
    const c = this.codici().find(x => x.id === this.codiceIvaScelto())
    return c?.natura !== 'N1'
  })

  readonly form = new FormGroup({
    tipo: new FormControl<TipoSpesa>('INCASSO', { nonNullable: true }),
    codice: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    descrizione: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    importo: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, validatoreNumero('decimale')],
    }),
    codiceIvaId: new FormControl<string | null>(null),
  })

  constructor() {
    this.form.controls.codiceIvaId.valueChanges.subscribe(v => this.codiceIvaScelto.set(v))
    this.form.controls.tipo.valueChanges.subscribe(v => this.tipoScelto.set(v))
  }

  erroreImporto(): string | null {
    return messaggioNumero(this.form.controls.importo)
  }

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
      importo: formatNumero(e?.importo),
      codiceIvaId: e?.codiceIvaId ?? null,
    })
    this.tipoScelto.set(this.tipo ?? e?.tipo ?? 'INCASSO')
    this.codiceIvaScelto.set(e?.codiceIvaId ?? null)
    this.errore.set(null)
    this.inCorso.set(false)
    this.caricati.set(false)
    this.lettura?.unsubscribe()
    this.lettura = this.listino.codiciIva.list({ incluseDisattivate: true }).subscribe({
      next: l => {
        this.codici.set(l)
        this.caricati.set(true)
      },
      error: err => this.errore.set(messaggioErrore(err, 'Impossibile caricare i codici IVA.')),
    })
  }

  ngOnDestroy(): void {
    this.lettura?.unsubscribe()
  }

  salva(): void {
    if (this.form.invalid || this.inCorso()) return
    const v = this.form.getRawValue()
    const dati = {
      tipo: this.tipo ?? v.tipo,
      codice: v.codice.trim(),
      descrizione: v.descrizione.trim(),
      // Il backend vuole il punto; il resto della normalizzazione è suo.
      importo: leggiNumero(v.importo).valore ?? '',
      // Vuoto = nessun codice IVA: il backend vuole null, non la stringa vuota.
      codiceIvaId: v.codiceIvaId || null,
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
