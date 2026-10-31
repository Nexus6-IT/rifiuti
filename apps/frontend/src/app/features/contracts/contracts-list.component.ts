import { Component, OnInit, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { TableModule } from 'primeng/table'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { ToastService } from '../../core/services/toast.service'
import { ContractsService, Contract, ContractStatus, ContractType } from './contracts.service'
import { ContractCreateDialogComponent } from './contract-create-dialog.component'
import { etichettaIdentificativo } from '../registry/identificativo-fiscale'
import { SelectOption, STATUS_LABELS, TYPE_LABELS } from './contract-vocabulary'

/** Transizioni di stato ammesse (mirror di ALLOWED_TRANSITIONS del backend). */
const ALLOWED_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'TERMINATED'],
  PENDING_APPROVAL: ['ACTIVE', 'DRAFT', 'TERMINATED'],
  ACTIVE: ['SUSPENDED', 'EXPIRED', 'TERMINATED'],
  SUSPENDED: ['ACTIVE', 'TERMINATED'],
  EXPIRED: [],
  TERMINATED: [],
}

const STATUS_SEVERITY: Record<
  ContractStatus,
  'success' | 'info' | 'warning' | 'danger' | 'secondary'
> = {
  DRAFT: 'secondary',
  PENDING_APPROVAL: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  EXPIRED: 'danger',
  TERMINATED: 'danger',
}

