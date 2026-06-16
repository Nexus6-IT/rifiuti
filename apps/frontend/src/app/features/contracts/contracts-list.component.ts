import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { CalendarModule } from 'primeng/calendar';
import { CheckboxModule } from 'primeng/checkbox';
import { ChipsModule } from 'primeng/chips';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ToastService } from '../../core/services/toast.service';
import {
  ContractsService,
  Contract,
  ContractStatus,
  ContractType,
  CounterpartyType,
  PricingModel,
  CreateContractDto,
} from './contracts.service';

interface SelectOption<T> {
  label: string;
  value: T;
}

/** Transizioni di stato ammesse (mirror di ALLOWED_TRANSITIONS del backend). */
const ALLOWED_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'TERMINATED'],
  PENDING_APPROVAL: ['ACTIVE', 'DRAFT', 'TERMINATED'],
  ACTIVE: ['SUSPENDED', 'EXPIRED', 'TERMINATED'],
  SUSPENDED: ['ACTIVE', 'TERMINATED'],
  EXPIRED: [],
  TERMINATED: [],
};

const STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: 'Bozza',
  PENDING_APPROVAL: 'In approvazione',
  ACTIVE: 'Attivo',
  SUSPENDED: 'Sospeso',
  EXPIRED: 'Scaduto',
  TERMINATED: 'Risolto',
};

const STATUS_SEVERITY: Record<ContractStatus, 'success' | 'info' | 'warning' | 'danger' | 'secondary'> = {
  DRAFT: 'secondary',
  PENDING_APPROVAL: 'warning',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  EXPIRED: 'danger',
  TERMINATED: 'danger',
};

const TYPE_LABELS: Record<ContractType, string> = {
  WASTE_DISPOSAL: 'Smaltimento',
  WASTE_TRANSPORT: 'Trasporto',
  FULL_SERVICE: 'Servizio completo',
  FRAMEWORK: 'Accordo quadro',
};

const COUNTERPARTY_LABELS: Record<CounterpartyType, string> = {
  TRANSPORTER: 'Trasportatore',
  DISPOSER: 'Destinatario',
  BROKER: 'Intermediario',
};

