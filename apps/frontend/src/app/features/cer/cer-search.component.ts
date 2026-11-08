import { Component, OnInit, Output, EventEmitter, Input } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import {
  AutoCompleteModule,
  AutoCompleteCompleteEvent,
  AutoCompleteSelectEvent,
} from 'primeng/autocomplete'
import { TableModule } from 'primeng/table'
import { CardModule } from 'primeng/card'
import { ButtonModule } from 'primeng/button'
import { InputTextModule } from 'primeng/inputtext'
import { DropdownModule } from 'primeng/dropdown'
import { CheckboxModule } from 'primeng/checkbox'
import { CerService } from './cer.service'
import { CER, CERSearchResult } from '../../shared/models/cer.model'

@Component({
  selector: 'app-cer-search',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AutoCompleteModule,
    TableModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    DropdownModule,
    CheckboxModule,
  ],
  template: `
    <div class="cer-search">
      <div *ngIf="!compactMode" class="page">
        <!-- Intestazione pagina -->
        <header class="page-header">
          <div class="page-header__titles">
            <h1 class="page-title">Ricerca codici CER</h1>
            <p class="page-subtitle">
              Catalogo Europeo dei Rifiuti: cerca per codice, descrizione o categoria
            </p>
          </div>
        </header>

        <!-- Barra filtri / ricerca -->
        <section class="surface-card filters" aria-label="Filtri di ricerca codici CER">
          <div class="filters__field filters__field--grow">
            <label for="cer-autocomplete" class="filters__label"
              >Cerca per codice o descrizione</label
            >
            <p-autoComplete
              inputId="cer-autocomplete"
              [(ngModel)]="selectedCER"
              [suggestions]="filteredCERs"
              (completeMethod)="searchCER($event)"
              field="description"
              [dropdown]="true"
              [minLength]="2"
              placeholder="es. 150101 o carta"
              ariaLabel="Cerca un codice CER per codice o descrizione"
              styleClass="w-full"
              inputStyleClass="w-full"
              (onSelect)="onCERSelect($event)"
            >
              <ng-template let-cer pTemplate="item">
                <div class="cer-suggestion">
                  <span
                    ><strong class="cell-mono">{{ cer.code }}</strong> — {{ cer.description }}</span
                  >
                  <span *ngIf="cer.isPericoloso" class="pillola-pericoloso">Pericoloso</span>
                </div>
              </ng-template>
            </p-autoComplete>
          </div>

          <div class="filters__field">
            <label for="cer-category" class="filters__label">Categoria</label>
            <p-dropdown
              inputId="cer-category"
              [options]="categoryOptions"
              [(ngModel)]="selectedCategory"
              placeholder="Tutte"
              [showClear]="true"
              (onChange)="onFilterChange()"
              ariaLabel="Filtra i codici CER per categoria"
              styleClass="w-full"
            />
          </div>

          <div class="filters__field filters__field--check">
            <div class="filters__checkbox">
              <p-checkbox
                [(ngModel)]="onlyPericolosi"
                [binary]="true"
                inputId="pericolosi"
                (onChange)="onFilterChange()"
              />
              <label for="pericolosi">Solo pericolosi</label>
            </div>
          </div>
        </section>

        <!-- Stato di errore -->
        <div *ngIf="error && !loading" class="surface-card" role="alert">
          <div class="empty-state">
            <i
              class="pi pi-exclamation-triangle empty-state__icon"
              style="color: var(--color-danger);"
              aria-hidden="true"
            ></i>
            <p class="empty-state__title">Impossibile caricare i codici CER</p>
            <p>Si è verificato un errore durante il recupero dei dati. Riprova.</p>
            <p-button label="Riprova" icon="pi pi-refresh" [outlined]="true" (onClick)="reload()" />
          </div>
        </div>

        <!-- Tabella CER -->
        <div *ngIf="!error" class="surface-card table-card">
          <p-table
            [styleClass]="
              'p-datatable-sm lista-telefono' + (cerList.length === 0 ? ' senza-righe' : '')
            "
            [value]="cerList"
            [loading]="loading"
            [paginator]="true"
            [alwaysShowPaginator]="false"
            [rows]="pageSize"
            [totalRecords]="totalRecords"
            [lazy]="true"
            (onLazyLoad)="loadCERList($event)"
            [rowHover]="true"
            selectionMode="single"
            [(selection)]="selectedCERFromTable"
            (onRowSelect)="onRowSelect($event)"
          >
            <ng-template pTemplate="caption">
              <span class="sr-only">Elenco dei codici del Catalogo Europeo dei Rifiuti</span>
            </ng-template>
            <ng-template pTemplate="header">
              <tr>
                <th scope="col" class="num-col" style="width: 9rem">Codice</th>
                <th scope="col">Descrizione</th>
                <th scope="col" class="num-col" style="width: 7rem">Categoria</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-cer>
              <tr [pSelectableRow]="cer">
                <td class="num-col">
                  <span class="cell-mono"
                    >{{ codiceSenzaAsterisco(cer.code)
                    }}<span
                      class="cer-segno"
                      [attr.aria-hidden]="cer.isPericoloso ? 'true' : null"
                      >{{ cer.isPericoloso ? '*' : '' }}</span
                    ></span
                  >
                </td>
                <td class="m2">
                  {{ cer.description }}
                  <span *ngIf="cer.isPericoloso" class="pillola-pericoloso">Pericoloso</span>
                </td>
                <td class="num-col m-hide">{{ cer.category }}</td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="3">
                  <div class="empty-state">
                    <i class="pi pi-search empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessun codice CER trovato</p>
                    <p>Modifica i filtri o prova un altro termine di ricerca.</p>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </div>

      <!-- Compact Mode (for use in forms) -->
      <div *ngIf="compactMode" class="compact-search">
        <label *ngIf="label" for="cer-compact" class="filters__label">{{ label }}</label>
        <p-autoComplete
          inputId="cer-compact"
          [(ngModel)]="selectedCER"
          [suggestions]="filteredCERs"
          (completeMethod)="searchCER($event)"
          field="description"
          [dropdown]="true"
          [minLength]="2"
          [placeholder]="placeholder"
          [ariaLabel]="label"
          styleClass="w-full"
          inputStyleClass="w-full"
          (onSelect)="onCERSelect($event)"
          [required]="required"
        >
          <ng-template let-cer pTemplate="item">
            <div class="cer-suggestion">
              <span
                ><strong class="cell-mono">{{ cer.code }}</strong> — {{ cer.description }}</span
              >
              <span *ngIf="cer.isPericoloso" class="pillola-pericoloso">Pericoloso</span>
            </div>
          </ng-template>
        </p-autoComplete>
      </div>
    </div>
  `,
  styles: [
    `
      .filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-base);
        align-items: flex-end;
        margin-bottom: var(--spacing-lg);
      }
      .filters__field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
        flex: 1 1 220px;
        min-width: 0;
      }
      .filters__field--grow {
        flex: 2 1 320px;
      }
      .filters__field--check {
        flex: 0 1 auto;
        justify-content: flex-end;
      }
      .filters__label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--text-secondary);
      }
      .filters__checkbox {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        min-height: var(--touch-target-min);
      }
      .filters__checkbox label {
        margin: 0;
        cursor: pointer;
      }

      .table-card {
        padding: 0;
        overflow: hidden;
      }

      .cell-mono {
        font-family: var(--font-family-mono);
        font-weight: var(--font-weight-medium);
        color: var(--text-primary);
      }

      /* Il segno del pericoloso: asterisco del codice in coda, con lo spazio riservato anche
         ai non pericolosi, cosi' le cifre restano incolonnate a destra. */
      .cer-segno {
        display: inline-block;
        width: 1ch;
        text-align: left;
        color: var(--stato-err-segno);
      }

      /* Pillola «Pericoloso»: tinta err tenue, inchiostro dello stesso tono, 22 px. */
      .pillola-pericoloso {
        display: inline-flex;
        align-items: center;
        flex: none;
        height: 22px;
        margin-left: var(--spacing-sm);
        padding: 0 8px;
        border-radius: var(--radius-sm);
        background: var(--stato-err-bg);
        color: var(--stato-err-ink);
        font-size: 12px;
        font-weight: var(--font-weight-medium);
        white-space: nowrap;
        vertical-align: middle;
      }

      .cer-suggestion {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--spacing-sm);
        width: 100%;
      }

      @media (max-width: 576px) {
        .filters__field,
        .filters__field--grow {
          flex: 1 1 100%;
        }
      }

      :host ::ng-deep {
        .p-autocomplete {
          width: 100%;
        }
        .p-autocomplete-input {
          width: 100%;
        }
        .p-datatable .p-datatable-tbody > tr.p-selectable-row:hover {
          cursor: pointer;
        }
        .p-datatable .p-datatable-tbody > tr > td.num-col .cell-mono {
          white-space: nowrap;
        }
      }

      /* Telefono: righe a due linee (codice sopra, descrizione sotto), il codice a sinistra. */
      @media (max-width: 640px) {
        :host ::ng-deep .p-datatable.lista-telefono td.num-col {
          text-align: left;
        }
        .pillola-pericoloso {
          margin-left: 0;
          margin-top: var(--spacing-xs);
          display: flex;
          width: fit-content;
        }
      }
    `,
  ],
})
export class CerSearchComponent implements OnInit {
  @Input() compactMode = false
  @Input() label = 'Codice CER'
  @Input() placeholder = 'Cerca codice CER...'
  @Input() required = false
  @Output() cerSelected = new EventEmitter<CERSearchResult>()

