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
import { TagModule } from 'primeng/tag';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
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
    ConfirmDialogModule,
    TooltipModule,
    ProgressSpinnerModule,
    MessageModule,
    TagModule,
    IconFieldModule,
    InputIconModule
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page">
      <!-- Intestazione pagina -->
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Destinatari</h1>
          <p class="page-subtitle">Anagrafica degli impianti di destinazione autorizzati</p>
        </div>
        <div class="page-actions">
          <p-button
            label="Nuovo destinatario"
            icon="pi pi-plus"
            (onClick)="showCreateDialog()"
            ariaLabel="Crea nuovo destinatario"
          />
        </div>
      </header>

      <section class="surface-card registry-panel" aria-label="Elenco destinatari">
        <!-- Toolbar di ricerca -->
        <div class="registry-toolbar">
          <p-iconField iconPosition="left" class="registry-search">
            <p-inputIcon><i class="pi pi-search" aria-hidden="true"></i></p-inputIcon>
            <input
              pInputText
              type="text"
              [(ngModel)]="searchTerm"
              placeholder="Cerca per ragione sociale, P.IVA, autorizzazione…"
              aria-label="Cerca tra i destinatari (filtra la pagina corrente)"
              class="w-full"
            />
          </p-iconField>
          <span class="registry-count" aria-live="polite">
            {{ totalRecords }} {{ totalRecords === 1 ? 'destinatario' : 'destinatari' }}
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
            [value]="filteredDestinatari"
            [loading]="loading"
            [paginator]="true"
            [rows]="pageSize"
            [totalRecords]="totalRecords"
            [lazy]="true"
            (onLazyLoad)="loadDestinatari($event)"
            [rowsPerPageOptions]="[10, 25, 50]"
            currentPageReportTemplate="{first}-{last} di {totalRecords}"
            [showCurrentPageReport]="true"
            responsiveLayout="scroll"
          >
            <ng-template pTemplate="header">
              <tr>
                <th scope="col">Ragione sociale</th>
                <th scope="col">Partita IVA</th>
                <th scope="col">N. autorizzazione</th>
                <th scope="col">Sede</th>
                <th scope="col">PEC</th>
                <th scope="col" style="width: 7.5rem">Azioni</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-destinatario>
              <tr>
                <td>
                  <span class="cell-label">Ragione sociale</span>
                  <span class="font-semibold">{{ destinatario.ragioneSociale }}</span>
                </td>
                <td>
                  <span class="cell-label">Partita IVA</span>
                  <span class="mono">{{ destinatario.partitaIVA }}</span>
                </td>
                <td>
                  <span class="cell-label">N. autorizzazione</span>
                  <p-tag [value]="destinatario.numeroAutorizzazione" severity="success" />
                </td>
                <td>
                  <span class="cell-label">Sede</span>
                  {{ formatIndirizzo(destinatario.sede) }}
                </td>
                <td>
                  <span class="cell-label">PEC</span>
                  <span [class.text-tertiary]="!destinatario.pec">{{ destinatario.pec || 'Non indicata' }}</span>
                </td>
                <td>
                  <span class="cell-label">Azioni</span>
                  <div class="row-actions">
                    <p-button
                      icon="pi pi-pencil"
                      [rounded]="true"
                      [text]="true"
                      (onClick)="editDestinatario(destinatario)"
                      pTooltip="Modifica"
                      tooltipPosition="top"
                      [ariaLabel]="'Modifica ' + destinatario.ragioneSociale"
                    />
                    <p-button
                      icon="pi pi-trash"
                      [rounded]="true"
                      [text]="true"
                      severity="danger"
                      (onClick)="deleteDestinatario(destinatario)"
                      pTooltip="Elimina"
                      tooltipPosition="top"
                      [ariaLabel]="'Elimina ' + destinatario.ragioneSociale"
                    />
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="6">
                  <div class="empty-state">
                    <i class="pi pi-map-marker empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessun destinatario trovato</p>
                    <p>Crea il primo impianto di destinazione per associarlo ai formulari.</p>
                    <p-button
                      label="Nuovo destinatario"
                      icon="pi pi-plus"
                      (onClick)="showCreateDialog()"
                      ariaLabel="Crea nuovo destinatario"
                    />
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="loadingbody">
              <tr>
                <td colspan="6">
                  <div class="loading-row">
                    <p-progressSpinner styleClass="loading-spinner" strokeWidth="4" aria-label="Caricamento in corso" />
                    <span>Caricamento destinatari…</span>
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
        [header]="editMode ? 'Modifica destinatario' : 'Nuovo destinatario'"
        [dismissableMask]="true"
      >
        <form class="dialog-form" (ngSubmit)="saveDestinatario()">
          <fieldset class="form-fieldset">
            <legend class="form-legend">Dati aziendali</legend>
            <div class="grid formgrid p-fluid">
              <div class="field col-12">
                <label for="dest-ragione">Ragione sociale <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="dest-ragione" name="ragioneSociale" [(ngModel)]="formData.ragioneSociale"
                       placeholder="es. Impianto S.r.l." required autocomplete="organization" />
              </div>
              <div class="field col-12 md:col-6">
                <label for="dest-piva">Partita IVA <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="dest-piva" name="partitaIVA" [(ngModel)]="formData.partitaIVA"
                       placeholder="11 cifre" maxlength="11" inputmode="numeric" required />
              </div>
              <div class="field col-12 md:col-6">
                <label for="dest-autorizzazione">N. autorizzazione <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="dest-autorizzazione" name="numeroAutorizzazione" [(ngModel)]="formData.numeroAutorizzazione"
                       placeholder="es. AUT/2024/001" required />
              </div>
              <div class="field col-12">
                <label for="dest-pec">PEC</label>
                <input pInputText id="dest-pec" name="pec" type="email" [(ngModel)]="formData.pec"
                       placeholder="pec@esempio.it" autocomplete="email" />
              </div>
            </div>
          </fieldset>

          <fieldset class="form-fieldset">
            <legend class="form-legend">Sede</legend>
            <div class="grid formgrid p-fluid">
              <div class="field col-12 md:col-8">
                <label for="dest-via">Via <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="dest-via" name="via" [(ngModel)]="formData.sede.via"
                       placeholder="es. Via Roma" required autocomplete="address-line1" />
              </div>
              <div class="field col-12 md:col-4">
                <label for="dest-civico">Civico <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="dest-civico" name="civico" [(ngModel)]="formData.sede.civico"
                       placeholder="es. 12" required />
              </div>
              <div class="field col-12 md:col-4">
                <label for="dest-cap">CAP <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="dest-cap" name="cap" [(ngModel)]="formData.sede.cap"
                       placeholder="5 cifre" maxlength="5" inputmode="numeric" required autocomplete="postal-code" />
              </div>
              <div class="field col-12 md:col-4">
                <label for="dest-comune">Comune <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="dest-comune" name="comune" [(ngModel)]="formData.sede.comune"
                       placeholder="es. Milano" required autocomplete="address-level2" />
              </div>
              <div class="field col-12 md:col-4">
                <label for="dest-prov">Provincia <span class="req" aria-hidden="true">*</span></label>
                <input pInputText id="dest-prov" name="provincia" [(ngModel)]="formData.sede.provincia"
                       placeholder="es. MI" maxlength="2" style="text-transform: uppercase" required />
              </div>
            </div>
          </fieldset>
        </form>

        <ng-template pTemplate="footer">
          <p-button label="Annulla" [text]="true" icon="pi pi-times" (onClick)="displayDialog = false" />
          <p-button label="Salva" icon="pi pi-check" (onClick)="saveDestinatario()" [loading]="saving" />
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
    .registry-count {
      font-size: var(--font-size-sm); color: var(--text-tertiary);
      font-weight: var(--font-weight-medium); white-space: nowrap;
    }

    .table-responsive { border-radius: 0; }
    :host ::ng-deep .p-datatable { border: none; border-radius: 0; }

    .mono { font-family: var(--font-family-mono); font-size: var(--font-size-sm); }
    .row-actions { display: flex; gap: var(--spacing-xs); justify-content: flex-end; }

    .cell-label { display: none; font-weight: var(--font-weight-semibold); color: var(--text-tertiary);
      font-size: var(--font-size-xs); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.15rem; }

    .loading-row { display: flex; align-items: center; justify-content: center; gap: var(--spacing-md);
      padding: var(--spacing-2xl); color: var(--text-tertiary); }
    :host ::ng-deep .loading-spinner { width: 2.25rem; height: 2.25rem; }

    .empty-state__icon { font-size: 2.75rem; }

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
export class DestinatariListComponent implements OnInit {
  destinatari: Destinatario[] = [];
  loading = false;
  saving = false;
  error = '';
  totalRecords = 0;
  pageSize = 10;
  currentPage = 1;
  searchTerm = '';

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

  /** Filtra la pagina corrente in base al testo di ricerca (case-insensitive). */
  get filteredDestinatari(): Destinatario[] {
    const term = this.searchTerm?.trim().toLowerCase();
    if (!term) return this.destinatari;
    return this.destinatari.filter((d) =>
      [
        d.ragioneSociale,
        d.partitaIVA,
        d.numeroAutorizzazione,
        d.pec,
        d.sede ? this.formatIndirizzo(d.sede) : ''
      ]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(term))
    );
  }

  loadDestinatari(event: any): void {
    this.loading = true;
    this.error = '';
    const page = Math.floor(event.first / event.rows) + 1;
    this.currentPage = page;

    this.registryService.getDestinatari(page, event.rows).subscribe({
      next: (response) => {
        this.destinatari = response.items;
        this.totalRecords = response.total;
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.message || 'Errore nel caricamento dei destinatari';
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
    if (!indirizzo) return 'N/D';
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
