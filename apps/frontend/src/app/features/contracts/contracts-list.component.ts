import { Component, OnInit, computed, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { TableModule } from 'primeng/table'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { DialogModule } from 'primeng/dialog'
import { DropdownModule } from 'primeng/dropdown'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { ConfirmDialogModule } from 'primeng/confirmdialog'
import { ConfirmationService } from 'primeng/api'
import { HttpErrorResponse } from '@angular/common/http'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { AzioneRiga, AzioniRigaComponent } from '../../shared/components/azioni-riga.component'
import { colonneConDati } from '../../shared/utils/colonne-visibili'
import {
  ContractsService,
  Contract,
  ContractStatus,
  ContractType,
  messaggioDaErrore,
} from './contracts.service'
import { puoGestireContratti } from './permessi-contratti'
import { ContractCreateDialogComponent } from './contract-create-dialog.component'
import { separaIdentificativo } from '../registry/identificativo-fiscale'
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

interface AzioniRiga {
  principale: AzioneRiga | null
  altre: AzioneRiga[]
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
    ConfirmDialogModule,
    ContractCreateDialogComponent,
    AzioniRigaComponent,
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
            *ngIf="puoGestire()"
            label="Nuovo contratto"
            icon="pi pi-plus"
            styleClass="wf-primario"
            (onClick)="apriCreazione()"
            ariaLabel="Crea un nuovo contratto"
          />
        </div>
      </header>

      <!-- Filtro per stato -->
      <div class="barra-filtri" role="group" aria-label="Filtro contratti">
        <label for="contract-status-filter" class="filtro-etichetta">Stato</label>
        <p-dropdown
          inputId="contract-status-filter"
          [options]="statusFilterOptions"
          [(ngModel)]="statusFilter"
          optionLabel="label"
          optionValue="value"
          [showClear]="true"
          placeholder="Tutti"
          styleClass="filtro-stato"
          ariaLabel="Filtra contratti per stato"
          (onChange)="loadContracts()"
          (onClear)="loadContracts()"
        ></p-dropdown>
      </div>

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
      <p-table
        *ngIf="!error()"
        [value]="contracts()"
        [loading]="loading()"
        [paginator]="true"
        [alwaysShowPaginator]="false"
        [rows]="10"
        styleClass="p-datatable-sm lista-telefono"
      >
        <ng-template pTemplate="header">
          <tr>
            <th scope="col">Numero</th>
            <th scope="col">Controparte</th>
            <th scope="col">Tipo</th>
            <th scope="col">Stato</th>
            <th scope="col" *ngIf="visibili().has('periodo')">Periodo</th>
            <th scope="col" class="azioni-col" *ngIf="puoGestire()">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr [attr.data-testid]="'contratti-riga-' + c.id">
            <td class="nw">
              <strong class="mono-numero">{{ c.contractNumber }}</strong>
              <p-tag
                class="solo-tel"
                [value]="statusLabel(c.status)"
                [severity]="statusSeverity(c.status)"
              ></p-tag>
            </td>
            <td class="m2">
              <span class="controparte">
                <span class="controparte__nome">{{ counterpartyLabel(c) }}</span>
                <span
                  *ngIf="c.counterparty && identificativo(c.counterparty).numero"
                  class="controparte__piva"
                >
                  {{ identificativo(c.counterparty).prefisso }}
                  <span class="mono">{{ identificativo(c.counterparty).numero }}</span>
                </span>
              </span>
            </td>
            <td class="m-hide nw">{{ typeLabel(c.contractType) }}</td>
            <td class="m-hide nw">
              <p-tag [value]="statusLabel(c.status)" [severity]="statusSeverity(c.status)"></p-tag>
            </td>
            <td class="m-hide nw" *ngIf="visibili().has('periodo')">{{ periodLabel(c) }}</td>
            <td class="azioni-col" *ngIf="puoGestire()">
              <app-azioni-riga
                [nome]="c.contractNumber"
                [principale]="azioniDi(c).principale"
                [altre]="azioniDi(c).altre"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="colonneTotali()">
              <div class="empty-state">
                <i class="pi pi-file empty-state__icon" aria-hidden="true"></i>
                <span class="empty-state__title">Nessun contratto</span>
                <p>
                  {{
                    statusFilter
                      ? 'Non risultano contratti per il filtro selezionato.'
                      : 'Non ci sono ancora contratti.'
                  }}
                </p>
              </div>
            </td>
          </tr>
        </ng-template>
      </p-table>

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
          <p
            *ngIf="statoTerminale()"
            class="avviso-terminale"
            role="alert"
            data-testid="avviso-terminale"
          >
            <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
            Non si potrà tornare indietro: da «{{ statusLabel(targetStatus!) }}» il contratto non si
            può più modificare né cambiare di stato.
          </p>
        </div>
        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" (onClick)="displayStatus = false" />
          <p-button
            label="Conferma"
            icon="pi pi-check"
            [severity]="statoTerminale() ? 'danger' : undefined"
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
      .filtro-etichetta {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      :host ::ng-deep .filtro-stato {
        width: 14rem;
      }
      .mono,
      .mono-numero {
        font-family: var(--font-family-mono);
      }
      .controparte {
        display: flex;
        flex-direction: column;
        line-height: 1.3;
        overflow-wrap: anywhere;
      }
      .controparte__piva {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        font-variant-numeric: tabular-nums;
      }
      .avviso-terminale {
        margin-top: var(--spacing-md);
        color: var(--color-danger);
        font-size: var(--font-size-sm);
      }
      .mb-3 {
        margin-bottom: var(--spacing-base);
      }
      .mb-2 {
        margin-bottom: var(--spacing-sm);
      }
      .nw {
        white-space: nowrap;
      }
      .solo-tel {
        display: none;
      }
      @media (max-width: 640px) {
        .solo-tel {
          display: inline-block;
          margin-left: var(--spacing-sm);
        }
        :host ::ng-deep .filtro-stato {
          width: 100%;
        }
        .controparte {
          flex-direction: row;
          flex-wrap: wrap;
          gap: 0 var(--spacing-sm);
        }
      }
    `,
  ],
})
export class ContractsListComponent implements OnInit {
  private readonly contractsService = inject(ContractsService)
  private readonly toast = inject(ToastService)
  private readonly confirmation = inject(ConfirmationService)
  private readonly auth = inject(AuthService)

  /** Chi non gestisce i contratti (VIEWER) legge l'elenco: niente Nuovo, niente colonna Azioni. */
  readonly puoGestire = computed(() => puoGestireContratti(this.auth.currentUser()?.role))

  /** «P.IVA» o «C.F.» in caratteri normali e il numero (l'unica parte in mono). */
  identificativo(p: { partitaIVA: string | null; codiceFiscale?: string | null }): {
    prefisso: string
    numero: string
  } {
    return separaIdentificativo(p.partitaIVA, p.codiceFiscale)
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

  /** Colonne facoltative con almeno un dato nella pagina: le altre non si disegnano. */
  readonly visibili = computed(() =>
    colonneConDati(this.contracts(), { periodo: c => c.startDate })
  )
  /** Colonne del p-table (per la riga dello stato vuoto). */
  readonly colonneTotali = computed(
    () => 4 + (this.visibili().has('periodo') ? 1 : 0) + (this.puoGestire() ? 1 : 0)
  )

  /**
   * Azioni di ogni riga, ricalcolate solo quando cambiano i contratti o lo stato di una chiamata in
   * corso: `app-azioni-riga` ricostruirebbe il menu a ogni nuovo array.
   */
  private readonly azioniPerRiga = computed(() => {
    const apertura = this.apriInCorso()
    const eliminazione = this.eliminando()
    if (!this.puoGestire()) return new Map<string, AzioniRiga>()
    return new Map(
      this.contracts().map(c => [c.id, this.costruisciAzioni(c, apertura, eliminazione)] as const)
    )
  })

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

  azioniDi(c: Contract): AzioniRiga {
    return this.azioniPerRiga().get(c.id) ?? { principale: null, altre: [] }
  }

  private costruisciAzioni(
    c: Contract,
    apertura: string | null,
    eliminazione: string | null
  ): AzioniRiga {
    const modificaOff = !c.modificabili?.length || apertura === c.id
    const altre: AzioneRiga[] = [
      {
        etichetta: 'Cambia stato',
        icona: 'pi pi-sync',
        disabilitata: !this.nextStatuses(c.status).length,
        motivo: 'Da questo stato il contratto non cambia più stato',
        esegui: () => this.openStatusDialog(c),
      },
    ]
    if (c.eliminabile) {
      altre.push({
        etichetta: 'Elimina',
        icona: 'pi pi-trash',
        pericolosa: true,
        disabilitata: eliminazione === c.id,
        esegui: () => this.chiediEliminazione(c),
      })
    }
    return {
      principale: {
        etichetta: `Modifica il contratto ${c.contractNumber}`,
        icona: 'pi pi-pencil',
        disabilitata: modificaOff,
        motivo: modificaOff && c.modificabili?.length ? undefined : this.tooltipModifica(c),
        esegui: () => this.apriModifica(c),
      },
      altre,
    }
  }

  /** Risolto e Scaduto sono stati finali: dopo non si torna indietro. */
  statoTerminale(): boolean {
    return this.targetStatus === 'TERMINATED' || this.targetStatus === 'EXPIRED'
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
      error: err => {
        this.changingStatus.set(false)
        this.toast.error(
          messaggioDaErrore(err, 'Transizione di stato non ammessa o errore di aggiornamento')
        )
        // Contratto cambiato nel frattempo (409) o sparito (404): i dati in lista sono vecchi
        const stato = err instanceof HttpErrorResponse ? err.status : 0
        if (stato === 409 || stato === 404) this.loadContracts()
      },
    })
  }
}
