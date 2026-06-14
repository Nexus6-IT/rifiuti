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
    <div class="contracts-list" style="max-width: 1400px; margin: 0 auto;">
      <div class="flex justify-content-between align-items-center mb-4">
        <h1>Contratti</h1>
        <p-button label="Nuovo contratto" icon="pi pi-plus" (onClick)="openCreateDialog()" />
      </div>

      <!-- Filtro per stato -->
      <div class="flex align-items-center gap-2 mb-3">
        <label class="font-medium">Stato:</label>
        <p-dropdown
          [options]="statusFilterOptions"
          [(ngModel)]="statusFilter"
          optionLabel="label"
          optionValue="value"
          [showClear]="true"
          placeholder="Tutti"
          styleClass="w-15rem"
          (onChange)="loadContracts()"
          (onClear)="loadContracts()"
        ></p-dropdown>
        <p-button icon="pi pi-refresh" [text]="true" (onClick)="loadContracts()" pTooltip="Aggiorna" />
      </div>

      <!-- Stato error -->
      <div *ngIf="error()" class="p-4 text-center">
        <i class="pi pi-exclamation-triangle text-2xl" style="color: var(--red-500)"></i>
        <p class="mt-2">Impossibile caricare i contratti.</p>
        <p-button label="Riprova" icon="pi pi-refresh" (onClick)="loadContracts()" />
      </div>

      <!-- Tabella -->
      <p-table
        *ngIf="!error()"
        [value]="contracts()"
        [loading]="loading()"
        [paginator]="contracts().length > 10"
        [rows]="10"
        responsiveLayout="scroll"
        styleClass="p-datatable-sm"
      >
        <ng-template pTemplate="header">
          <tr>
            <th>Numero</th>
            <th>Controparte</th>
            <th>Tipo</th>
            <th>Stato</th>
            <th>Periodo</th>
            <th style="width: 120px">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-c>
          <tr>
            <td>{{ c.contractNumber }}</td>
            <td>{{ counterpartyLabel(c.counterpartyType) }}</td>
            <td>{{ typeLabel(c.contractType) }}</td>
            <td>
              <p-tag [value]="statusLabel(c.status)" [severity]="statusSeverity(c.status)"></p-tag>
            </td>
            <td>{{ periodLabel(c) }}</td>
            <td>
              <div class="flex gap-2">
                <p-button
                  icon="pi pi-sync"
                  [rounded]="true"
                  [text]="true"
                  (onClick)="openStatusDialog(c)"
                  [disabled]="!nextStatuses(c.status).length"
                  pTooltip="Cambia stato"
                />
              </div>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="6" class="text-center p-4">
              Nessun contratto trovato.
            </td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Dialog: nuovo contratto -->
      <p-dialog
        [(visible)]="displayCreate"
        [modal]="true"
        [style]="{ width: '760px' }"
        header="Nuovo contratto"
      >
        <div class="grid">
          <div class="col-12 md:col-6">
            <label class="block mb-2">Numero contratto *</label>
            <input pInputText [(ngModel)]="form.contractNumber" placeholder="CTR-2026-001" class="w-full" />
          </div>
          <div class="col-12 md:col-6">
            <label class="block mb-2">Tipo contratto *</label>
            <p-dropdown
              [options]="contractTypeOptions"
              [(ngModel)]="form.contractType"
              optionLabel="label"
              optionValue="value"
              placeholder="Seleziona"
              styleClass="w-full"
            ></p-dropdown>
          </div>

          <div class="col-12 md:col-6">
            <label class="block mb-2">ID produttore *</label>
            <input pInputText [(ngModel)]="form.producerId" placeholder="UUID registro produttore" class="w-full" />
          </div>
          <div class="col-12 md:col-6">
            <label class="block mb-2">ID controparte *</label>
            <input pInputText [(ngModel)]="form.counterpartyId" placeholder="UUID registro controparte" class="w-full" />
          </div>
          <div class="col-12 md:col-6">
            <label class="block mb-2">Tipo controparte *</label>
            <p-dropdown
              [options]="counterpartyTypeOptions"
              [(ngModel)]="form.counterpartyType"
              optionLabel="label"
              optionValue="value"
              placeholder="Seleziona"
              styleClass="w-full"
            ></p-dropdown>
          </div>
          <div class="col-12 md:col-6">
            <label class="block mb-2">Modello di pricing *</label>
            <p-dropdown
              [options]="pricingModelOptions"
              [(ngModel)]="form.pricingModel"
              optionLabel="label"
              optionValue="value"
              placeholder="Seleziona"
              styleClass="w-full"
            ></p-dropdown>
          </div>

          <div class="col-12">
            <label class="block mb-2">Codici CER *</label>
            <p-chips [(ngModel)]="form.cerCodes" placeholder="Aggiungi CER e premi Invio" styleClass="w-full"></p-chips>
            <small class="block mt-1 text-color-secondary">Es. 150101, 150102</small>
          </div>

          <div class="col-12 md:col-4">
            <label class="block mb-2">Prezzo base</label>
            <p-inputNumber [(ngModel)]="form.basePrice" mode="decimal" [minFractionDigits]="0" [maxFractionDigits]="2" [min]="0" styleClass="w-full" inputStyleClass="w-full"></p-inputNumber>
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">Unità di misura</label>
            <input pInputText [(ngModel)]="form.unitOfMeasure" placeholder="kg" class="w-full" />
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">Durata (mesi)</label>
            <p-inputNumber [(ngModel)]="form.durationMonths" [min]="1" styleClass="w-full" inputStyleClass="w-full"></p-inputNumber>
          </div>

          <div class="col-12 md:col-6">
            <label class="block mb-2">Data inizio *</label>
            <p-calendar [(ngModel)]="startDate" dateFormat="dd/mm/yy" [showIcon]="true" styleClass="w-full" appendTo="body"></p-calendar>
          </div>
          <div class="col-12 md:col-6">
            <label class="block mb-2">Data fine</label>
            <p-calendar [(ngModel)]="endDate" dateFormat="dd/mm/yy" [showIcon]="true" styleClass="w-full" appendTo="body"></p-calendar>
          </div>

          <div class="col-12 md:col-6">
            <label class="block mb-2">Termini di pagamento</label>
            <input pInputText [(ngModel)]="form.paymentTerms" placeholder="net_30" class="w-full" />
          </div>
          <div class="col-12 md:col-6">
            <label class="block mb-2">Frequenza fatturazione</label>
            <input pInputText [(ngModel)]="form.billingFrequency" placeholder="monthly" class="w-full" />
          </div>

          <div class="col-12 flex align-items-center gap-2">
            <p-checkbox [(ngModel)]="form.autoRenew" [binary]="true" inputId="autoRenew"></p-checkbox>
            <label for="autoRenew">Rinnovo automatico</label>
          </div>
          <div class="col-12 md:col-6" *ngIf="form.autoRenew">
            <label class="block mb-2">Preavviso rinnovo (giorni)</label>
            <p-inputNumber [(ngModel)]="form.renewalNoticeDays" [min]="0" styleClass="w-full" inputStyleClass="w-full"></p-inputNumber>
          </div>

          <div class="col-12">
            <label class="block mb-2">Descrizione</label>
            <textarea pInputTextarea [(ngModel)]="form.description" rows="2" class="w-full"></textarea>
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
        header="Cambia stato contratto"
      >
        <div *ngIf="selectedContract() as sc">
          <p class="mb-3">
            Contratto <strong>{{ sc.contractNumber }}</strong> — stato attuale:
            <p-tag [value]="statusLabel(sc.status)" [severity]="statusSeverity(sc.status)"></p-tag>
          </p>
          <label class="block mb-2">Nuovo stato</label>
          <p-dropdown
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
      .grid {
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 1rem;
      }
      .col-12 { grid-column: span 12; }
      .col-6 { grid-column: span 6; }
      .col-4 { grid-column: span 4; }
      @media (min-width: 768px) {
        .md\\:col-6 { grid-column: span 6; }
        .md\\:col-4 { grid-column: span 4; }
      }
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
