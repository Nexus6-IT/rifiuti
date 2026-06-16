import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DropdownModule } from 'primeng/dropdown';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { SplitButtonModule } from 'primeng/splitbutton';
import { CardModule } from 'primeng/card';
import { MenuItem } from 'primeng/api';
import { FirService, CreateFIRDto } from './fir.service';
import { FIR, FIRStato } from '../../shared/models/fir.model';
import { ExportService } from '../../core/services/export.service';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader.component';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { ErrorStateComponent } from '../../shared/components/error-state.component';

/**
 * Enhanced FIR List Component
 *
 * Improved version with:
 * - Skeleton loading states
 * - Empty states with actions
 * - Error handling
 * - Mobile card view
 * - Better accessibility
 * - Modern design system
 */
@Component({
  selector: 'app-fir-list-enhanced',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    DropdownModule,
    TagModule,
    DialogModule,
    InputNumberModule,
    ConfirmDialogModule,
    SplitButtonModule,
    CardModule,
    SkeletonLoaderComponent,
    EmptyStateComponent,
    ErrorStateComponent
  ],
  providers: [ConfirmationService],
  template: `
    <div class="fir-list">
      <!-- Page Header -->
      <div class="page-header">
        <div>
          <h1 class="page-title">Gestione FIR</h1>
          <p class="page-subtitle">Formulari di Identificazione Rifiuti</p>
        </div>
        <div class="page-actions">
          <p-splitButton
            label="Esporta"
            icon="pi pi-download"
            [model]="exportMenuItems"
            [outlined]="true"
            [disabled]="firList.length === 0"
            aria-label="Esporta elenco FIR"
          />
          <p-button
            label="Nuovo FIR"
            icon="pi pi-plus"
            (onClick)="showCreateDialog()"
            aria-label="Crea nuovo FIR"
          />
        </div>
      </div>

      <!-- Filters Card -->
      <p-card styleClass="filters-card mb-4">
        <div class="grid">
          <div class="col-12 md:col-6 lg:col-4">
            <label for="search-input" class="field-label">Cerca</label>
            <input
              pInputText
              id="search-input"
              [(ngModel)]="searchText"
              placeholder="Cerca per numero FIR..."
              class="w-full"
              (input)="onSearch()"
              aria-label="Campo di ricerca per numero FIR"
            />
          </div>
          <div class="col-12 md:col-6 lg:col-4">
            <label for="stato-filter" class="field-label">Filtra per Stato</label>
            <p-dropdown
              inputId="stato-filter"
              [options]="statoOptions"
              [(ngModel)]="selectedStato"
              placeholder="Tutti gli stati"
              [showClear]="true"
              (onChange)="onFilterChange()"
              styleClass="w-full"
              aria-label="Filtra FIR per stato"
            />
          </div>
          <div class="col-12 lg:col-4 flex align-items-end">
            <p-button
              label="Resetta filtri"
              icon="pi pi-filter-slash"
              [text]="true"
              (onClick)="resetFilters()"
              [disabled]="!searchText && !selectedStato"
              class="w-full"
              aria-label="Resetta tutti i filtri"
            />
          </div>
        </div>
      </p-card>

      <!-- Error State -->
      <app-error-state
        *ngIf="error && !loading"
        title="Errore nel caricamento dei FIR"
        [message]="error"
        (retry)="loadFIRList({ first: 0, rows: pageSize })"
      />

      <!-- Loading State -->
      <app-skeleton-loader *ngIf="loading && firList.length === 0" variant="table" [rows]="10" />

      <!-- Desktop Table View (hidden on mobile) -->
      <div class="desktop-view" *ngIf="!loading && !error">
        <p-table
          [value]="firList"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords"
          [lazy]="true"
          (onLazyLoad)="loadFIRList($event)"
          responsiveLayout="scroll"
          styleClass="fir-table"
          [rowsPerPageOptions]="[10, 25, 50]"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col">Numero</th>
              <th scope="col">Anno</th>
              <th scope="col">CER</th>
              <th scope="col">Quantità</th>
              <th scope="col">Stato</th>
              <th scope="col">Data Creazione</th>
              <th scope="col" class="actions-col">Azioni</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-fir>
            <tr>
              <td>
                <span class="font-semibold">{{ fir.numeroProgressivo || 'N/A' }}</span>
              </td>
              <td>{{ fir.anno }}</td>
              <td>
                <span class="cer-code">{{ fir.rifiuto.cerCode }}</span>
              </td>
              <td>
                <span class="quantity">{{ fir.rifiuto.quantitaDichiarata }} {{ fir.rifiuto.unitaMisura }}</span>
              </td>
              <td>
                <p-tag
                  [value]="fir.stato"
                  [severity]="getStatoSeverity(fir.stato)"
                  [attr.aria-label]="'Stato: ' + fir.stato"
                />
              </td>
              <td>
                <time [dateTime]="fir.createdAt">
                  {{ fir.createdAt | date: 'dd/MM/yyyy HH:mm' }}
                </time>
              </td>
              <td>
                <div class="action-buttons">
                  <p-button
                    *ngIf="fir.stato === 'BOZZA'"
                    icon="pi pi-send"
                    [rounded]="true"
                    [text]="true"
                    severity="info"
                    (onClick)="emettiFIR(fir)"
                    pTooltip="Emetti FIR"
                    aria-label="Emetti FIR"
                  />
                  <p-button
                    *ngIf="fir.stato === 'EMESSO'"
                    icon="pi pi-truck"
                    [rounded]="true"
                    [text]="true"
                    severity="warning"
                    (onClick)="presaInCarico(fir)"
                    pTooltip="Presa in Carico"
                    aria-label="Prendi in carico FIR"
                  />
                  <p-button
                    *ngIf="fir.stato === 'IN_TRANSITO'"
                    icon="pi pi-check"
                    [rounded]="true"
                    [text]="true"
                    severity="success"
                    (onClick)="showConsegnaDialog(fir)"
                    pTooltip="Consegna"
                    aria-label="Segna FIR come consegnato"
                  />
                  <p-button
                    icon="pi pi-trash"
                    [rounded]="true"
                    [text]="true"
                    severity="danger"
                    (onClick)="deleteFIR(fir)"
                    pTooltip="Elimina"
                    aria-label="Elimina FIR"
                  />
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7">
                <app-empty-state
                  icon="pi-file"
                  title="Nessun FIR trovato"
                  [message]="searchText || selectedStato ? 'Nessun FIR corrisponde ai criteri di ricerca. Prova a modificare i filtri.' : 'Non ci sono FIR da visualizzare. Crea il tuo primo FIR per iniziare.'"
                  [actionLabel]="searchText || selectedStato ? '' : 'Crea FIR'"
                  actionIcon="pi pi-plus"
                  (action)="showCreateDialog()"
                  [variant]="searchText || selectedStato ? 'search' : 'default'"
                />
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>

      <!-- Mobile Card View (visible only on mobile) -->
      <div class="mobile-view" *ngIf="!loading && !error">
        <!-- Empty State for Mobile -->
        <app-empty-state
          *ngIf="firList.length === 0"
          icon="pi-file"
          title="Nessun FIR trovato"
          [message]="searchText || selectedStato ? 'Nessun FIR corrisponde ai criteri di ricerca.' : 'Crea il tuo primo FIR per iniziare.'"
          [actionLabel]="searchText || selectedStato ? '' : 'Crea FIR'"
          actionIcon="pi pi-plus"
          (action)="showCreateDialog()"
        />

        <!-- Mobile Cards -->
        <div class="fir-cards" *ngIf="firList.length > 0">
          <p-card *ngFor="let fir of firList" styleClass="fir-card">
            <div class="fir-card-header">
              <div class="fir-card-number">
                <span class="label">FIR</span>
                <span class="value">{{ fir.numeroProgressivo || 'N/A' }}</span>
              </div>
              <p-tag
                [value]="fir.stato"
                [severity]="getStatoSeverity(fir.stato)"
              />
            </div>

            <div class="fir-card-content">
              <div class="fir-card-row">
                <span class="label">CER:</span>
                <span class="value">{{ fir.rifiuto.cerCode }}</span>
              </div>
              <div class="fir-card-row">
                <span class="label">Quantità:</span>
                <span class="value">{{ fir.rifiuto.quantitaDichiarata }} {{ fir.rifiuto.unitaMisura }}</span>
              </div>
              <div class="fir-card-row">
                <span class="label">Anno:</span>
                <span class="value">{{ fir.anno }}</span>
              </div>
              <div class="fir-card-row">
                <span class="label">Data:</span>
                <span class="value">{{ fir.createdAt | date: 'dd/MM/yyyy HH:mm' }}</span>
              </div>
            </div>

            <div class="fir-card-actions">
              <p-button
                *ngIf="fir.stato === 'BOZZA'"
                label="Emetti"
                icon="pi pi-send"
                severity="info"
                [outlined]="true"
                (onClick)="emettiFIR(fir)"
                styleClass="w-full"
              />
              <p-button
                *ngIf="fir.stato === 'EMESSO'"
                label="Prendi in Carico"
                icon="pi pi-truck"
                severity="warning"
                [outlined]="true"
                (onClick)="presaInCarico(fir)"
                styleClass="w-full"
              />
              <p-button
                *ngIf="fir.stato === 'IN_TRANSITO'"
                label="Consegna"
                icon="pi pi-check"
                severity="success"
                [outlined]="true"
                (onClick)="showConsegnaDialog(fir)"
                styleClass="w-full"
              />
              <p-button
                label="Elimina"
                icon="pi pi-trash"
                severity="danger"
                [text]="true"
                (onClick)="deleteFIR(fir)"
                styleClass="w-full"
              />
            </div>
          </p-card>

          <!-- Mobile Pagination -->
          <div class="mobile-pagination" *ngIf="totalRecords > pageSize">
            <p-button
              icon="pi pi-chevron-left"
              [outlined]="true"
              [disabled]="currentPage === 1"
              (onClick)="previousPage()"
              aria-label="Pagina precedente"
            />
            <span class="page-info">
              Pagina {{ currentPage }} di {{ totalPages }}
            </span>
            <p-button
              icon="pi pi-chevron-right"
              [outlined]="true"
              [disabled]="currentPage === totalPages"
              (onClick)="nextPage()"
              aria-label="Pagina successiva"
            />
          </div>
        </div>
      </div>

      <!-- Create FIR Dialog -->
      <p-dialog
        [(visible)]="displayCreateDialog"
        [modal]="true"
        styleClass="w-full max-w-30rem"
        header="Nuovo FIR"
        [closable]="true"
        [closeOnEscape]="true"
      >
        <div class="grid">
          <div class="col-12">
            <label for="fir-anno" class="field-label">Anno *</label>
            <p-inputNumber
              inputId="fir-anno"
              [(ngModel)]="newFIR.anno"
              [useGrouping]="false"
              [min]="2020"
              [max]="2030"
              styleClass="w-full"
              [required]="true"
            />
          </div>
          <div class="col-12">
            <label for="fir-cer" class="field-label">Codice CER *</label>
            <input
              pInputText
              id="fir-cer"
              [(ngModel)]="newFIR.rifiuto.cerCode"
              placeholder="es. 150101"
              class="w-full"
              required
            />
          </div>
          <div class="col-12 md:col-6">
            <label for="fir-quantita" class="field-label">Quantità Dichiarata *</label>
            <p-inputNumber
              inputId="fir-quantita"
              [(ngModel)]="newFIR.rifiuto.quantitaDichiarata"
              [minFractionDigits]="2"
              styleClass="w-full"
              [required]="true"
            />
          </div>
          <div class="col-12 md:col-6">
            <label for="fir-unita" class="field-label">Unità di Misura *</label>
            <p-dropdown
              inputId="fir-unita"
              [options]="unitaMisuraOptions"
              [(ngModel)]="newFIR.rifiuto.unitaMisura"
              placeholder="Seleziona"
              styleClass="w-full"
            />
          </div>
          <div class="col-12">
            <label for="fir-produttore" class="field-label">Produttore ID *</label>
            <input
              pInputText
              id="fir-produttore"
              [(ngModel)]="newFIR.produttoreId"
              class="w-full"
              required
            />
          </div>
          <div class="col-12">
            <label for="fir-trasportatore" class="field-label">Trasportatore ID *</label>
            <input
              pInputText
              id="fir-trasportatore"
              [(ngModel)]="newFIR.trasportatoreId"
              class="w-full"
              required
            />
          </div>
          <div class="col-12">
            <label for="fir-destinatario" class="field-label">Destinatario ID *</label>
            <input
              pInputText
              id="fir-destinatario"
              [(ngModel)]="newFIR.destinatarioId"
              class="w-full"
              required
            />
          </div>
        </div>
        <ng-template pTemplate="footer">
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="displayCreateDialog = false"
          />
          <p-button
            label="Salva"
            (onClick)="createFIR()"
            [loading]="saving"
          />
        </ng-template>
      </p-dialog>

      <!-- Consegna Dialog -->
      <p-dialog
        [(visible)]="displayConsegnaDialog"
        [modal]="true"
        styleClass="w-full max-w-20rem"
        header="Conferma Consegna"
        [closable]="true"
      >
        <div class="field">
          <label for="peso-effettivo" class="field-label">Peso Effettivo (kg) *</label>
          <p-inputNumber
            inputId="peso-effettivo"
            [(ngModel)]="pesoEffettivo"
            [minFractionDigits]="2"
            styleClass="w-full"
            [required]="true"
          />
        </div>
        <ng-template pTemplate="footer">
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="displayConsegnaDialog = false"
          />
          <p-button
            label="Conferma"
            (onClick)="consegnaFIR()"
            [loading]="saving"
          />
        </ng-template>
      </p-dialog>

      <p-confirmDialog />
    </div>
  `,
  styles: [`
    .fir-list {
      animation: fadeIn 0.3s ease-in;
    }

    /* Page Header */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: var(--spacing-xl, 1.75rem);
      gap: var(--spacing-md, 1rem);
    }

    .page-title {
      margin: 0 0 var(--spacing-xs, 0.5rem) 0;
      font-size: var(--font-size-2xl, 1.875rem);
      font-weight: var(--font-weight-bold, 700);
      color: var(--text-primary);
    }

    .page-subtitle {
      margin: 0;
      font-size: var(--font-size-base, 1rem);
      color: var(--text-secondary);
    }

    .page-actions {
      display: flex;
      gap: var(--spacing-sm, 0.75rem);
      flex-shrink: 0;
    }

    /* Field Labels */
    .field-label {
      display: block;
      margin-bottom: var(--spacing-xs, 0.5rem);
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--text-primary);
    }

    /* Filters Card */
    :host ::ng-deep .filters-card {
      border: 1px solid var(--surface-border);
    }

    /* Desktop View */
    .desktop-view {
      display: block;
    }

    .mobile-view {
      display: none;
    }

    /* Table Enhancements */
    :host ::ng-deep .fir-table {
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }

    :host ::ng-deep .fir-table .p-datatable-thead > tr > th {
      background: var(--color-gray-50);
      color: var(--text-primary);
      font-weight: var(--font-weight-semibold, 600);
      font-size: var(--font-size-sm, 0.875rem);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .cer-code {
      font-family: var(--font-family-mono);
      background: var(--color-gray-100);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: var(--font-size-sm, 0.875rem);
    }

    .quantity {
      font-weight: var(--font-weight-medium, 500);
    }

    .action-buttons {
      display: flex;
      gap: var(--spacing-xs, 0.5rem);
      justify-content: flex-end;
    }

    .actions-col {
      width: 180px;
    }

    /* Mobile Card View */
    .fir-cards {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md, 1rem);
    }

    :host ::ng-deep .fir-card {
      border: 1px solid var(--surface-border);
      transition: box-shadow 0.2s ease;
    }

    :host ::ng-deep .fir-card:hover {
      box-shadow: var(--shadow-lg);
    }

    .fir-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--spacing-md, 1rem);
      padding-bottom: var(--spacing-md, 1rem);
      border-bottom: 1px solid var(--surface-border);
    }

    .fir-card-number {
      display: flex;
      flex-direction: column;
    }

    .fir-card-number .label {
      font-size: var(--font-size-xs, 0.75rem);
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .fir-card-number .value {
      font-size: var(--font-size-xl, 1.25rem);
      font-weight: var(--font-weight-bold, 700);
      color: var(--text-primary);
    }

    .fir-card-content {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm, 0.75rem);
      margin-bottom: var(--spacing-lg, 1.5rem);
    }

    .fir-card-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .fir-card-row .label {
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--text-secondary);
    }

    .fir-card-row .value {
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--text-primary);
    }

    .fir-card-actions {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm, 0.75rem);
    }

    .mobile-pagination {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: var(--spacing-md, 1rem);
      margin-top: var(--spacing-lg, 1.5rem);
      padding: var(--spacing-md, 1rem);
    }

    .page-info {
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--text-secondary);
    }

    /* Responsive Design */
    @media (max-width: 768px) {
      .page-header {
        flex-direction: column;
        align-items: stretch;
      }

      .page-actions {
        width: 100%;
        justify-content: space-between;
      }

      .page-actions ::ng-deep .p-button {
        flex: 1;
      }

      .desktop-view {
        display: none;
      }

      .mobile-view {
        display: block;
      }
    }

    /* Animations */
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .fir-list,
      :host ::ng-deep .fir-card {
        animation: none;
        transition: none;
      }
    }
  `]
})
export class FirListEnhancedComponent implements OnInit {
  firList: FIR[] = [];
  loading = false;
  saving = false;
  error = '';
  totalRecords = 0;
  pageSize = 10;
  currentPage = 1;

