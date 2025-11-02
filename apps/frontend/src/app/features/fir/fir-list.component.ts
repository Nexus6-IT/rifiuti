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
import { MenuItem } from 'primeng/api';
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
    SplitButtonModule
  ],
  providers: [ConfirmationService],
  template: `
    <div class="fir-list">
      <div class="flex justify-content-between align-items-center mb-4">
        <h1>Gestione FIR</h1>
        <div class="flex gap-2">
          <p-splitButton
            label="Esporta"
            icon="pi pi-download"
            [model]="exportMenuItems"
            [outlined]="true"
          />
          <p-button
            label="Nuovo FIR"
            icon="pi pi-plus"
            (onClick)="showCreateDialog()"
          />
        </div>
      </div>

      <!-- Filters -->
      <div class="card mb-4">
        <div class="grid p-3">
          <div class="col-12 md:col-4">
            <label class="block mb-2">Cerca</label>
            <input
              pInputText
              [(ngModel)]="searchText"
              placeholder="Cerca per numero..."
              class="w-full"
              (input)="onSearch()"
            />
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">Filtra per Stato</label>
            <p-dropdown
              [options]="statoOptions"
              [(ngModel)]="selectedStato"
              placeholder="Tutti gli stati"
              [showClear]="true"
              (onChange)="onFilterChange()"
              styleClass="w-full"
            />
          </div>
        </div>
      </div>

      <!-- FIR Table -->
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
      >
        <ng-template pTemplate="header">
          <tr>
            <th>Numero</th>
            <th>Anno</th>
            <th>CER</th>
            <th>Quantità</th>
            <th>Stato</th>
            <th>Data Creazione</th>
            <th class="w-12rem">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-fir>
          <tr>
            <td>{{ fir.numeroProgressivo || 'N/A' }}</td>
            <td>{{ fir.anno }}</td>
            <td>{{ fir.rifiuto.cerCode }}</td>
            <td>{{ fir.rifiuto.quantitaDichiarata }} {{ fir.rifiuto.unitaMisura }}</td>
            <td>
              <p-tag
                [value]="fir.stato"
                [severity]="getStatoSeverity(fir.stato)"
              />
            </td>
            <td>{{ fir.createdAt | date: 'dd/MM/yyyy HH:mm' }}</td>
            <td>
              <div class="flex gap-2">
                <p-button
                  *ngIf="fir.stato === 'BOZZA'"
                  icon="pi pi-send"
                  [rounded]="true"
                  [text]="true"
                  severity="info"
                  (onClick)="emettiFIR(fir)"
                  pTooltip="Emetti"
                />
                <p-button
                  *ngIf="fir.stato === 'EMESSO'"
                  icon="pi pi-truck"
                  [rounded]="true"
                  [text]="true"
                  severity="warning"
                  (onClick)="presaInCarico(fir)"
                  pTooltip="Presa in Carico"
                />
                <p-button
                  *ngIf="fir.stato === 'IN_TRANSITO'"
                  icon="pi pi-check"
                  [rounded]="true"
                  [text]="true"
                  severity="success"
                  (onClick)="showConsegnaDialog(fir)"
                  pTooltip="Consegna"
                />
                <p-button
                  icon="pi pi-trash"
                  [rounded]="true"
                  [text]="true"
                  severity="danger"
                  (onClick)="deleteFIR(fir)"
                  pTooltip="Elimina"
                />
              </div>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="7" class="text-center">Nessun FIR trovato</td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Create FIR Dialog -->
      <p-dialog
        [(visible)]="displayCreateDialog"
        [modal]="true"
        styleClass="w-full max-w-30rem"
        header="Nuovo FIR"
      >
        <div class="grid">
          <div class="col-12">
            <label class="block mb-2">Anno</label>
            <p-inputNumber
              [(ngModel)]="newFIR.anno"
              [useGrouping]="false"
              [min]="2020"
              [max]="2030"
              styleClass="w-full"
            />
          </div>
          <div class="col-12">
            <label class="block mb-2">Codice CER</label>
            <input
              pInputText
              [(ngModel)]="newFIR.rifiuto.cerCode"
              placeholder="es. 150101"
              class="w-full"
            />
          </div>
          <div class="col-12 md:col-6">
            <label class="block mb-2">Quantità Dichiarata</label>
            <p-inputNumber
              [(ngModel)]="newFIR.rifiuto.quantitaDichiarata"
              [minFractionDigits]="2"
              styleClass="w-full"
            />
          </div>
          <div class="col-12 md:col-6">
            <label class="block mb-2">Unità di Misura</label>
            <p-dropdown
              [options]="unitaMisuraOptions"
              [(ngModel)]="newFIR.rifiuto.unitaMisura"
              placeholder="Seleziona"
              styleClass="w-full"
            />
          </div>
          <div class="col-12">
            <label class="block mb-2">Produttore ID</label>
            <input
              pInputText
              [(ngModel)]="newFIR.produttoreId"
              class="w-full"
            />
          </div>
          <div class="col-12">
            <label class="block mb-2">Trasportatore ID</label>
            <input
              pInputText
              [(ngModel)]="newFIR.trasportatoreId"
              class="w-full"
            />
          </div>
          <div class="col-12">
            <label class="block mb-2">Destinatario ID</label>
            <input
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
        <div class="field">
          <label class="block mb-2">Peso Effettivo (kg)</label>
          <p-inputNumber
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
  styles: []
})
export class FirListComponent implements OnInit {
  firList: FIR[] = [];
  loading = false;
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
