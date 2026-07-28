/**
 * AnagraficaSelectComponent — selettore ricercabile di una società dal registro.
 *
 * Sostituisce i campi in cui andava incollato un UUID: l'operatore cerca per
 * ragione sociale o partita IVA e sceglie una voce esistente. Il valore
 * scritto/emesso è SEMPRE l'`id` dell'anagrafica.
 *
 * I registri di un tenant sono piccoli (decine di voci) e le API `list` li
 * restituiscono per intero: il filtro è quindi lato client, senza chiamate a
 * ogni tasto premuto. Se il registro dovesse crescere di un ordine di
 * grandezza, qui va introdotta una ricerca server-side.
 */

import { Component, Input, OnInit, forwardRef, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule, ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms'
import { Observable } from 'rxjs'
import { AutoCompleteModule, AutoCompleteCompleteEvent } from 'primeng/autocomplete'
import { RegistryService } from './registry.service'
import { PaginatedResponse } from '../../shared/models/registry.model'

/** Registro anagrafico interrogabile da questo selettore. */
export type Registro = 'produttori' | 'trasportatori' | 'destinatari'

/** Campi comuni ai tre registri, gli unici che servono al selettore. */
interface AnagraficaBase {
  id: string
  ragioneSociale: string
  partitaIVA: string
}

/** Voce mostrata nel menu: ragione sociale + P.IVA per distinguere omonimie. */
interface AnagraficaOption {
  id: string
  ragioneSociale: string
  partitaIVA: string
  label: string
}

const ETICHETTA_REGISTRO: Record<Registro, string> = {
  produttori: 'produttore',
  trasportatori: 'trasportatore',
  destinatari: 'destinatario',
}

@Component({
  selector: 'app-anagrafica-select',
  standalone: true,
  imports: [CommonModule, FormsModule, AutoCompleteModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AnagraficaSelectComponent),
      multi: true,
    },
  ],
  template: `
    <!-- Registro vuoto: dirlo esplicitamente, invece di offrire una tendina
         che non si aprirà mai su nulla. -->
    <div *ngIf="caricato() && !voci().length" class="anagrafica-vuota" role="status">
      <i class="pi pi-info-circle" aria-hidden="true"></i>
      Nessun {{ etichettaRegistro }} in anagrafica: va censito prima di poterlo selezionare.
    </div>

    <p-autoComplete
      *ngIf="!caricato() || voci().length"
      [inputId]="inputId"
      [(ngModel)]="selected"
      [suggestions]="suggestions()"
      (completeMethod)="cerca($event)"
      (onSelect)="onSelezione($event.value)"
      (onClear)="onPulisci()"
      (onBlur)="onTouched()"
      field="label"
      [dropdown]="true"
      [forceSelection]="true"
      [minLength]="0"
      [showClear]="true"
      [disabled]="disabled || !caricato()"
      [required]="required"
      [placeholder]="caricato() ? placeholder : 'Caricamento…'"
      [ariaLabel]="ariaLabel"
      [scrollHeight]="'260px'"
      styleClass="w-full"
      inputStyleClass="w-full"
      [class.anagrafica-select--invalid]="invalid"
      [attr.aria-invalid]="invalid ? true : null"
    >
      <ng-template let-a pTemplate="item">
        <div class="anagrafica-opt">
          <span class="anagrafica-opt__nome">{{ a.ragioneSociale }}</span>
          <span class="anagrafica-opt__piva">P.IVA {{ a.partitaIVA }}</span>
        </div>
      </ng-template>
      <ng-template pTemplate="empty">
        <div class="anagrafica-empty">Nessun {{ etichettaRegistro }} corrisponde alla ricerca.</div>
      </ng-template>
    </p-autoComplete>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
      .anagrafica-opt {
        display: flex;
        flex-direction: column;
        line-height: 1.3;
        min-width: 0;
      }
      .anagrafica-opt__nome {
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
      }
      .anagrafica-opt__piva {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        font-variant-numeric: tabular-nums;
      }
      .anagrafica-empty,
      .anagrafica-vuota {
        padding: var(--spacing-sm) var(--spacing-base);
        font-size: var(--font-size-sm);
        color: var(--text-tertiary);
      }
      .anagrafica-vuota {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        border: 1px dashed var(--surface-border, #cbd5e1);
        border-radius: var(--border-radius, 6px);
      }
      .w-full {
        width: 100%;
      }
      :host ::ng-deep {
        .p-autocomplete,
        .p-autocomplete-input,
        .p-autocomplete .p-inputtext {
          width: 100%;
        }
        .anagrafica-select--invalid .p-autocomplete-input,
        .anagrafica-select--invalid .p-inputtext {
          border-color: var(--color-danger) !important;
          box-shadow: 0 0 0 1px var(--color-danger) !important;
        }
      }
    `,
  ],
})
export class AnagraficaSelectComponent implements OnInit, ControlValueAccessor {
  private readonly registry = inject(RegistryService)

  /** Registro da cui pescare. Cambiandolo, la lista viene ricaricata. */
  @Input({ required: true }) set registro(value: Registro) {
    if (value === this._registro) return
    this._registro = value
    this.caricaVoci()
  }
  get registro(): Registro {
    return this._registro
  }
  private _registro: Registro = 'produttori'

