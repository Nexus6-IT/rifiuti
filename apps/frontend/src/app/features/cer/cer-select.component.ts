/**
 * CerSelectComponent — selettore ricercabile del catalogo CER.
 *
 * Sostituisce i campi di testo libero per il codice CER: l'operatore cerca per
 * codice o descrizione (ricerca server-side con debounce sul catalogo di 837
 * voci) e sceglie una voce valida dal menu, evitando errori di digitazione.
 *
 * Implementa ControlValueAccessor: funziona sia con `[(ngModel)]` (form FIR)
 * sia con `formControlName` (reactive form del registro). Il valore
 * scritto/emesso è SEMPRE la stringa del codice CER canonico ("NN NN NN"(*)).
 *
 * Stile «Libro mastro» (giro 2): token del tema, bordi neutri, WCAG 2.1 AA.
 */

import { Component, Input, forwardRef } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule, ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms'
import {
  AutoCompleteModule,
  AutoCompleteCompleteEvent,
  AutoCompleteSelectEvent,
} from 'primeng/autocomplete'
import { TagModule } from 'primeng/tag'
import { CerService } from './cer.service'
import { CERSearchResult } from '../../shared/models/cer.model'

/** Opzione mostrata nel menu dell'autocomplete (voce del catalogo CER). */
interface CerOption {
  code: string
  description: string
  isPericoloso: boolean
  /** Etichetta visualizzata nell'input e usata da forceSelection: "code — descrizione". */
  label: string
}

@Component({
  selector: 'app-cer-select',
  standalone: true,
  imports: [CommonModule, FormsModule, AutoCompleteModule, TagModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CerSelectComponent),
      multi: true,
    },
  ],
  template: `
    <p-autoComplete
      [inputId]="inputId"
      [(ngModel)]="selected"
      [suggestions]="suggestions"
      (completeMethod)="searchCer($event)"
      (onSelect)="onOptionSelect($event)"
      (onClear)="onClear()"
      (onBlur)="onBlur()"
      field="label"
      [dropdown]="true"
      [forceSelection]="true"
      [minLength]="1"
      [delay]="300"
      [showClear]="true"
      [disabled]="disabled"
      [required]="required"
      [placeholder]="placeholder"
      [ariaLabel]="ariaLabel"
      [scrollHeight]="'260px'"
      styleClass="cer-select__ac w-full"
      inputStyleClass="w-full"
      [class.cer-select--invalid]="invalid"
      [attr.aria-invalid]="invalid ? true : null"
      [attr.aria-describedby]="ariaDescribedBy || null"
    >
      <ng-template let-cer pTemplate="item">
        <div class="cer-opt">
          <span class="cer-opt__text">
            <strong class="cer-opt__code">{{ cer.code }}</strong>
            <span class="cer-opt__desc">{{ cer.description }}</span>
          </span>
          <p-tag *ngIf="cer.isPericoloso" value="Pericoloso" severity="danger" [rounded]="true" />
        </div>
      </ng-template>
      <ng-template pTemplate="empty">
        <div class="cer-empty">Nessun codice CER trovato. Cerca per codice o descrizione.</div>
      </ng-template>
    </p-autoComplete>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
      .cer-opt {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--spacing-sm);
        width: 100%;
      }
      .cer-opt__text {
        display: flex;
        flex-direction: column;
        gap: 0;
        line-height: 1.3;
        min-width: 0;
      }
      .cer-opt__code {
        font-family: var(--font-family-mono);
        font-variant-numeric: tabular-nums;
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
      }
      .cer-opt__desc {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .cer-empty {
        padding: var(--spacing-sm) var(--spacing-base);
        font-size: var(--font-size-sm);
        color: var(--text-tertiary);
      }
      .w-full {
        width: 100%;
      }
      :host ::ng-deep {
        .p-autocomplete {
          width: 100%;
        }
        .p-autocomplete-input,
        .p-autocomplete .p-inputtext {
          width: 100%;
          font-family: var(--font-family-mono);
        }
        /* Stato invalido: bordo rosso WCAG AA coerente col design system B */
        .cer-select--invalid .p-autocomplete-input,
        .cer-select--invalid .p-inputtext {
          border-color: var(--color-danger) !important;
          box-shadow: 0 0 0 1px var(--color-danger) !important;
        }
      }
    `,
  ],
})
export class CerSelectComponent implements ControlValueAccessor {
  /** Id dell'input, per collegare la <label for="…"> esterna. */
  @Input() inputId = 'cer-select'
  /** Etichetta accessibile (aria-label) dell'input. */
  @Input() ariaLabel = 'Codice CER'
  @Input() placeholder = 'Cerca per codice o descrizione…'
  /** Marca lo stato di validazione (bordo rosso) governato dal form ospite. */
  @Input() invalid = false
  @Input() required = false
  /** Id dell'elemento che descrive l'errore (per aria-describedby). */
  @Input() ariaDescribedBy: string | null = null
  /**
   * Limita i risultati ai codici confermati dall'ultimo allineamento RENTRI
   * (`presenteInRentri=true`, R4 Task 7 Step 3). Default `true`: le uniche due
   * pagine che usano questo componente (form di creazione FIR, form del
   * registro C/S) sono entrambe creazione di un documento NUOVO, che non deve
   * proporre un codice che l'ente ha smesso di confermare. Un futuro utilizzo
   * su un form di modifica di un documento storico dovrà passare `false`.
   */
  @Input() soloPresentiInRentri = true

  /** Valore corrente dell'autocomplete: opzione selezionata o stringa digitata. */
  selected: CerOption | string | null = null
  suggestions: CerOption[] = []
  disabled = false

  private onChange: (value: string) => void = () => {}
  private onTouched: () => void = () => {}

  constructor(private readonly cerService: CerService) {}

  // ─── Ricerca server-side ──────────────────────────────────────────────────

  searchCer(event: AutoCompleteCompleteEvent): void {
    const query = (event.query || '').trim()
    if (query.length < 1) {
      this.suggestions = []
      return
    }
    this.cerService.searchCER(query, this.soloPresentiInRentri).subscribe({
      next: results => {
        this.suggestions = results.map(r => this.toOption(r))
      },
      error: () => {
        this.suggestions = []
      },
    })
  }

  onOptionSelect(event: AutoCompleteSelectEvent): void {
    const option = event.value as CerOption
    this.selected = option
    this.onChange(option?.code ?? '')
    this.onTouched()
  }

  onClear(): void {
    this.selected = null
    this.onChange('')
    this.onTouched()
  }

  onBlur(): void {
    this.onTouched()
  }

  // ─── ControlValueAccessor ─────────────────────────────────────────────────

  writeValue(value: string | null): void {
    const code = (value ?? '').trim()
    if (!code) {
      this.selected = null
      return
    }
    // Mostra subito il codice; risolve la descrizione in modo best-effort.
    this.selected = { code, description: '', isPericoloso: false, label: code }
    this.resolveCode(code)
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

  // ─── Helper ────────────────────────────────────────────────────────────────

  /** Risolve la descrizione di un codice preimpostato (edit/precompilato). */
  private resolveCode(code: string): void {
    this.cerService.searchCER(code).subscribe({
      next: results => {
        const match = results.find(r => r.code === code)
        if (match) {
          this.selected = this.toOption(match)
        }
      },
      error: () => {
        /* mantiene la visualizzazione del solo codice */
      },
    })
  }

  private toOption(r: CERSearchResult): CerOption {
    return {
      code: r.code,
      description: r.description,
      isPericoloso: r.isPericoloso,
      label: `${r.code} — ${r.description}`,
    }
  }
}
