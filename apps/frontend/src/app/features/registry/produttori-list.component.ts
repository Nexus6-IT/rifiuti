import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { RegistryService, CreateProduttoreDto } from './registry.service';
import { Produttore, Indirizzo } from '../../shared/models/registry.model';

@Component({
  selector: 'app-produttori-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    DialogModule,
    ConfirmDialogModule
  ],
  providers: [ConfirmationService],
  template: `
    <div class="registry-list">
      <div class="flex justify-content-between align-items-center mb-4">
        <h1>Produttori</h1>
        <p-button
          label="Nuovo Produttore"
          icon="pi pi-plus"
          (onClick)="showCreateDialog()"
        />
      </div>

      <!-- Produttori Table -->
      <p-table
        [value]="produttori"
        [loading]="loading"
        [paginator]="true"
        [rows]="pageSize"
        [totalRecords]="totalRecords"
        [lazy]="true"
        (onLazyLoad)="loadProduttori($event)"
        responsiveLayout="scroll"
      >
        <ng-template pTemplate="header">
          <tr>
            <th>Ragione Sociale</th>
            <th>Partita IVA</th>
            <th>Sede Legale</th>
            <th>PEC</th>
            <th style="width: 120px">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-produttore>
          <tr>
            <td>{{ produttore.ragioneSociale }}</td>
            <td>{{ produttore.partitaIVA }}</td>
            <td>{{ formatIndirizzo(produttore.sedeLegale) }}</td>
            <td>{{ produttore.pec || 'N/A' }}</td>
            <td>
              <div class="flex gap-2">
                <p-button
                  icon="pi pi-pencil"
                  [rounded]="true"
                  [text]="true"
                  (onClick)="editProduttore(produttore)"
                  pTooltip="Modifica"
                />
                <p-button
                  icon="pi pi-trash"
                  [rounded]="true"
                  [text]="true"
                  severity="danger"
                  (onClick)="deleteProduttore(produttore)"
                  pTooltip="Elimina"
                />
              </div>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5" class="text-center">Nessun produttore trovato</td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Create/Edit Dialog -->
      <p-dialog
        [(visible)]="displayDialog"
        [modal]="true"
        [style]="{ width: '700px' }"
        [header]="editMode ? 'Modifica Produttore' : 'Nuovo Produttore'"
      >
        <div class="grid">
          <div class="col-12">
            <label class="block mb-2">Ragione Sociale *</label>
            <input
              pInputText
              [(ngModel)]="formData.ragioneSociale"
              class="w-full"
            />
          </div>
          <div class="col-12 md:col-6">
            <label class="block mb-2">Partita IVA *</label>
            <input
              pInputText
              [(ngModel)]="formData.partitaIVA"
              placeholder="11 cifre"
              class="w-full"
            />
          </div>
          <div class="col-12 md:col-6">
            <label class="block mb-2">PEC</label>
            <input
              pInputText
              [(ngModel)]="formData.pec"
              type="email"
              class="w-full"
            />
          </div>

          <div class="col-12">
            <h4>Sede Legale</h4>
          </div>
          <div class="col-12 md:col-8">
            <label class="block mb-2">Via *</label>
            <input
              pInputText
              [(ngModel)]="formData.sedeLegale.via"
              class="w-full"
            />
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">Civico *</label>
            <input
              pInputText
              [(ngModel)]="formData.sedeLegale.civico"
              class="w-full"
            />
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">CAP *</label>
            <input
              pInputText
              [(ngModel)]="formData.sedeLegale.cap"
              placeholder="5 cifre"
              class="w-full"
            />
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">Comune *</label>
            <input
              pInputText
              [(ngModel)]="formData.sedeLegale.comune"
              class="w-full"
            />
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">Provincia *</label>
            <input
              pInputText
              [(ngModel)]="formData.sedeLegale.provincia"
              placeholder="2 lettere"
              maxlength="2"
              class="w-full"
            />
          </div>
        </div>
        <ng-template pTemplate="footer">
          <p-button
            label="Annulla"
            [text]="true"
            (onClick)="displayDialog = false"
          />
          <p-button
            label="Salva"
            (onClick)="saveProduttore()"
            [loading]="saving"
          />
        </ng-template>
      </p-dialog>

      <p-confirmDialog />
    </div>
  `,
  styles: [`
    .registry-list {
      max-width: 1400px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(12, 1fr);
      gap: 1rem;
    }

    .col-12 { grid-column: span 12; }
    .col-8 { grid-column: span 8; }
    .col-6 { grid-column: span 6; }
    .col-4 { grid-column: span 4; }

    @media (min-width: 768px) {
      .md\\:col-8 { grid-column: span 8; }
      .md\\:col-6 { grid-column: span 6; }
      .md\\:col-4 { grid-column: span 4; }
    }
  `]
})
export class ProduttoriListComponent implements OnInit {
  produttori: Produttore[] = [];
  loading = false;
  saving = false;
  totalRecords = 0;
  pageSize = 10;
  currentPage = 1;