const PRICING_LABELS: Record<PricingModel, string> = {
  FLAT_RATE: 'Tariffa fissa',
  PAY_PER_LIFT: 'A svuotamento',
  PAY_BY_WEIGHT: 'A peso',
  PAY_BY_VOLUME: 'A volume',
  ZONE_BASED: 'Per zona',
  TIERED_VOLUME: 'Volume a scaglioni',
  MINIMUM_GUARANTEE: 'Garanzia minima',
  HYBRID: 'Ibrido',
};

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
    InputTextModule,
    InputNumberModule,
    InputTextareaModule,
    CalendarModule,
    CheckboxModule,
    ChipsModule,
    ProgressSpinnerModule,
  ],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Contratti</h1>
          <p class="page-subtitle">Contratti produttore ↔ controparte: trasporto, smaltimento e servizi</p>
        </div>
        <div class="page-actions">
          <p-button label="Nuovo contratto" icon="pi pi-plus" (onClick)="openCreateDialog()" ariaLabel="Crea un nuovo contratto" />
        </div>
      </header>

      <!-- Filtro per stato -->
      <section class="surface-card mb-4" aria-label="Filtro contratti">
        <div class="grid formgrid" style="align-items: end;">
          <div class="field col-12 md:col-5">
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
          <div class="field col-12 md:col-3 flex align-items-end">
            <p-button
              label="Aggiorna"
              icon="pi pi-refresh"
              [outlined]="true"
              (onClick)="loadContracts()"
              ariaLabel="Aggiorna l'elenco dei contratti"
            />
          </div>
        </div>
      </section>

      <!-- Stato error -->
      <section *ngIf="error()" class="surface-card">
        <div class="empty-state">
          <i class="pi pi-exclamation-triangle empty-state__icon empty-state__icon--danger" aria-hidden="true"></i>
          <span class="empty-state__title">Impossibile caricare i contratti</span>
          <p>Si è verificato un errore. Riprova.</p>
          <p-button label="Riprova" icon="pi pi-refresh" [outlined]="true" (onClick)="loadContracts()" />
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
                <td><strong>{{ c.contractNumber }}</strong></td>
                <td>{{ counterpartyLabel(c.counterpartyType) }}</td>
                <td>{{ typeLabel(c.contractType) }}</td>
                <td>
                  <p-tag [value]="statusLabel(c.status)" [severity]="statusSeverity(c.status)"></p-tag>
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

      <!-- Dialog: nuovo contratto -->
      <p-dialog
        [(visible)]="displayCreate"
        [modal]="true"
        [style]="{ width: '760px' }"
        [breakpoints]="{ '768px': '95vw' }"
        header="Nuovo contratto"
      >
        <div class="grid formgrid">
          <div class="field col-12 md:col-6">
            <label for="c-number" class="block mb-2">Numero contratto *</label>
            <input id="c-number" pInputText [(ngModel)]="form.contractNumber" placeholder="CTR-2026-001" class="w-full" />
          </div>
          <div class="field col-12 md:col-6">
            <label for="c-type" class="block mb-2">Tipo contratto *</label>
            <p-dropdown
              inputId="c-type"
              [options]="contractTypeOptions"
              [(ngModel)]="form.contractType"
              optionLabel="label"
              optionValue="value"
              placeholder="Seleziona"
              styleClass="w-full"
            ></p-dropdown>
          </div>

          <div class="field col-12 md:col-6">
            <label for="c-producer" class="block mb-2">ID produttore *</label>
            <input id="c-producer" pInputText [(ngModel)]="form.producerId" placeholder="UUID registro produttore" class="w-full" />
          </div>
          <div class="field col-12 md:col-6">
            <label for="c-counterparty" class="block mb-2">ID controparte *</label>
            <input id="c-counterparty" pInputText [(ngModel)]="form.counterpartyId" placeholder="UUID registro controparte" class="w-full" />
          </div>
          <div class="field col-12 md:col-6">
            <label for="c-counterparty-type" class="block mb-2">Tipo controparte *</label>
            <p-dropdown
              inputId="c-counterparty-type"
              [options]="counterpartyTypeOptions"
              [(ngModel)]="form.counterpartyType"
              optionLabel="label"
              optionValue="value"
              placeholder="Seleziona"
              styleClass="w-full"
            ></p-dropdown>
          </div>
          <div class="field col-12 md:col-6">
            <label for="c-pricing" class="block mb-2">Modello di pricing *</label>
            <p-dropdown
              inputId="c-pricing"
              [options]="pricingModelOptions"
              [(ngModel)]="form.pricingModel"
              optionLabel="label"
              optionValue="value"
              placeholder="Seleziona"
              styleClass="w-full"
            ></p-dropdown>
          </div>

          <div class="field col-12">
            <label for="c-cer" class="block mb-2">Codici CER *</label>
            <p-chips inputId="c-cer" [(ngModel)]="form.cerCodes" placeholder="Aggiungi CER e premi Invio" styleClass="w-full"></p-chips>
            <small class="block mt-1 text-tertiary">Es. 150101, 150102</small>
          </div>

          <div class="field col-12 md:col-4">
            <label for="c-price" class="block mb-2">Prezzo base</label>
            <p-inputNumber inputId="c-price" [(ngModel)]="form.basePrice" mode="decimal" [minFractionDigits]="0" [maxFractionDigits]="2" [min]="0" styleClass="w-full" inputStyleClass="w-full"></p-inputNumber>
          </div>
          <div class="field col-12 md:col-4">
            <label for="c-uom" class="block mb-2">Unità di misura</label>
            <input id="c-uom" pInputText [(ngModel)]="form.unitOfMeasure" placeholder="kg" class="w-full" />
          </div>
          <div class="field col-12 md:col-4">
            <label for="c-duration" class="block mb-2">Durata (mesi)</label>
            <p-inputNumber inputId="c-duration" [(ngModel)]="form.durationMonths" [min]="1" styleClass="w-full" inputStyleClass="w-full"></p-inputNumber>
          </div>

          <div class="field col-12 md:col-6">
            <label for="c-start" class="block mb-2">Data inizio *</label>
            <p-calendar inputId="c-start" [(ngModel)]="startDate" dateFormat="dd/mm/yy" [showIcon]="true" styleClass="w-full" inputStyleClass="w-full" appendTo="body"></p-calendar>
          </div>
          <div class="field col-12 md:col-6">
            <label for="c-end" class="block mb-2">Data fine</label>
            <p-calendar inputId="c-end" [(ngModel)]="endDate" dateFormat="dd/mm/yy" [showIcon]="true" styleClass="w-full" inputStyleClass="w-full" appendTo="body"></p-calendar>
          </div>

          <div class="field col-12 md:col-6">
            <label for="c-payment" class="block mb-2">Termini di pagamento</label>
            <input id="c-payment" pInputText [(ngModel)]="form.paymentTerms" placeholder="net_30" class="w-full" />
          </div>
          <div class="field col-12 md:col-6">
            <label for="c-billing" class="block mb-2">Frequenza fatturazione</label>
            <input id="c-billing" pInputText [(ngModel)]="form.billingFrequency" placeholder="monthly" class="w-full" />
          </div>

          <div class="field col-12 flex align-items-center gap-2">
            <p-checkbox [(ngModel)]="form.autoRenew" [binary]="true" inputId="autoRenew"></p-checkbox>
            <label for="autoRenew" class="mb-0">Rinnovo automatico</label>
          </div>
          <div class="field col-12 md:col-6" *ngIf="form.autoRenew">
            <label for="c-notice" class="block mb-2">Preavviso rinnovo (giorni)</label>
            <p-inputNumber inputId="c-notice" [(ngModel)]="form.renewalNoticeDays" [min]="0" styleClass="w-full" inputStyleClass="w-full"></p-inputNumber>
          </div>

          <div class="field col-12">
            <label for="c-desc" class="block mb-2">Descrizione</label>
            <textarea id="c-desc" pInputTextarea [(ngModel)]="form.description" rows="2" class="w-full"></textarea>
          </div>
        </div>
        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" (onClick)="displayCreate = false" />
          <p-button label="Crea contratto" icon="pi pi-check" [loading]="saving()" (onClick)="createContract()" />
        </ng-template>
      </p-dialog>

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
      .text-tertiary { color: var(--text-tertiary); }
      .empty-state__icon--danger { color: var(--color-danger); }
      .mb-4 { margin-bottom: var(--spacing-xl); }
      .mb-3 { margin-bottom: var(--spacing-base); }
      .mb-2 { margin-bottom: var(--spacing-sm); }
      .mb-0 { margin-bottom: 0; }
      .mt-1 { margin-top: var(--spacing-xs); }
      .field { margin-bottom: 0; }
    `,
  ],
})
export class ContractsListComponent implements OnInit {
  private readonly contractsService = inject(ContractsService);
  private readonly toast = inject(ToastService);

  readonly contracts = signal<Contract[]>([]);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly saving = signal(false);
  readonly changingStatus = signal(false);
  readonly selectedContract = signal<Contract | null>(null);

  statusFilter: ContractStatus | null = null;

  displayCreate = false;
  displayStatus = false;
  targetStatus: ContractStatus | null = null;

  startDate: Date | null = null;
  endDate: Date | null = null;

  form: CreateContractDto = this.emptyForm();

  // Opzioni dropdown
  readonly statusFilterOptions: SelectOption<ContractStatus>[] = (
    Object.keys(STATUS_LABELS) as ContractStatus[]
  ).map((s) => ({ label: STATUS_LABELS[s], value: s }));

  readonly contractTypeOptions: SelectOption<ContractType>[] = (
    Object.keys(TYPE_LABELS) as ContractType[]
  ).map((t) => ({ label: TYPE_LABELS[t], value: t }));

  readonly counterpartyTypeOptions: SelectOption<CounterpartyType>[] = (
    Object.keys(COUNTERPARTY_LABELS) as CounterpartyType[]
  ).map((t) => ({ label: COUNTERPARTY_LABELS[t], value: t }));

  readonly pricingModelOptions: SelectOption<PricingModel>[] = (
    Object.keys(PRICING_LABELS) as PricingModel[]
  ).map((p) => ({ label: PRICING_LABELS[p], value: p }));

  ngOnInit(): void {
    this.loadContracts();
  }

  loadContracts(): void {
    this.loading.set(true);
    this.error.set(false);
    this.contractsService.list(this.statusFilter ?? undefined).subscribe({
      next: (rows) => {
        this.contracts.set(rows ?? []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
        this.toast.error('Errore nel caricamento dei contratti');
      },
    });
  }

  // --- Etichette / formattazione ---
  statusLabel(s: ContractStatus): string {
    return STATUS_LABELS[s] ?? s;
  }
  statusSeverity(s: ContractStatus): 'success' | 'info' | 'warning' | 'danger' | 'secondary' {
    return STATUS_SEVERITY[s] ?? 'info';
  }
  typeLabel(t: ContractType): string {
    return TYPE_LABELS[t] ?? t;
  }
  counterpartyLabel(t: CounterpartyType): string {
    return COUNTERPARTY_LABELS[t] ?? t;
  }
  nextStatuses(s: ContractStatus): ContractStatus[] {
    return ALLOWED_TRANSITIONS[s] ?? [];
  }
  periodLabel(c: Contract): string {
    const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('it-IT') : null);
    const start = fmt(c.startDate);
    const end = fmt(c.endDate);
    if (start && end) return `${start} → ${end}`;
    if (start) return `dal ${start}`;
    return '—';
  }

  // --- Creazione ---
  openCreateDialog(): void {
    this.form = this.emptyForm();
    this.startDate = null;
    this.endDate = null;
    this.displayCreate = true;
  }

  createContract(): void {
    if (!this.validateForm()) {
      this.toast.warn('Compila tutti i campi obbligatori');
      return;
    }
    const dto: CreateContractDto = {
      ...this.form,
      startDate: this.toIsoDate(this.startDate as Date),
      endDate: this.endDate ? this.toIsoDate(this.endDate) : undefined,
    };
    this.saving.set(true);
    this.contractsService.create(dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.displayCreate = false;
        this.toast.success('Contratto creato');
        this.loadContracts();
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Errore nella creazione del contratto');
      },
    });
  }

  validateForm(): boolean {
    return !!(
      this.form.contractNumber?.trim() &&
      this.form.producerId?.trim() &&
      this.form.counterpartyId?.trim() &&
      this.form.counterpartyType &&
      this.form.contractType &&
      this.form.pricingModel &&
      this.form.cerCodes?.length &&
      this.startDate
    );
  }

  // --- Cambio stato ---
  openStatusDialog(c: Contract): void {
    this.selectedContract.set(c);
    this.targetStatus = null;
    this.displayStatus = true;
  }

  targetStatusOptions(): SelectOption<ContractStatus>[] {
    const c = this.selectedContract();
    if (!c) return [];
    return this.nextStatuses(c.status).map((s) => ({ label: STATUS_LABELS[s], value: s }));
  }

  confirmStatusChange(): void {
    const c = this.selectedContract();
    if (!c || !this.targetStatus) return;
    this.changingStatus.set(true);
    this.contractsService.updateStatus(c.id, this.targetStatus).subscribe({
      next: () => {
        this.changingStatus.set(false);
        this.displayStatus = false;
        this.toast.success('Stato del contratto aggiornato');
        this.loadContracts();
      },
      error: () => {
        this.changingStatus.set(false);
        this.toast.error('Transizione di stato non ammessa o errore di aggiornamento');
      },
    });
  }

  // --- Helpers ---
  private toIsoDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private emptyForm(): CreateContractDto {
    return {
      contractNumber: '',
      producerId: '',
      counterpartyId: '',
      counterpartyType: 'TRANSPORTER',
      contractType: 'WASTE_TRANSPORT',
      description: '',
      cerCodes: [],
      pricingModel: 'FLAT_RATE',
      basePrice: undefined,
      unitOfMeasure: 'kg',
      startDate: '',
      endDate: undefined,
      durationMonths: undefined,
      autoRenew: false,
      renewalNoticeDays: 60,
      paymentTerms: 'net_30',
      billingFrequency: 'monthly',
    };
  }
}
