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
import { CardModule } from 'primeng/card';
import { RegistryService, CreateProduttoreDto } from './registry.service';
import { Produttore } from '../../shared/models/registry.model';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader.component';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { ErrorStateComponent } from '../../shared/components/error-state.component';

@Component({
  selector: 'app-produttori-list-enhanced',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    InputTextModule,
    DialogModule,
    ConfirmDialogModule,
    CardModule,
    SkeletonLoaderComponent,
    EmptyStateComponent,
    ErrorStateComponent
  ],
  providers: [ConfirmationService],
  template: `
    <div class="registry-list">
      <!-- Page Header -->
      <div class="page-header">
        <div>
          <h1 class="page-title">Produttori</h1>
          <p class="page-subtitle">Anagrafica produttori rifiuti</p>
        </div>
        <p-button
          label="Nuovo Produttore"
          icon="pi pi-plus"
          (onClick)="showCreateDialog()"
          aria-label="Crea nuovo produttore"
        />
      </div>

      <!-- Error State -->
      <app-error-state
        *ngIf="error && !loading"
        title="Errore nel caricamento dei produttori"
        [message]="error"
        (retry)="loadProduttori({ first: 0, rows: pageSize })"
      />

      <!-- Loading State -->
      <app-skeleton-loader *ngIf="loading && produttori.length === 0" variant="table" [rows]="10" />

      <!-- Desktop Table View -->
      <div class="desktop-view" *ngIf="!loading && !error">
        <p-table
          [value]="produttori"
          [paginator]="true"
          [rows]="pageSize"
          [totalRecords]="totalRecords"
          [lazy]="true"
          (onLazyLoad)="loadProduttori($event)"
          responsiveLayout="scroll"
          styleClass="modern-table"
          [rowsPerPageOptions]="[10, 25, 50]"
        >
          <ng-template pTemplate="header">
            <tr>
              <th scope="col">Ragione Sociale</th>
              <th scope="col">Partita IVA</th>
              <th scope="col">Sede Legale</th>
              <th scope="col">PEC</th>
              <th scope="col" class="actions-col">Azioni</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-produttore>
            <tr>
              <td>
                <span class="font-semibold">{{ produttore.ragioneSociale }}</span>
              </td>
              <td>
                <span class="piva-code">{{ produttore.partitaIVA }}</span>
              </td>
              <td>{{ formatIndirizzo(produttore.sedeLegale) }}</td>
              <td>
                <span class="email">{{ produttore.pec || 'N/A' }}</span>
              </td>
              <td>
                <div class="action-buttons">
                  <p-button
                    icon="pi pi-pencil"
                    [rounded]="true"
                    [text]="true"
                    (onClick)="editProduttore(produttore)"
                    pTooltip="Modifica"
                    aria-label="Modifica produttore"
                  />
                  <p-button
                    icon="pi pi-trash"
                    [rounded]="true"
                    [text]="true"
                    severity="danger"
                    (onClick)="deleteProduttore(produttore)"
                    pTooltip="Elimina"
                    aria-label="Elimina produttore"
                  />
                </div>
              </td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="5">
                <app-empty-state
                  icon="pi-building"
                  title="Nessun produttore trovato"
                  message="Non ci sono produttori registrati. Crea il primo produttore per iniziare."
                  actionLabel="Crea Produttore"
                  actionIcon="pi pi-plus"
                  (action)="showCreateDialog()"
                />
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>

      <!-- Mobile Card View -->
      <div class="mobile-view" *ngIf="!loading && !error">
        <app-empty-state
          *ngIf="produttori.length === 0"
          icon="pi-building"
          title="Nessun produttore"
          message="Crea il primo produttore"
          actionLabel="Crea Produttore"
          (action)="showCreateDialog()"
        />

        <div class="registry-cards" *ngIf="produttori.length > 0">
          <p-card *ngFor="let produttore of produttori" styleClass="registry-card">
            <div class="card-header">
              <h3 class="card-title">{{ produttore.ragioneSociale }}</h3>
              <span class="piva-badge">P.IVA {{ produttore.partitaIVA }}</span>
            </div>

            <div class="card-content">
              <div class="card-row">
                <i class="pi pi-map-marker"></i>
                <span>{{ formatIndirizzo(produttore.sedeLegale) }}</span>
              </div>
              <div class="card-row" *ngIf="produttore.pec">
                <i class="pi pi-envelope"></i>
                <span>{{ produttore.pec }}</span>
              </div>
            </div>

            <div class="card-actions">
              <p-button
                label="Modifica"
                icon="pi pi-pencil"
                [outlined]="true"
                (onClick)="editProduttore(produttore)"
                styleClass="w-full"
              />
              <p-button
                label="Elimina"
                icon="pi pi-trash"
                severity="danger"
                [text]="true"
                (onClick)="deleteProduttore(produttore)"
                styleClass="w-full"
              />
            </div>
          </p-card>
        </div>
      </div>

      <!-- Create/Edit Dialog -->
      <p-dialog
        [(visible)]="displayDialog"
        [modal]="true"
        [style]="{ width: '90vw', maxWidth: '700px' }"
        [header]="editMode ? 'Modifica Produttore' : 'Nuovo Produttore'"
        [closable]="true"
      >
        <form class="registry-form">
          <div class="form-section">
            <h3 class="section-title">Dati Aziendali</h3>
            <div class="form-grid">
              <div class="form-field span-2">
                <label for="ragione-sociale" class="field-label">
                  Ragione Sociale <span class="required">*</span>
                </label>
                <input
                  pInputText
                  id="ragione-sociale"
                  [(ngModel)]="formData.ragioneSociale"
                  name="ragioneSociale"
                  class="w-full"
                  placeholder="es. Azienda SRL"
                  required
                />
              </div>

              <div class="form-field">
                <label for="partita-iva" class="field-label">
                  Partita IVA <span class="required">*</span>
                </label>
                <input
                  pInputText
                  id="partita-iva"
                  [(ngModel)]="formData.partitaIVA"
                  name="partitaIVA"
                  placeholder="11 cifre"
                  class="w-full"
                  maxlength="11"
                  required
                />
              </div>

              <div class="form-field">
                <label for="pec" class="field-label">PEC</label>
                <input
                  pInputText
                  id="pec"
                  [(ngModel)]="formData.pec"
                  name="pec"
                  type="email"
                  class="w-full"
                  placeholder="pec@esempio.it"
                />
              </div>
            </div>
          </div>

          <div class="form-section">
            <h3 class="section-title">Sede Legale</h3>
            <div class="form-grid">
              <div class="form-field span-2">
                <label for="via" class="field-label">
                  Via <span class="required">*</span>
                </label>
                <input
                  pInputText
                  id="via"
                  [(ngModel)]="formData.sedeLegale.via"
                  name="via"
                  class="w-full"
                  placeholder="es. Via Roma"
                  required
                />
              </div>

              <div class="form-field">
                <label for="civico" class="field-label">
                  Civico <span class="required">*</span>
                </label>
                <input
                  pInputText
                  id="civico"
                  [(ngModel)]="formData.sedeLegale.civico"
                  name="civico"
                  class="w-full"
                  placeholder="es. 123"
                  required
                />
              </div>

              <div class="form-field">
                <label for="cap" class="field-label">
                  CAP <span class="required">*</span>
                </label>
                <input
                  pInputText
                  id="cap"
                  [(ngModel)]="formData.sedeLegale.cap"
                  name="cap"
                  placeholder="5 cifre"
                  class="w-full"
                  maxlength="5"
                  required
                />
              </div>

              <div class="form-field">
                <label for="comune" class="field-label">
                  Comune <span class="required">*</span>
                </label>
                <input
                  pInputText
                  id="comune"
                  [(ngModel)]="formData.sedeLegale.comune"
                  name="comune"
                  class="w-full"
                  placeholder="es. Milano"
                  required
                />
              </div>

              <div class="form-field">
                <label for="provincia" class="field-label">
                  Provincia <span class="required">*</span>
                </label>
                <input
                  pInputText
                  id="provincia"
                  [(ngModel)]="formData.sedeLegale.provincia"
                  name="provincia"
                  placeholder="2 lettere"
                  class="w-full"
                  maxlength="2"
                  style="text-transform: uppercase"
                  required
                />
              </div>
            </div>
          </div>
        </form>

        <ng-template pTemplate="footer">
          <div class="dialog-footer">
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
          </div>
        </ng-template>
      </p-dialog>

      <p-confirmDialog />
    </div>
  `,
  styles: [`
    .registry-list {
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
      color: var(--text-primary, #1f2937);
    }

    .page-subtitle {
      margin: 0;
      font-size: var(--font-size-base, 1rem);
      color: var(--text-secondary, #6b7280);
    }

    /* Modern Table */
    :host ::ng-deep .modern-table {
      border: 1px solid var(--gray-200, #e5e7eb);
      border-radius: var(--border-radius-lg, 12px);
      overflow: hidden;
    }

    :host ::ng-deep .modern-table .p-datatable-thead > tr > th {
      background: var(--gray-50, #f9fafb);
      color: var(--text-primary, #1f2937);
      font-weight: var(--font-weight-semibold, 600);
      font-size: var(--font-size-sm, 0.875rem);
      padding: var(--spacing-md, 1rem);
      border-bottom: 2px solid var(--gray-200, #e5e7eb);
    }

    :host ::ng-deep .modern-table .p-datatable-tbody > tr > td {
      padding: var(--spacing-md, 1rem);
      font-size: var(--font-size-sm, 0.875rem);
    }

    .piva-code {
      font-family: 'Courier New', monospace;
      background: var(--gray-100, #f3f4f6);
      padding: 4px 8px;
      border-radius: var(--border-radius-sm, 4px);
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
    }

    .email {
      color: var(--brand-accent, #0277bd);
    }

    .action-buttons {
      display: flex;
      gap: var(--spacing-xs, 0.5rem);
      justify-content: flex-end;
    }

    .actions-col {
      width: 120px;
    }

    /* Mobile View */
    .desktop-view {
      display: block;
    }

    .mobile-view {
      display: none;
    }

    .registry-cards {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md, 1rem);
    }

    :host ::ng-deep .registry-card {
      border: 1px solid var(--gray-200, #e5e7eb);
      border-radius: var(--border-radius-lg, 12px);
      transition: box-shadow 0.2s ease;
    }

    :host ::ng-deep .registry-card:hover {
      box-shadow: var(--shadow-lg);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: var(--spacing-md, 1rem);
      padding-bottom: var(--spacing-md, 1rem);
      border-bottom: 1px solid var(--gray-200, #e5e7eb);
    }

    .card-title {
      margin: 0;
      font-size: var(--font-size-lg, 1.125rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--text-primary, #1f2937);
    }

    .piva-badge {
      background: var(--brand-primary, #2e7d32);
      color: white;
      padding: 4px 12px;
      border-radius: var(--border-radius-full, 9999px);
      font-size: var(--font-size-xs, 0.75rem);
      font-weight: var(--font-weight-semibold, 600);
    }

    .card-content {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm, 0.75rem);
      margin-bottom: var(--spacing-lg, 1.5rem);
    }

    .card-row {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-sm, 0.75rem);
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--text-secondary, #6b7280);
    }

    .card-row i {
      color: var(--brand-primary, #2e7d32);
      margin-top: 2px;
    }

    .card-actions {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm, 0.75rem);
    }

    /* Form Styles */
    .registry-form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xl, 1.75rem);
    }

    .form-section {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md, 1rem);
    }

    .section-title {
      margin: 0;
      font-size: var(--font-size-base, 1rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--text-primary, #1f2937);
      padding-bottom: var(--spacing-sm, 0.75rem);
      border-bottom: 1px solid var(--gray-200, #e5e7eb);
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-md, 1rem);
    }

    .form-field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xs, 0.5rem);
    }

    .form-field.span-2 {
      grid-column: span 2;
    }

    .field-label {
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--text-primary, #1f2937);
    }

    .required {
      color: var(--error-color, #dc2626);
    }

    :host ::ng-deep .p-inputtext {
      padding: 10px 12px;
      font-size: var(--font-size-sm, 0.875rem);
      border-radius: var(--border-radius-md, 8px);
      border: 1px solid var(--gray-300, #d1d5db);
      transition: all 0.2s ease;
    }

    :host ::ng-deep .p-inputtext:focus {
      border-color: var(--brand-primary, #2e7d32);
      box-shadow: 0 0 0 3px rgba(46, 125, 50, 0.1);
    }

    .dialog-footer {
      display: flex;
      gap: var(--spacing-sm, 0.75rem);
      justify-content: flex-end;
    }

    /* Responsive */
    @media (max-width: 768px) {
      .page-header {
        flex-direction: column;
        align-items: stretch;
      }

      .page-header ::ng-deep .p-button {
        width: 100%;
      }

      .desktop-view {
        display: none;
      }

      .mobile-view {
        display: block;
      }

      .form-grid {
        grid-template-columns: 1fr;
      }

      .form-field.span-2 {
        grid-column: span 1;
      }
    }

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
      .registry-list,
      :host ::ng-deep .registry-card {
        animation: none;
        transition: none;
      }
    }
  `]
})
export class ProduttoriListEnhancedComponent implements OnInit {
  produttori: Produttore[] = [];
  loading = false;
  saving = false;
  error = '';
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
    this.error = '';
    const page = Math.floor(event.first / event.rows) + 1;
    this.currentPage = page;

    this.registryService.getProduttori(page, event.rows).subscribe({
      next: (response) => {
        this.produttori = response.items;
        this.totalRecords = response.total;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message || 'Errore nel caricamento dei produttori';
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: this.error
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

  formatIndirizzo(indirizzo: any): string {
    if (!indirizzo) return 'N/A';
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
