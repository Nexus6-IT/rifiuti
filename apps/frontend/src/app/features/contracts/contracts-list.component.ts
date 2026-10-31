import { Component, OnInit, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { TableModule } from 'primeng/table'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { TooltipModule } from 'primeng/tooltip'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService } from 'primeng/api'
import { HttpErrorResponse } from '@angular/common/http'
import { ToastService } from '../../core/services/toast.service'
import {
  ContractsService,
  Contract,
  ContractStatus,
  ContractType,
  messaggioDaErrore,
} from './contracts.service'
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
    TooltipModule,
    ConfirmDialogModule,
    ContractCreateDialogComponent,
  ],
  providers: [ConfirmationService],
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
            (onClick)="apriCreazione()"
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
                <th scope="col" style="width: 170px">Azioni</th>
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
                <td class="azioni">
                  <span [pTooltip]="tooltipModifica(c)" tooltipPosition="top">
                    <p-button
                      icon="pi pi-pencil"
                      [rounded]="true"
                      [text]="true"
                      (onClick)="apriModifica(c)"
                      [disabled]="modificaDisabilitata(c)"
                      [ariaLabel]="etichettaModifica(c)"
                    />
                  </span>
                  <span pTooltip="Cambia stato" tooltipPosition="top">
                    <p-button
                      icon="pi pi-sync"
                      [rounded]="true"
                      [text]="true"
                      (onClick)="openStatusDialog(c)"
                      [disabled]="!nextStatuses(c.status).length"
                      [ariaLabel]="'Cambia stato del contratto ' + c.contractNumber"
                    />
                  </span>
                  <span *ngIf="c.eliminabile" pTooltip="Elimina" tooltipPosition="top">
                    <p-button
                      icon="pi pi-trash"
                      severity="danger"
                      [rounded]="true"
                      [text]="true"
                      (onClick)="chiediEliminazione(c)"
                      [disabled]="eliminando() === c.id"
                      [ariaLabel]="'Elimina il contratto ' + c.contractNumber"
                    />
                  </span>
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
        [contratto]="contrattoInModifica"
        (creato)="loadContracts()"
        (modificato)="loadContracts()"
      ></app-contract-create-dialog>

      <p-confirmDialog />

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
      .azioni {
        white-space: nowrap;
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
  private readonly confirmation = inject(ConfirmationService)

  /** "P.IVA …" o "C.F. …" della controparte (un privato non ha la P.IVA). */
  identificativo(p: { partitaIVA: string | null; codiceFiscale?: string | null }): string {
    return etichettaIdentificativo(p.partitaIVA, p.codiceFiscale)
  }

  readonly contracts = signal<Contract[]>([])
  readonly loading = signal(false)
  readonly error = signal(false)
  readonly changingStatus = signal(false)
  readonly selectedContract = signal<Contract | null>(null)
  /** Id del contratto di cui si sta rileggendo il dettaglio per la modifica (niente doppio click). */
  readonly apriInCorso = signal<string | null>(null)
  /** Id del contratto in eliminazione (il cestino resta disabilitato durante la chiamata). */
  readonly eliminando = signal<string | null>(null)

  statusFilter: ContractStatus | null = null

  displayCreate = false
  /**
   * Contratto aperto nel dialog (null = creazione). Resta lo stesso oggetto finche' il dialog e'
   * aperto: il dialog riallinea il form se cambia id, quindi dopo un ricaricamento della lista
   * non va sostituito con una copia.
   */
  contrattoInModifica: Contract | null = null
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

  // --- Creazione, modifica, eliminazione ---
  apriCreazione(): void {
    this.contrattoInModifica = null
    this.displayCreate = true
  }

  /** Motivo (dal solo stato) per cui Modifica e' disabilitato; "Modifica" se abilitato. */
  tooltipModifica(c: Contract): string {
    if (c.modificabili?.length) return 'Modifica'
    if (c.status === 'PENDING_APPROVAL') return 'Riporta il contratto in bozza per modificarlo'
    if (c.status === 'EXPIRED' || c.status === 'TERMINATED') {
      return 'Un contratto scaduto o cessato non si modifica'
    }
    return 'Questo contratto non si può modificare'
  }

  /** Disabilitato se il backend non indica campi modificabili o se la lettura e' in corso. */
  modificaDisabilitata(c: Contract): boolean {
    return !c.modificabili?.length || this.apriInCorso() === c.id
  }

  /**
   * Etichetta accessibile: se il pulsante e' disabilitato per lo stato, il motivo e' nell'etichetta
   * (tastiera e screen reader non vedono il tooltip di un pulsante disabilitato).
   */
  etichettaModifica(c: Contract): string {
    const base = `Modifica il contratto ${c.contractNumber}`
    return c.modificabili?.length ? base : `${base}: ${this.tooltipModifica(c)}`
  }

  /** Rilegge il contratto (versione e campi modificabili aggiornati) prima di aprire il dialog. */
  apriModifica(c: Contract): void {
    if (this.apriInCorso() !== null) return
    this.apriInCorso.set(c.id)
    this.contractsService.getById(c.id).subscribe({
      next: fresco => {
        this.apriInCorso.set(null)
        if (!fresco.modificabili?.length) {
          this.toast.warn('Il contratto non è più modificabile')
          this.loadContracts()
          return
        }
        this.contrattoInModifica = fresco
        this.displayCreate = true
      },
      error: err => {
        this.apriInCorso.set(null)
        this.toast.error(messaggioDaErrore(err, 'Errore nel caricamento del contratto'))
        if (err instanceof HttpErrorResponse && err.status === 404) this.loadContracts()
      },
    })
  }

  chiediEliminazione(c: Contract): void {
    this.confirmation.confirm({
      header: 'Elimina contratto',
      message: `Eliminare il contratto ${c.contractNumber}? Il contratto non comparirà più nell'elenco; il numero resta riservato.`,
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Elimina',
      rejectLabel: 'Annulla',
      acceptButtonStyleClass: 'p-button-danger',
      defaultFocus: 'reject',
      accept: () => this.elimina(c),
    })
  }

  private elimina(c: Contract): void {
    if (this.eliminando() !== null) return
    this.eliminando.set(c.id)
    this.contractsService.elimina(c.id, c.versione).subscribe({
      next: () => {
        this.eliminando.set(null)
        this.toast.success('Contratto eliminato')
        this.loadContracts()
      },
      error: err => {
        this.eliminando.set(null)
        this.toast.error(messaggioDaErrore(err, "Errore nell'eliminazione del contratto"))
        // Versione vecchia (409) o contratto gia' sparito (404): i dati in lista sono vecchi
        const stato = err instanceof HttpErrorResponse ? err.status : 0
        if (stato === 409 || stato === 404) this.loadContracts()
      },
    })
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