  searchText = '';
  selectedStato: FIRStato | null = null;

  displayCreateDialog = false;
  displayConsegnaDialog = false;
  selectedFIR: FIR | null = null;
  pesoEffettivo = 0;

  newFIR: CreateFIRDto = {
    anno: new Date().getFullYear(),
    produttoreId: '',
    trasportatoreId: '',
    destinatarioId: '',
    rifiuto: {
      cerCode: '',
      quantitaDichiarata: 0,
      unitaMisura: 'kg'
    }
  };

  statoOptions = [
    { label: 'Bozza', value: FIRStato.BOZZA },
    { label: 'Emesso', value: FIRStato.EMESSO },
    { label: 'In Transito', value: FIRStato.IN_TRANSITO },
    { label: 'Consegnato', value: FIRStato.CONSEGNATO },
    { label: 'Annullato', value: FIRStato.ANNULLATO }
  ];

  unitaMisuraOptions = [
    { label: 'kg', value: 'kg' },
    { label: 't', value: 't' },
    { label: 'm³', value: 'm3' }
  ];

  exportMenuItems: MenuItem[] = [];

  get totalPages(): number {
    return Math.ceil(this.totalRecords / this.pageSize);
  }

  constructor(
    private firService: FirService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private exportService: ExportService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initializeExportMenu();
    this.loadFIRList({ first: 0, rows: this.pageSize });
  }