  displayDialog = false;
  editMode = false;
  selectedProduttore: Produttore | null = null;

  formData: CreateProduttoreDto = this.getEmptyFormData();

  constructor(
    private registryService: RegistryService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {}

  ngOnInit(): void {
    this.loadProduttori({ first: 0, rows: this.pageSize });
  }

  loadProduttori(event: any): void {
    this.loading = true;
    const page = Math.floor(event.first / event.rows) + 1;
    this.currentPage = page;

    this.registryService.getProduttori(page, event.rows).subscribe({
      next: (response) => {
        this.produttori = response.items;
        this.totalRecords = response.total;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: 'Errore nel caricamento dei produttori'
        });
      }
    });
  }

  showCreateDialog(): void {
    this.editMode = false;
    this.selectedProduttore = null;
    this.formData = this.getEmptyFormData();
    this.displayDialog = true;
  }

  editProduttore(produttore: Produttore): void {
    this.editMode = true;
    this.selectedProduttore = produttore;
    this.formData = {
      ragioneSociale: produttore.ragioneSociale,
      partitaIVA: produttore.partitaIVA,
      sedeLegale: { ...produttore.sedeLegale },
      pec: produttore.pec
    };
    this.displayDialog = true;
  }

  saveProduttore(): void {
    if (!this.validateForm()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Attenzione',
        detail: 'Compila tutti i campi obbligatori'
      });
      return;
    }

    this.saving = true;
    const operation = this.editMode && this.selectedProduttore
      ? this.registryService.updateProduttore(this.selectedProduttore.id, this.formData)
      : this.registryService.createProduttore(this.formData);

    operation.subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Successo',
          detail: this.editMode ? 'Produttore aggiornato' : 'Produttore creato'
        });
        this.displayDialog = false;
        this.saving = false;
        this.loadProduttori({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize });
      },
      error: () => {
        this.saving = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: 'Errore nel salvataggio del produttore'
        });
      }
    });
  }

  deleteProduttore(produttore: Produttore): void {
    this.confirmationService.confirm({
      message: `Sei sicuro di voler eliminare ${produttore.ragioneSociale}?`,
      header: 'Conferma Eliminazione',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.registryService.deleteProduttore(produttore.id).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Successo',
              detail: 'Produttore eliminato'
            });
            this.loadProduttori({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize });
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: 'Errore nell\'eliminazione del produttore'
            });
          }
        });
      }
    });
  }

  validateForm(): boolean {
    return !!(
      this.formData.ragioneSociale?.trim() &&
      this.formData.partitaIVA?.trim() &&
      this.formData.sedeLegale.via?.trim() &&
      this.formData.sedeLegale.civico?.trim() &&
      this.formData.sedeLegale.cap?.trim() &&
      this.formData.sedeLegale.comune?.trim() &&
      this.formData.sedeLegale.provincia?.trim()
    );
  }

  formatIndirizzo(indirizzo: Indirizzo): string {
    return `${indirizzo.via} ${indirizzo.civico}, ${indirizzo.cap} ${indirizzo.comune} (${indirizzo.provincia})`;
  }

  private getEmptyFormData(): CreateProduttoreDto {
    return {
      ragioneSociale: '',
      partitaIVA: '',
      sedeLegale: {
        via: '',
        civico: '',
        cap: '',
        comune: '',
        provincia: ''
      },
      pec: ''
    };
  }
}