  @Input() inputId = 'anagrafica-select'
  @Input() ariaLabel = 'Società'
  @Input() placeholder = 'Cerca per ragione sociale o P.IVA…'
  @Input() invalid = false
  @Input() required = false
  /**
   * Con un solo elemento in registro, preselezionalo: chiedere di "scegliere"
   * fra una sola opzione è lavoro inutile per l'operatore.
   */
  @Input() preselezionaSeUnica = true

  readonly voci = signal<AnagraficaOption[]>([])
  readonly suggestions = signal<AnagraficaOption[]>([])
  readonly caricato = signal(false)

  selected: AnagraficaOption | string | null = null
  disabled = false

  /** Id ricevuto da writeValue prima che la lista fosse pronta. */
  private idInAttesa: string | null = null

  private onChange: (value: string) => void = () => {}
  onTouched: () => void = () => {}

  get etichettaRegistro(): string {
    return ETICHETTA_REGISTRO[this._registro]
  }

  ngOnInit(): void {
    if (!this.caricato()) this.caricaVoci()
  }

  // ─── Caricamento ──────────────────────────────────────────────────────────

  /**
   * I tre metodi del RegistryService hanno tipi di ritorno diversi (Produttore,
   * Trasportatore, Destinatario): qui interessano solo i campi comuni, quindi
   * si restringe al minimo che serve al selettore.
   */
  private richiestaRegistro(): Observable<PaginatedResponse<AnagraficaBase>> {
    switch (this._registro) {
      case 'trasportatori':
        return this.registry.getTrasportatori(1, 500)
      case 'destinatari':
        return this.registry.getDestinatari(1, 500)
      default:
        return this.registry.getProduttori(1, 500)
    }
  }

  private caricaVoci(): void {
    this.caricato.set(false)
    this.voci.set([])
    this.suggestions.set([])

    this.richiestaRegistro().subscribe({
      next: risposta => {
        const opzioni = (risposta?.items ?? []).map(v => this.toOption(v))
        this.voci.set(opzioni)
        // Copia, non lo stesso riferimento: i due segnali non devono
        // condividere l'array, o un aggiornamento di uno passa inosservato
        // all'altro (vedi la nota su `cerca`).
        this.suggestions.set([...opzioni])
        this.caricato.set(true)
        this.risolviSelezioneIniziale()
      },
      error: () => {
        this.voci.set([])
        this.caricato.set(true)
      },
    })
  }

  /**
   * Applica l'id arrivato da writeValue (o la preselezione) una volta che la
   * lista è disponibile.
   */
  private risolviSelezioneIniziale(): void {
    if (this.idInAttesa) {
      const trovata = this.voci().find(v => v.id === this.idInAttesa)
      this.idInAttesa = null
      if (trovata) {
        this.selected = trovata
        return
      }
    }

    if (this.preselezionaSeUnica && !this.selected && this.voci().length === 1) {
      const unica = this.voci()[0]
      this.selected = unica
      this.onChange(unica.id)
    }
  }

  // ─── Ricerca ──────────────────────────────────────────────────────────────

  /**
   * SEMPRE un array NUOVO, anche quando l'elenco non cambia.
   *
   * p-autoComplete accende il proprio indicatore di caricamento quando invoca
   * `completeMethod` e lo spegne solo vedendo CAMBIARE l'input `suggestions`.
   * Riassegnare lo stesso riferimento (il caso della query vuota, cioe' del
   * semplice click sulla tendina) non e' un cambiamento: il menu resta a
   * caricare all'infinito senza mostrare nulla.
   */
  cerca(event: AutoCompleteCompleteEvent): void {
    const q = (event.query || '').trim().toLowerCase()
    if (!q) {
      this.suggestions.set([...this.voci()])
      return
    }
    this.suggestions.set(
      this.voci().filter(
        v => v.ragioneSociale.toLowerCase().includes(q) || v.partitaIVA.includes(q)
      )
    )
  }

  onSelezione(option: AnagraficaOption): void {
    this.selected = option
    this.onChange(option?.id ?? '')
    this.onTouched()
  }

  onPulisci(): void {
    this.selected = null
    this.onChange('')
    this.onTouched()
  }

  // ─── ControlValueAccessor ─────────────────────────────────────────────────

  writeValue(value: string | null): void {
    const id = (value ?? '').trim()
    if (!id) {
      this.selected = null
      this.idInAttesa = null
      return
    }
    if (this.caricato()) {
      this.selected = this.voci().find(v => v.id === id) ?? null
    } else {
      this.idInAttesa = id
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled
  }

  // ─── Helper ───────────────────────────────────────────────────────────────

  private toOption(v: {
    id: string
    ragioneSociale: string
    partitaIVA: string
  }): AnagraficaOption {
    return {
      id: v.id,
      ragioneSociale: v.ragioneSociale,
      partitaIVA: v.partitaIVA,
      label: `${v.ragioneSociale} — ${v.partitaIVA}`,
    }
  }
}