  initializeExportMenu(): void {
    this.exportMenuItems = [
      {
        label: 'Esporta PDF',
        icon: 'pi pi-file-pdf',
        command: () => this.exportToPDF()
      },
      {
        label: 'Esporta Excel',
        icon: 'pi pi-file-excel',
        command: () => this.exportToExcel()
      }
    ];
  }

  exportToPDF(): void {
    if (this.firList.length === 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Attenzione',
        detail: 'Nessun FIR da esportare'
      });
      return;
    }

    this.exportService.exportFIRListToPDF(this.firList);
    this.messageService.add({
      severity: 'success',
      summary: 'Successo',
      detail: 'FIR esportati in PDF'
    });
  }

  exportToExcel(): void {
    if (this.firList.length === 0) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Attenzione',
        detail: 'Nessun FIR da esportare'
      });
      return;
    }

    this.exportService.exportFIRListToExcel(this.firList);
    this.messageService.add({
      severity: 'success',
      summary: 'Successo',
      detail: 'FIR esportati in Excel'
    });
  }

  loadFIRList(event: any): void {
    this.loading = true;
    this.error = '';
    const page = Math.floor(event.first / event.rows) + 1;
    this.currentPage = page;

    this.firService.getFIRList(page, event.rows, this.selectedStato || undefined).subscribe({
      next: (response) => {
        this.firList = response.items;
        this.totalRecords = response.total;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message || 'Errore nel caricamento dei FIR. Riprova più tardi.';
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.error
        });
      }
    });
  }

  onSearch(): void {
    this.loadFIRList({ first: 0, rows: this.pageSize });
  }

  onFilterChange(): void {
    this.loadFIRList({ first: 0, rows: this.pageSize });
  }

  resetFilters(): void {
    this.searchText = '';
    this.selectedStato = null;
    this.loadFIRList({ first: 0, rows: this.pageSize });
  }

  previousPage(): void {
    if (this.currentPage > 1) {
      const first = (this.currentPage - 2) * this.pageSize;
      this.loadFIRList({ first, rows: this.pageSize });
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      const first = this.currentPage * this.pageSize;
      this.loadFIRList({ first, rows: this.pageSize });
    }
  }

  showCreateDialog(): void {
    this.newFIR = {
      anno: new Date().getFullYear(),
      produttoreId: '',
      trasportatoreId: '',
      destinatarioId: '',
      rifiuto: {
        cerCode: '',
        quantitaDichiarata: 0,
        unitaMisura: 'kg'
      }
    };
    this.displayCreateDialog = true;
  }

  createFIR(): void {
    this.saving = true;
    this.firService.createFIR(this.newFIR).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Successo',
          detail: 'FIR creato con successo'
        });
        this.displayCreateDialog = false;
        this.saving = false;
        this.loadFIRList({ first: 0, rows: this.pageSize });
      },
      error: () => {
        this.saving = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: 'Errore nella creazione del FIR'
        });
      }
    });
  }

  emettiFIR(fir: FIR): void {
    this.confirmationService.confirm({
      message: 'Confermi di voler emettere questo FIR?',
      header: 'Conferma Emissione',
      icon: 'pi pi-send',
      accept: () => {
        this.firService.emettiFIR(fir.id).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Successo',
              detail: 'FIR emesso con successo'
            });
            this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize });
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: 'Errore nell\'emissione del FIR'
            });
          }
        });
      }
    });
  }

  presaInCarico(fir: FIR): void {
    this.confirmationService.confirm({
      message: 'Confermi la presa in carico di questo FIR?',
      header: 'Conferma Presa in Carico',
      icon: 'pi pi-truck',
      accept: () => {
        this.firService.presaInCarico(fir.id).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Successo',
              detail: 'FIR preso in carico con successo'
            });
            this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize });
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: 'Errore nella presa in carico del FIR'
            });
          }
        });
      }
    });
  }

  showConsegnaDialog(fir: FIR): void {
    this.selectedFIR = fir;
    this.pesoEffettivo = fir.rifiuto.quantitaDichiarata;
    this.displayConsegnaDialog = true;
  }

  consegnaFIR(): void {
    if (!this.selectedFIR) return;

    this.saving = true;
    this.firService.consegnaFIR(this.selectedFIR.id, this.pesoEffettivo).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Successo',
          detail: 'FIR consegnato con successo'
        });
        this.displayConsegnaDialog = false;
        this.saving = false;
        this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize });
      },
      error: () => {
        this.saving = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: 'Errore nella consegna del FIR'
        });
      }
    });
  }

  deleteFIR(fir: FIR): void {
    this.confirmationService.confirm({
      message: 'Sei sicuro di voler eliminare questo FIR?',
      header: 'Conferma Eliminazione',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.firService.deleteFIR(fir.id).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Successo',
              detail: 'FIR eliminato con successo'
            });
            this.loadFIRList({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize });
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: 'Errore nell\'eliminazione del FIR'
            });
          }
        });
      }
    });
  }

  getStatoSeverity(stato: FIRStato): "success" | "info" | "warning" | "danger" | "secondary" | "contrast" | undefined {
    const severityMap: Record<FIRStato, "success" | "info" | "warning" | "danger" | "secondary"> = {
      [FIRStato.BOZZA]: 'secondary',
      [FIRStato.EMESSO]: 'info',
      [FIRStato.IN_TRANSITO]: 'warning',
      [FIRStato.CONSEGNATO]: 'success',
      [FIRStato.ANNULLATO]: 'danger'
    };
    return severityMap[stato];
  }
}