  cerList: CER[] = []
  filteredCERs: CERSearchResult[] = []
  selectedCER: CERSearchResult | null = null
  selectedCERFromTable: CER | null = null
  selectedCategory: string | null = null
  onlyPericolosi = false

  loading = false
  error = false
  totalRecords = 0
  pageSize = 20
  currentPage = 1
  private lastLoadEvent: { first: number; rows: number } = { first: 0, rows: 20 }

  categoryOptions = [
    { label: 'Carta e Cartone', value: 'CARTA' },
    { label: 'Plastica', value: 'PLASTICA' },
    { label: 'Vetro', value: 'VETRO' },
    { label: 'Metalli', value: 'METALLI' },
    { label: 'Legno', value: 'LEGNO' },
    { label: 'Tessili', value: 'TESSILI' },
    { label: 'Rifiuti Urbani', value: 'URBANI' },
    { label: 'Costruzione e Demolizione', value: 'COSTRUZIONE' },
    { label: 'Rifiuti Chimici', value: 'CHIMICI' },
    { label: 'Rifiuti Sanitari', value: 'SANITARI' },
  ]

  constructor(private cerService: CerService) {}

  /** Il codice senza l'asterisco finale: il segno si disegna a parte (`cer-segno`). */
  codiceSenzaAsterisco(code: string): string {
    return code.replace(/\*+$/, '')
  }

