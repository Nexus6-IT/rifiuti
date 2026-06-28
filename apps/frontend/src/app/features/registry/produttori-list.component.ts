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
import { TooltipModule } from 'primeng/tooltip';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
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
    ConfirmDialogModule,
    TooltipModule,
    ProgressSpinnerModule,
    MessageModule,
    IconFieldModule,
    InputIconModule
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page">
      <!-- Intestazione pagina -->
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Produttori</h1>
          <p class="page-subtitle">Anagrafica dei produttori di rifiuti</p>
        </div>
        <div class="page-actions">
          <p-button
            label="Nuovo produttore"
            icon="pi pi-plus"
            (onClick)="showCreateDialog()"
            ariaLabel="Crea nuovo produttore"
          />
        </div>
      </header>

      <section class="surface-card registry-panel" aria-label="Elenco produttori">
        <!-- Toolbar di ricerca -->
        <div class="registry-toolbar">
          <p-iconField iconPosition="left" class="registry-search">
            <p-inputIcon><i class="pi pi-search" aria-hidden="true"></i></p-inputIcon>
            <input
              pInputText
              type="text"
              [(ngModel)]="searchTerm"
              placeholder="Cerca per ragione sociale, P.IVA, sede…"
              aria-label="Cerca tra i produttori (filtra la pagina corrente)"
              class="w-full"
            />
          </p-iconField>
          <span class="registry-count" aria-live="polite">
            {{ totalRecords ?? 0 }} {{ (totalRecords ?? 0) === 1 ? 'produttore' : 'produttori' }}
          </span>
        </div>

        <!-- Stato errore -->
        <p-message
          *ngIf="error && !loading"
          severity="error"
          [text]="error"
          styleClass="w-full mb-3"
        />

        <!-- Tabella -->
        <div class="table-responsive">
          <p-table
            #dt
            [value]="filteredProduttori"
            [loading]="loading"
            [paginator]="true"
            [rows]="pageSize"
            [totalRecords]="totalRecords"
            [lazy]="true"
            (onLazyLoad)="loadProduttori($event)"
            [rowsPerPageOptions]="[10, 25, 50]"
            currentPageReportTemplate="{first}-{last} di {totalRecords}"
            [showCurrentPageReport]="totalRecords > 0"
            responsiveLayout="scroll"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Ragione sociale</th>
                <th scope="col">Partita IVA</th>
                <th scope="col">Sede legale</th>
                <th scope="col">PEC</th>
                <th scope="col" style="width: 7.5rem">Azioni</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-produttore>
              <tr>
                <td>
                  <span class="cell-label">Ragione sociale</span>
                  <span class="font-semibold">{{ produttore.ragioneSociale }}</span>
                </td>
                <td>
                  <span class="cell-label">Partita IVA</span>
                  <span class="mono">{{ produttore.partitaIVA }}</span>
                </td>
                <td>
                  <span class="cell-label">Sede legale</span>
                  {{ formatIndirizzo(produttore.sedeLegale) }}
                </td>
                <td>
                  <span class="cell-label">PEC</span>
                  <span [class.text-tertiary]="!produttore.pec">{{ produttore.pec || 'Non indicata' }}</span>
                </td>
                <td>
                  <span class="cell-label">Azioni</span>
                  <div class="row-actions">
                    <p-button
                      icon="pi pi-pencil"
                      [rounded]="true"
                      [text]="true"
                      (onClick)="editProduttore(produttore)"
                      pTooltip="Modifica"
                      tooltipPosition="top"
                      [ariaLabel]="'Modifica ' + produttore.ragioneSociale"
                    />
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="deleteProduttore(produttore)"
                      pTooltip="Elimina"
                      tooltipPosition="top"
                      [ariaLabel]="'Elimina ' + produttore.ragioneSociale"
                    />
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="5">
                  <div class="empty-state">
                    <i class="pi pi-building empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessun produttore trovato</p>
                    <p>Crea il primo produttore per iniziare a registrare i rifiuti.</p>
                    <p-button
                      label="Nuovo produttore"
                      icon="pi pi-plus"
                      (onClick)="showCreateDialog()"
                      ariaLabel="Crea nuovo produttore"
                    />
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="loadingbody">
              <tr>
                <td colspan="5">
                  <div class="loading-row">
                    <p-progressSpinner styleClass="loading-spinner" strokeWidth="4" aria-label="Caricamento in corso" />
                    <span>Caricamento produttori…</span>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>

      <!-- Dialog crea/modifica -->
      <p-dialog
        [(visible)]="displayDialog"
        [modal]="true"
        [draggable]="false"
        [style]="{ width: '46rem' }"
        [breakpoints]="{ '768px': '95vw' }"
        [header]="editMode ? 'Modifica produttore' : 'Nuovo produttore'"
        [dismissableMask]="true"
      >
        <form class="dialog-form" (ngSubmit)="saveProduttore()">
          <fieldset class="form-fieldset">
            <legend class="form-legend">Dati aziendali</legend>
            <div class="grid formgrid p-fluid">
              <div class="field col-12">
                <label for="prod-ragione">Ragione sociale <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="prod-ragione" name="ragioneSociale" [(ngModel)]="formData.ragioneSociale"
                       placeholder="es. Azienda S.r.l." required autocomplete="organization" />
              </div>
              <div class="field col-12 md:col-6">
                <label for="prod-piva">Partita IVA <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="prod-piva" name="partitaIVA" [(ngModel)]="formData.partitaIVA"
                       placeholder="11 cifre" maxlength="11" inputmode="numeric" required />
              </div>
              <div class="field col-12 md:col-6">
                <label for="prod-pec">PEC</label>
                <input pInputText id="prod-pec" name="pec" type="email" [(ngModel)]="formData.pec"
                       placeholder="pec@esempio.it" autocomplete="email" />
              </div>
            </div>
          </fieldset>

          <fieldset class="form-fieldset">
            <legend class="form-legend">Sede legale</legend>
            <div class="grid formgrid p-fluid">
              <div class="field col-12 md:col-8">
                <label for="prod-via">Via <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="prod-via" name="via" [(ngModel)]="formData.sedeLegale.via"
                       placeholder="es. Via Roma" required autocomplete="address-line1" />
              </div>
              <div class="field col-12 md:col-4">
                <label for="prod-civico">Civico <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="prod-civico" name="civico" [(ngModel)]="formData.sedeLegale.civico"
                       placeholder="es. 12" required />
              </div>
              <div class="field col-12 md:col-4">
                <label for="prod-cap">CAP <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="prod-cap" name="cap" [(ngModel)]="formData.sedeLegale.cap"
                       placeholder="5 cifre" maxlength="5" inputmode="numeric" required autocomplete="postal-code" />
              </div>
              <div class="field col-12 md:col-4">
                <label for="prod-comune">Comune <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="prod-comune" name="comune" [(ngModel)]="formData.sedeLegale.comune"
                       placeholder="es. Milano" required autocomplete="address-level2" />
              </div>
              <div class="field col-12 md:col-4">
                <label for="prod-prov">Provincia <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="prod-prov" name="provincia" [(ngModel)]="formData.sedeLegale.provincia"
                       placeholder="es. MI" maxlength="2" style="text-transform: uppercase" required />
              </div>
            </div>
          </fieldset>
        </form>

        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" icon="pi pi-times" (onClick)="displayDialog = false" />
          <p-button label="Salva" icon="pi pi-check" (onClick)="saveProduttore()" [loading]="saving" />
        </ng-template>
      </p-dialog>

      <p-confirmDialog />
    </div>
  `,
  styles: [`
    .registry-panel { padding: 0; overflow: hidden; }

    .registry-toolbar {
      display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-base);
      padding: var(--spacing-base) var(--spacing-lg);
      border-bottom: 1px solid var(--surface-border);
    }
    .registry-search { flex: 1 1 18rem; min-width: 0; display: block; }
    .registry-search .w-full { width: 100%; }
    /* Spazio a sinistra: evita che l'icona lente si sovrapponga a placeholder/testo */
    .registry-search input { padding-left: 2.5rem; }
    .registry-count {
      font-size: var(--font-size-sm); color: var(--text-tertiary);
      font-weight: var(--font-weight-medium); white-space: nowrap;
    }

    .table-responsive { border-radius: 0; }
    :host ::ng-deep .p-datatable { border: none; border-radius: 0; }

    .mono { font-family: var(--font-family-mono); font-size: var(--font-size-sm); }
    .row-actions { display: flex; gap: var(--spacing-xs); justify-content: flex-end; }

    /* Etichette riga per la vista impilata su mobile (nascoste su desktop) */
    .cell-label { display: none; font-weight: var(--font-weight-semibold); color: var(--text-tertiary);
      font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.15rem; }

    .loading-row { display: flex; align-items: center; justify-content: center; gap: var(--spacing-md);
      padding: var(--spacing-2xl); color: var(--text-tertiary); }
    :host ::ng-deep .loading-spinner { width: 2.25rem; height: 2.25rem; }

    .empty-state__icon { font-size: 2.75rem; }

    /* Form dialog */
    .dialog-form { display: flex; flex-direction: column; gap: var(--spacing-lg); }
    .form-fieldset { border: none; padding: 0; margin: 0; }
    .form-legend {
      font-family: var(--font-display); font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-base); color: var(--text-primary);
      padding: 0 0 var(--spacing-sm); margin-bottom: var(--spacing-sm);
      border-bottom: 1px solid var(--surface-border); width: 100%;
    }
    .field { margin-bottom: var(--spacing-base); }
    .field label { display: block; margin-bottom: var(--spacing-xs); }
    .req { color: var(--color-danger); margin-left: 0.15rem; }

    /* Vista a card impilata su mobile */
    @media (max-width: 768px) {
      :host ::ng-deep .p-datatable .p-datatable-thead { display: none; }
      :host ::ng-deep .p-datatable .p-datatable-tbody > tr {
        display: block; padding: var(--spacing-sm) 0; border-bottom: 1px solid var(--surface-border);
      }
      :host ::ng-deep .p-datatable .p-datatable-tbody > tr > td {
        display: block; border: none; padding: 0.35rem var(--spacing-base);
      }
      .cell-label { display: block; }
      .row-actions { justify-content: flex-start; padding-top: var(--spacing-xs); }
      .registry-toolbar { padding: var(--spacing-base); }
    }
  `]
})
export class ProduttoriListComponent implements OnInit {
  produttori: Produttore[] = [];
  loading = false;
  saving = false;
  error = '';
  totalRecords = 0;
  pageSize = 10;
  currentPage = 1;
  searchTerm = '';

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

  /** Filtra la pagina corrente in base al testo di ricerca (case-insensitive). */
  get filteredProduttori(): Produttore[] {
    const term = this.searchTerm?.trim().toLowerCase();
    if (!term) return this.produttori;
    return this.produttori.filter((p) =>
      [
        p.ragioneSociale,
        p.partitaIVA,
        p.pec,
        p.sedeLegale ? this.formatIndirizzo(p.sedeLegale) : ''
      ]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(term))
    );
  }

  loadProduttori(event: any): void {
    this.loading = true;
    this.error = '';
    const page = Math.floor(event.first / event.rows) + 1;
    this.currentPage = page;

    this.registryService.getProduttori(page, event.rows).subscribe({
      next: (response) => {
        this.produttori = response.items ?? [];
        this.totalRecords = response.total ?? this.produttori.length;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Errore nel caricamento dei produttori';
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

  formatIndirizzo(indirizzo: Indirizzo): string {
    if (!indirizzo) return 'N/D';
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
