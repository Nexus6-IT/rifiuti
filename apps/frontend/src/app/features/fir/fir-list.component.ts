import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
import { TooltipModule } from 'primeng/tooltip';
import { FirService, CreateFIRDto } from './fir.service';
import { FIR, FIRStato } from '../../shared/models/fir.model';
import { ExportService } from '../../core/services/export.service';

@Component({
  selector: 'app-fir-list',
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
    TooltipModule
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page fir-list">
      <!-- Intestazione pagina -->
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Gestione FIR</h1>
          <p class="page-subtitle">Formulari di Identificazione dei Rifiuti: creazione, emissione e tracciamento</p>
        </div>
        <div class="page-actions">
          <p-splitButton
            label="Esporta"
            icon="pi pi-download"
            [model]="exportMenuItems"
            [outlined]="true"
            [disabled]="loading || firList.length === 0"
          />
          <p-button
            label="Nuovo FIR"
            icon="pi pi-plus"
            (onClick)="showCreateDialog()"
          />
        </div>
      </header>

      <!-- Barra filtri / ricerca -->
      <section class="surface-card filters" aria-label="Filtri di ricerca FIR">
        <div class="filters__field">
          <label for="fir-search" class="filters__label">Cerca</label>
          <span class="p-input-icon-left filters__search">
            <i class="pi pi-search" aria-hidden="true"></i>
            <input
              id="fir-search"
              pInputText
              type="search"
              [(ngModel)]="searchText"
              placeholder="Cerca per numero progressivo..."
              aria-label="Cerca FIR per numero progressivo"
              (input)="onSearch()"
            />
          </span>
        </div>
        <div class="filters__field">
          <label for="fir-stato" class="filters__label">Filtra per stato</label>
          <p-dropdown
            inputId="fir-stato"
            [options]="statoOptions"
            [(ngModel)]="selectedStato"
            placeholder="Tutti gli stati"
            [showClear]="true"
            (onChange)="onFilterChange()"
            ariaLabel="Filtra i FIR per stato"
            styleClass="w-full"
          />
        </div>
      </section>

      <!-- Stato di errore -->
      <div *ngIf="error && !loading" class="surface-card" role="alert">
        <div class="empty-state">
          <i class="pi pi-exclamation-triangle empty-state__icon" style="color: var(--color-danger);" aria-hidden="true"></i>
          <p class="empty-state__title">Impossibile caricare i FIR</p>
          <p>Si è verificato un errore durante il recupero dei dati. Riprova.</p>
          <p-button label="Riprova" icon="pi pi-refresh" [outlined]="true" (onClick)="reload()" />
        </div>
      </div>

      <!-- Tabella FIR -->
      <div *ngIf="!error" class="surface-card table-card">
        <div class="table-responsive">
          <p-table
            [value]="firList"
            [loading]="loading"
            [paginator]="true"
            [rows]="pageSize"
            [totalRecords]="totalRecords"
            [lazy]="true"
            (onLazyLoad)="loadFIRList($event)"
            responsiveLayout="scroll"
            styleClass="p-datatable-sm"
            [tableStyle]="{ 'min-width': '60rem' }"
          >
            <ng-template pTemplate="caption">
              <span class="sr-only">Elenco dei Formulari di Identificazione dei Rifiuti</span>
            </ng-template>
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Numero</th>
                <th scope="col">Anno</th>
                <th scope="col">CER</th>
                <th scope="col">Quantità</th>
                <th scope="col">Stato</th>
                <th scope="col">Data creazione</th>
                <th scope="col" class="col-actions">Azioni</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-fir>
              <tr>
                <td><span class="cell-mono">{{ fir.numeroProgressivo || 'N/D' }}</span></td>
                <td>{{ fir.anno }}</td>
                <td><span class="cell-mono">{{ fir.rifiuto.cerCode }}</span></td>
                <td>{{ fir.rifiuto.quantitaDichiarata }} {{ fir.rifiuto.unitaMisura }}</td>
                <td>
                  <p-tag
                    [value]="getStatoLabel(fir.stato)"
                    [severity]="getStatoSeverity(fir.stato)"
                  />
                </td>
                <td>{{ fir.createdAt | date: 'dd/MM/yyyy HH:mm' }}</td>
                <td>
                  <div class="row-actions">
                    <p-button
                      *ngIf="fir.stato === 'BOZZA'"
                      icon="pi pi-send"
                      [rounded]="true"
                      [text]="true"
                      severity="info"
                      (onClick)="emettiFIR(fir)"
                      pTooltip="Emetti"
                      [attr.aria-label]="'Emetti FIR ' + (fir.numeroProgressivo || fir.anno)"
                    />
                    <p-button
                      *ngIf="fir.stato === 'EMESSO'"
                      icon="pi pi-truck"
                      [rounded]="true"
                      [text]="true"
                      severity="warning"
                      (onClick)="presaInCarico(fir)"
                      pTooltip="Presa in carico"
                      [attr.aria-label]="'Presa in carico FIR ' + (fir.numeroProgressivo || fir.anno)"
                    />
                    <p-button
                      *ngIf="fir.stato === 'IN_TRANSITO'"
                      icon="pi pi-check"
                      [rounded]="true"
                      [text]="true"
                      severity="success"
                      (onClick)="showConsegnaDialog(fir)"
                      pTooltip="Consegna"
                      [attr.aria-label]="'Conferma consegna FIR ' + (fir.numeroProgressivo || fir.anno)"
                    />
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="deleteFIR(fir)"
                      pTooltip="Elimina"
                      [attr.aria-label]="'Elimina FIR ' + (fir.numeroProgressivo || fir.anno)"
                    />
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="7">
                  <div class="empty-state">
                    <i class="pi pi-inbox empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessun FIR trovato</p>
                    <p>Non ci sono formulari corrispondenti ai filtri selezionati.</p>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </div>

      <!-- Create FIR Dialog -->
      <p-dialog
        [(visible)]="displayCreateDialog"
        [modal]="true"
        styleClass="w-full max-w-30rem"
        header="Nuovo FIR"
      >
        <div class="dialog-form">
          <div class="dialog-form__field">
            <label for="new-anno">Anno</label>
            <p-inputNumber
              inputId="new-anno"
              [(ngModel)]="newFIR.anno"
              [useGrouping]="false"
              [min]="2020"
              [max]="2030"
              styleClass="w-full"
            />
          </div>
          <div class="dialog-form__field">
            <label for="new-cer">Codice CER</label>
            <input
              id="new-cer"
              pInputText
              [(ngModel)]="newFIR.rifiuto.cerCode"
              placeholder="es. 150101"
              class="w-full"
            />
          </div>
          <div class="dialog-form__row">
            <div class="dialog-form__field">
              <label for="new-qta">Quantità dichiarata</label>
              <p-inputNumber
                inputId="new-qta"
                [(ngModel)]="newFIR.rifiuto.quantitaDichiarata"
                [minFractionDigits]="2"
                styleClass="w-full"
              />
            </div>
            <div class="dialog-form__field">
              <label for="new-um">Unità di misura</label>
              <p-dropdown
                inputId="new-um"
                [options]="unitaMisuraOptions"
                [(ngModel)]="newFIR.rifiuto.unitaMisura"
                placeholder="Seleziona"
                styleClass="w-full"
              />
            </div>
          </div>
          <div class="dialog-form__field">
            <label for="new-produttore">Produttore ID</label>
            <input
              id="new-produttore"
              pInputText
              [(ngModel)]="newFIR.produttoreId"
              class="w-full"
            />
          </div>
          <div class="dialog-form__field">
            <label for="new-trasportatore">Trasportatore ID</label>
            <input
              id="new-trasportatore"
              pInputText
              [(ngModel)]="newFIR.trasportatoreId"
              class="w-full"
            />
          </div>
          <div class="dialog-form__field">
            <label for="new-destinatario">Destinatario ID</label>
            <input
              id="new-destinatario"
              pInputText
              [(ngModel)]="newFIR.destinatarioId"
              class="w-full"
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
      >
        <div class="dialog-form__field">
          <label for="peso-effettivo">Peso effettivo (kg)</label>
          <p-inputNumber
            inputId="peso-effettivo"
            [(ngModel)]="pesoEffettivo"
            [minFractionDigits]="2"
            styleClass="w-full"
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
      flex: 1 1 240px;
      min-width: 0;
    }
    .filters__label {
      font-size: var(--font-size-sm);
      font-weight: var(--font-weight-medium);
      color: var(--text-secondary);
    }
    .filters__search { display: block; width: 100%; }
    .filters__search input { width: 100%; }

    .table-card { padding: 0; overflow: hidden; }

    .col-actions { width: 12rem; }
    .row-actions { display: flex; gap: var(--spacing-xs); flex-wrap: wrap; }

    .cell-mono {
      font-family: var(--font-family-mono);
      font-weight: var(--font-weight-medium);
      color: var(--text-primary);
    }

    .dialog-form { display: flex; flex-direction: column; gap: var(--spacing-base); }
    .dialog-form__field { display: flex; flex-direction: column; gap: var(--spacing-xs); }
    .dialog-form__field label { font-size: var(--font-size-sm); }
    .dialog-form__row { display: flex; flex-wrap: wrap; gap: var(--spacing-base); }
    .dialog-form__row .dialog-form__field { flex: 1 1 160px; }

    @media (max-width: 576px) {
      .filters__field { flex: 1 1 100%; }
    }
  `]
})
export class FirListComponent implements OnInit {
  firList: FIR[] = [];
  loading = false;
  error = false;
  saving = false;
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
  private lastLoadEvent: any = { first: 0, rows: this.pageSize };

  constructor(
    private firService: FirService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService,
    private exportService: ExportService
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
    this.error = false;
    this.lastLoadEvent = event;
    const page = Math.floor(event.first / event.rows) + 1;
    this.currentPage = page;

    this.firService.getFIRList(page, event.rows, this.selectedStato || undefined).subscribe({
      next: (response) => {
        this.firList = response.items;
        this.totalRecords = response.total;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.error = true;
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: 'Errore nel caricamento dei FIR'
        });
      }
    });
  }

  onSearch(): void {
    // Implement search logic
    this.loadFIRList({ first: 0, rows: this.pageSize });
  }

  onFilterChange(): void {
    this.loadFIRList({ first: 0, rows: this.pageSize });
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

  reload(): void {
    this.loadFIRList(this.lastLoadEvent);
  }

  getStatoLabel(stato: FIRStato): string {
    return this.statoOptions.find((o) => o.value === stato)?.label ?? stato;
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