@Component({
  selector: 'app-contracts-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    TagModule,
    DialogModule,
    DropdownModule,
    ProgressSpinnerModule,
    ContractCreateDialogComponent,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Contratti</h1>
          <p class="page-subtitle">
            Contratti produttore ↔ controparte: trasporto, smaltimento e servizi
          </p>
        </div>
        <div class="page-actions">
          <p-button
            label="Nuovo contratto"
            icon="pi pi-plus"
            (onClick)="displayCreate = true"
            ariaLabel="Crea un nuovo contratto"
          />
        </div>
      </header>

      <!-- Filtro per stato -->
      <section class="surface-card mb-4" aria-label="Filtro contratti">
        <div class="filter-row">
          <div class="filter-row__field">
            <label for="contract-status-filter" class="block mb-2">Stato</label>
            <p-dropdown
              inputId="contract-status-filter"
              [options]="statusFilterOptions"
              [(ngModel)]="statusFilter"
              optionLabel="label"
              optionValue="value"
              [showClear]="true"
              placeholder="Tutti"
              styleClass="w-full"
              ariaLabel="Filtra contratti per stato"
              (onChange)="loadContracts()"
              (onClear)="loadContracts()"
            ></p-dropdown>
          </div>
          <p-button
            label="Aggiorna"
            icon="pi pi-refresh"
            [outlined]="true"
            (onClick)="loadContracts()"
            ariaLabel="Aggiorna l'elenco dei contratti"
          />
        </div>
      </section>

      <!-- Stato error -->
      <section *ngIf="error()" class="surface-card">
        <div class="empty-state">
          <i
            class="pi pi-exclamation-triangle empty-state__icon empty-state__icon--danger"
            aria-hidden="true"
          ></i>
          <span class="empty-state__title">Impossibile caricare i contratti</span>
          <p>Si è verificato un errore. Riprova.</p>
          <p-button
            label="Riprova"
            icon="pi pi-refresh"
            [outlined]="true"
            (onClick)="loadContracts()"
          />
        </div>
      </section>

      <!-- Tabella -->
      <section *ngIf="!error()" class="surface-card">
        <div class="table-responsive">
          <p-table
            [value]="contracts()"
            [loading]="loading()"
            [paginator]="contracts().length > 10"
            [rows]="10"
            styleClass="p-datatable-sm"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Numero</th>
                <th scope="col">Controparte</th>
                <th scope="col">Tipo</th>
                <th scope="col">Stato</th>
                <th scope="col">Periodo</th>
                <th scope="col" style="width: 120px">Azioni</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-c>
              <tr>
                <td>
                  <strong>{{ c.contractNumber }}</strong>
                </td>
                <td>
                  <span class="controparte">
                    <span class="controparte__nome">{{ counterpartyLabel(c) }}</span>
                    <span
                      *ngIf="c.counterparty && identificativo(c.counterparty)"
                      class="controparte__piva"
                    >
                      {{ identificativo(c.counterparty) }}
                    </span>
                  </span>
                </td>
                <td>{{ typeLabel(c.contractType) }}</td>
                <td>
                  <p-tag
                    [value]="statusLabel(c.status)"
                    [severity]="statusSeverity(c.status)"
                  ></p-tag>
                </td>
                <td>{{ periodLabel(c) }}</td>
                <td>
                  <p-button
                    icon="pi pi-sync"
                    [rounded]="true"
                    [text]="true"
                    (onClick)="openStatusDialog(c)"
                    [disabled]="!nextStatuses(c.status).length"
                    pTooltip="Cambia stato"
                    [ariaLabel]="'Cambia stato del contratto ' + c.contractNumber"
                  />
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="6">
                  <div class="empty-state">
                    <i class="pi pi-file empty-state__icon" aria-hidden="true"></i>
                    <span class="empty-state__title">Nessun contratto</span>
                    <p>Non risultano contratti per il filtro selezionato.</p>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>

      <app-contract-create-dialog
        [(visible)]="displayCreate"
        (creato)="loadContracts()"
      ></app-contract-create-dialog>

      <!-- Dialog: cambio stato -->
      <p-dialog
        [(visible)]="displayStatus"
        [modal]="true"
        [style]="{ width: '420px' }"
        [breakpoints]="{ '576px': '95vw' }"
        header="Cambia stato contratto"
      >
        <div *ngIf="selectedContract() as sc">
          <p class="mb-3">
            Contratto <strong>{{ sc.contractNumber }}</strong> — stato attuale:
            <p-tag [value]="statusLabel(sc.status)" [severity]="statusSeverity(sc.status)"></p-tag>
          </p>
          <label for="c-target-status" class="block mb-2">Nuovo stato</label>
          <p-dropdown
            inputId="c-target-status"
            [options]="targetStatusOptions()"
            [(ngModel)]="targetStatus"
            optionLabel="label"
            optionValue="value"
            placeholder="Seleziona"
            styleClass="w-full"
            appendTo="body"
          ></p-dropdown>
        </div>
        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" (onClick)="displayStatus = false" />
          <p-button
            label="Conferma"
            icon="pi pi-check"
            [loading]="changingStatus()"
            [disabled]="!targetStatus"
            (onClick)="confirmStatusChange()"
          />
        </ng-template>
      </p-dialog>
    </div>
  `,
  styles: [
    `
      .empty-state__icon--danger {
        color: var(--color-danger);
      }
      /* Barra filtri: dropdown stato + Aggiorna allineati e spaziati a 12px */
      .filter-row {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: var(--spacing-md);
      }
      .filter-row__field {
        flex: 1 1 220px;
        min-width: 200px;
        max-width: 320px;
      }
      .controparte {
        display: flex;
        flex-direction: column;
        line-height: 1.3;
      }
      .controparte__piva {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        font-variant-numeric: tabular-nums;
      }
      .mb-4 {
        margin-bottom: var(--spacing-xl);
      }
      .mb-3 {
        margin-bottom: var(--spacing-base);
      }
      .mb-2 {
        margin-bottom: var(--spacing-sm);
      }
    `,
  ],
})
export class ContractsListComponent implements OnInit {
  private readonly contractsService = inject(ContractsService)
  private readonly toast = inject(ToastService)

  /** "P.IVA …" o "C.F. …" della controparte (un privato non ha la P.IVA). */
  identificativo(p: { partitaIVA: string | null; codiceFiscale?: string | null }): string {
    return etichettaIdentificativo(p.partitaIVA, p.codiceFiscale)
  }

  readonly contracts = signal<Contract[]>([])
  readonly loading = signal(false)
  readonly error = signal(false)
  readonly changingStatus = signal(false)
  readonly selectedContract = signal<Contract | null>(null)

  statusFilter: ContractStatus | null = null

  displayCreate = false
  displayStatus = false
  targetStatus: ContractStatus | null = null

  readonly statusFilterOptions: SelectOption<ContractStatus>[] = (
    Object.keys(STATUS_LABELS) as ContractStatus[]
  ).map(s => ({ label: STATUS_LABELS[s], value: s }))

  ngOnInit(): void {
    this.loadContracts()
  }

  loadContracts(): void {
    this.loading.set(true)
    this.error.set(false)
    this.contractsService.list(this.statusFilter ?? undefined).subscribe({
      next: rows => {
        this.contracts.set(rows ?? [])
        this.loading.set(false)
      },
      error: () => {
        this.loading.set(false)
        this.error.set(true)
        this.toast.error('Errore nel caricamento dei contratti')
      },
    })
  }

  // --- Etichette / formattazione ---
  statusLabel(s: ContractStatus): string {
    return STATUS_LABELS[s] ?? s
  }
  statusSeverity(s: ContractStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    return STATUS_SEVERITY[s] ?? 'info'
  }
  typeLabel(t: ContractType): string {
    return TYPE_LABELS[t] ?? t
  }

  /**
   * Ragione sociale della controparte. I contratti il cui id non corrisponde
   * più a un'anagrafica mostrano un trattino: meglio un dato dichiarato
   * mancante che un id interno buttato in tabella.
   */
  counterpartyLabel(c: Contract): string {
    return c.counterparty?.ragioneSociale ?? '—'
  }

  nextStatuses(s: ContractStatus): ContractStatus[] {
    return ALLOWED_TRANSITIONS[s] ?? []
  }

  periodLabel(c: Contract): string {
    const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('it-IT') : null)
    const start = fmt(c.startDate)
    const end = fmt(c.endDate)
    if (start && end) return `${start} → ${end}`
    if (start) return `dal ${start}`
    return '—'
  }

  // --- Cambio stato ---
  openStatusDialog(c: Contract): void {
    this.selectedContract.set(c)
    this.targetStatus = null
    this.displayStatus = true
  }

  targetStatusOptions(): SelectOption<ContractStatus>[] {
    const c = this.selectedContract()
    if (!c) return []
    return this.nextStatuses(c.status).map(s => ({ label: STATUS_LABELS[s], value: s }))
  }

  confirmStatusChange(): void {
    const c = this.selectedContract()
    if (!c || !this.targetStatus) return
    this.changingStatus.set(true)
    this.contractsService.updateStatus(c.id, this.targetStatus).subscribe({
      next: () => {
        this.changingStatus.set(false)
        this.displayStatus = false
        this.toast.success('Stato del contratto aggiornato')
        this.loadContracts()
      },
      error: () => {
        this.changingStatus.set(false)
        this.toast.error('Transizione di stato non ammessa o errore di aggiornamento')
      },
    })
  }
}