  ngOnInit(): void {
    if (!this.compactMode) {
      this.loadCERList({ first: 0, rows: this.pageSize })
    }
  }

  loadCERList(event: { first?: number | null; rows?: number | null }): void {
    this.loading = true
    this.error = false
    const first = event.first ?? 0
    const rows = event.rows ?? this.pageSize
    this.lastLoadEvent = { first, rows }
    const page = Math.floor(first / rows) + 1
    this.currentPage = page

    let observable
    if (this.onlyPericolosi) {
      observable = this.cerService.getCERPericolosi(page, rows)
    } else if (this.selectedCategory) {
      observable = this.cerService.getCERByCategory(this.selectedCategory, page, rows)
    } else {
      observable = this.cerService.getCERList(page, rows)
    }

    observable.subscribe({
      next: response => {
        this.cerList = response.items
        this.totalRecords = response.total
        this.loading = false
      },
      error: () => {
        this.loading = false
        this.error = true
      },
    })
  }

  reload(): void {
    this.loadCERList(this.lastLoadEvent)
  }

  searchCER(event: AutoCompleteCompleteEvent): void {
    const query = event.query
    if (query.length < 2) {
      this.filteredCERs = []
      return
    }

    this.cerService.searchCER(query).subscribe({
      next: results => {
        this.filteredCERs = results
      },
      error: () => {
        this.filteredCERs = []
      },
    })
  }

  onCERSelect(event: AutoCompleteSelectEvent): void {
    this.cerSelected.emit(event.value)
  }

  onRowSelect(event: { data?: CER | CER[] }): void {
    const cer = event.data as CER
    const searchResult: CERSearchResult = {
      code: cer.code,
      description: cer.description,
      isPericoloso: cer.isPericoloso,
    }
    this.cerSelected.emit(searchResult)
  }

  onFilterChange(): void {
    this.loadCERList({ first: 0, rows: this.pageSize })
  }
}
