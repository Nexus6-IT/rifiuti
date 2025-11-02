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
import { RegistryService, CreateDestinatarioDto } from './registry.service';
import { Destinatario, Indirizzo } from '../../shared/models/registry.model';

@Component({
  selector: 'app-destinatari-list',
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
        <h1>Destinatari</h1>
        <p-button
          label="Nuovo Destinatario"
          icon="pi pi-plus"
          (onClick)="showCreateDialog()"
        />
      </div>

      <!-- Destinatari Table -->
      <p-table
        [value]="destinatari"
        [loading]="loading"
        [paginator]="true"
        [rows]="pageSize"
        [totalRecords]="totalRecords"
        [lazy]="true"
        (onLazyLoad)="loadDestinatari($event)"
        responsiveLayout="scroll"
      >
        <ng-template pTemplate="header">
          <tr>
            <th>Ragione Sociale</th>
            <th>Partita IVA</th>
            <th>N. Autorizzazione</th>
            <th>Sede</th>
            <th>PEC</th>
            <th style="width: 120px">Azioni</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-destinatario>
          <tr>
            <td>{{ destinatario.ragioneSociale }}</td>
            <td>{{ destinatario.partitaIVA }}</td>
            <td>{{ destinatario.numeroAutorizzazione }}</td>
            <td>{{ formatIndirizzo(destinatario.sede) }}</td>
            <td>{{ destinatario.pec || 'N/A' }}</td>
            <td>
              <div class="flex gap-2">
                <p-button
                  icon="pi pi-pencil"
                  [rounded]="true"
                  [text]="true"
                  (onClick)="editDestinatario(destinatario)"
                  pTooltip="Modifica"
                />
                <p-button
                  icon="pi pi-trash"
                  [rounded]="true"
                  [text]="true"
                  severity="danger"
                  (onClick)="deleteDestinatario(destinatario)"
                  pTooltip="Elimina"
                />
              </div>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="6" class="text-center">Nessun destinatario trovato</td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Create/Edit Dialog -->
      <p-dialog
        [(visible)]="displayDialog"
        [modal]="true"
        [style]="{ width: '700px' }"
        [header]="editMode ? 'Modifica Destinatario' : 'Nuovo Destinatario'"
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
            <label class="block mb-2">Numero Autorizzazione *</label>
            <input
              pInputText
              [(ngModel)]="formData.numeroAutorizzazione"
              class="w-full"
            />
          </div>
          <div class="col-12">
            <label class="block mb-2">PEC</label>
            <input
              pInputText
              [(ngModel)]="formData.pec"
              type="email"
              class="w-full"
            />
          </div>

          <div class="col-12">
            <h4>Sede</h4>
          </div>
          <div class="col-12 md:col-8">
            <label class="block mb-2">Via *</label>
            <input
              pInputText
              [(ngModel)]="formData.sede.via"
              class="w-full"
            />
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">Civico *</label>
            <input
              pInputText
              [(ngModel)]="formData.sede.civico"
              class="w-full"
            />
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">CAP *</label>
            <input
              pInputText
              [(ngModel)]="formData.sede.cap"
              placeholder="5 cifre"
              class="w-full"
            />
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">Comune *</label>
            <input
              pInputText
              [(ngModel)]="formData.sede.comune"
              class="w-full"
            />
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">Provincia *</label>
            <input
              pInputText
              [(ngModel)]="formData.sede.provincia"
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
            (onClick)="saveDestinatario()"
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
export class DestinatariListComponent implements OnInit {
  destinatari: Destinatario[] = [];
  loading = false;
  saving = false;
  totalRecords = 0;
  pageSize = 10;
  currentPage = 1;

  displayDialog = false;
  editMode = false;
  selectedDestinatario: Destinatario | null = null;

  formData: CreateDestinatarioDto = this.getEmptyFormData();

  constructor(
    private registryService: RegistryService,
    private messageService: MessageService,
    private confirmationService: ConfirmationService
  ) {}

  ngOnInit(): void {
    this.loadDestinatari({ first: 0, rows: this.pageSize });
  }

  loadDestinatari(event: any): void {
    this.loading = true;
    const page = Math.floor(event.first / event.rows) + 1;
    this.currentPage = page;

    this.registryService.getDestinatari(page, event.rows).subscribe({
      next: (response) => {
        this.destinatari = response.items;
        this.totalRecords = response.total;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: 'Errore nel caricamento dei destinatari'
        });
      }
    });
  }

  showCreateDialog(): void {
    this.editMode = false;
    this.selectedDestinatario = null;
    this.formData = this.getEmptyFormData();
    this.displayDialog = true;
  }

  editDestinatario(destinatario: Destinatario): void {
    this.editMode = true;
    this.selectedDestinatario = destinatario;
    this.formData = {
      ragioneSociale: destinatario.ragioneSociale,
      partitaIVA: destinatario.partitaIVA,
      numeroAutorizzazione: destinatario.numeroAutorizzazione,
      sede: { ...destinatario.sede },
      pec: destinatario.pec
    };
    this.displayDialog = true;
  }

  saveDestinatario(): void {
    if (!this.validateForm()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Attenzione',
        detail: 'Compila tutti i campi obbligatori'
      });
      return;
    }

    this.saving = true;
    const operation = this.editMode && this.selectedDestinatario
      ? this.registryService.updateDestinatario(this.selectedDestinatario.id, this.formData)
      : this.registryService.createDestinatario(this.formData);

    operation.subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Successo',
          detail: this.editMode ? 'Destinatario aggiornato' : 'Destinatario creato'
        });
        this.displayDialog = false;
        this.saving = false;
        this.loadDestinatari({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize });
      },
      error: () => {
        this.saving = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: 'Errore nel salvataggio del destinatario'
        });
      }
    });
  }

  deleteDestinatario(destinatario: Destinatario): void {
    this.confirmationService.confirm({
      message: `Sei sicuro di voler eliminare ${destinatario.ragioneSociale}?`,
      header: 'Conferma Eliminazione',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.registryService.deleteDestinatario(destinatario.id).subscribe({
          next: () => {
            this.messageService.add({
              severity: 'success',
              summary: 'Successo',
              detail: 'Destinatario eliminato'
            });
            this.loadDestinatari({ first: (this.currentPage - 1) * this.pageSize, rows: this.pageSize });
          },
          error: () => {
            this.messageService.add({
              severity: 'error',
              summary: 'Errore',
              detail: 'Errore nell\'eliminazione del destinatario'
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
      this.formData.numeroAutorizzazione?.trim() &&
      this.formData.sede.via?.trim() &&
      this.formData.sede.civico?.trim() &&
      this.formData.sede.cap?.trim() &&
      this.formData.sede.comune?.trim() &&
      this.formData.sede.provincia?.trim()
    );
  }

  formatIndirizzo(indirizzo: Indirizzo): string {
    return `${indirizzo.via} ${indirizzo.civico}, ${indirizzo.cap} ${indirizzo.comune} (${indirizzo.provincia})`;
  }

  private getEmptyFormData(): CreateDestinatarioDto {
    return {
      ragioneSociale: '',
      partitaIVA: '',
      numeroAutorizzazione: '',
      sede: {
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
