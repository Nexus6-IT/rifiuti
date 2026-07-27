/**
 * CerMultiSelectComponent — selezione multipla di codici CER dal catalogo.
 *
 * Gemello multiplo di [CerSelectComponent]: stessa ricerca server-side sul
 * catalogo (837 voci), stesso vincolo di scegliere una voce esistente, ma
 * raccoglie più codici. Sostituisce i campi a testo libero in cui si poteva
 * scrivere qualunque cosa come "codice CER".
 *
 * Il valore scritto/emesso è SEMPRE `string[]` di codici canonici.
 */

import { Component, Input, forwardRef, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule, ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms'
import { AutoCompleteModule, AutoCompleteCompleteEvent } from 'primeng/autocomplete'
import { CerService } from './cer.service'
import { CERSearchResult } from '../../shared/models/cer.model'

interface CerOption {
  code: string
  description: string
  isPericoloso: boolean
  label: string
}

@Component({
  selector: 'app-cer-multi-select',
  standalone: true,
  imports: [CommonModule, FormsModule, AutoCompleteModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CerMultiSelectComponent),
      multi: true,
    },
  ],
  template: `
    <p-autoComplete
      [inputId]="inputId"
      [(ngModel)]="selected"
      [suggestions]="suggestions()"
      (completeMethod)="cerca($event)"
      (ngModelChange)="onSelezioneCambiata($event)"
      (onBlur)="onTouched()"
      field="label"
      [multiple]="true"
      [dropdown]="true"
      [forceSelection]="true"
      [minLength]="1"
      [delay]="300"
      [disabled]="disabled"
      [placeholder]="selected.length ? '' : placeholder"
      [ariaLabel]="ariaLabel"
      [scrollHeight]="'260px'"
      styleClass="w-full"
      inputStyleClass="w-full"
      [class.cer-multi--invalid]="invalid"
      [attr.aria-invalid]="invalid ? true : null"
    >
      <ng-template let-cer pTemplate="item">
        <div class="cer-opt">
          <strong class="cer-opt__code">{{ cer.code }}</strong>
          <span class="cer-opt__desc">{{ cer.description }}</span>
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
        flex-direction: column;
        line-height: 1.3;
        min-width: 0;
      }
      .cer-opt__code {
        font-family: var(--font-family-mono);
        font-variant-numeric: tabular-nums;
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
        .p-autocomplete-multiple-container {
          width: 100%;
        }
        .p-autocomplete-token {
          font-family: var(--font-family-mono);
          font-variant-numeric: tabular-nums;
        }
        .cer-multi--invalid .p-autocomplete-multiple-container {
          border-color: var(--color-danger) !important;
          box-shadow: 0 0 0 1px var(--color-danger) !important;
        }
      }
    `,
  ],
})
export class CerMultiSelectComponent implements ControlValueAccessor {
  @Input() inputId = 'cer-multi-select'
  @Input() ariaLabel = 'Codici CER'
  @Input() placeholder = 'Cerca per codice o descrizione…'
  @Input() invalid = false
  /** Vedi la stessa opzione su CerSelectComponent: qui si creano contratti nuovi. */
  @Input() soloPresentiInRentri = true

  readonly suggestions = signal<CerOption[]>([])
  selected: CerOption[] = []
  disabled = false

  private onChange: (value: string[]) => void = () => {}
  onTouched: () => void = () => {}

  constructor(private readonly cerService: CerService) {}

  cerca(event: AutoCompleteCompleteEvent): void {
    const query = (event.query || '').trim()
    if (!query) {
      this.suggestions.set([])
      return
    }
    this.cerService.searchCER(query, this.soloPresentiInRentri).subscribe({
      next: risultati => {
        const giaScelti = new Set(this.selected.map(s => s.code))
        this.suggestions.set(
          risultati.filter(r => !giaScelti.has(r.code)).map(r => this.toOption(r))
        )
      },
      error: () => this.suggestions.set([]),
    })
  }

  /** Un solo punto di uscita: copre sia l'aggiunta sia la rimozione di un token. */
  onSelezioneCambiata(valore: CerOption[]): void {
    this.selected = valore ?? []
    this.onChange(this.selected.map(o => o.code))
    this.onTouched()
  }

  // ─── ControlValueAccessor ─────────────────────────────────────────────────

  writeValue(value: string[] | null): void {
    const codici = value ?? []
    // Mostra subito i codici; le descrizioni si risolvono in modo best-effort.
    this.selected = codici.map(code => ({
      code,
      description: '',
      isPericoloso: false,
      label: code,
    }))
    codici.forEach(code => this.risolviCodice(code))
  }

  registerOnChange(fn: (value: string[]) => void): void {
    this.onChange = fn
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled
  }

  // ─── Helper ───────────────────────────────────────────────────────────────

  private risolviCodice(code: string): void {
    this.cerService.searchCER(code).subscribe({
      next: risultati => {
        const match = risultati.find(r => r.code === code)
        if (!match) return
        this.selected = this.selected.map(s => (s.code === code ? this.toOption(match) : s))
      },
      error: () => {
        /* resta il solo codice */
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
