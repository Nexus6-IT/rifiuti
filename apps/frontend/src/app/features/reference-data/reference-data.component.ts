import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { DropdownModule } from 'primeng/dropdown';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService } from 'primeng/api';
import { AuthService } from '../../core/services/auth.service';
import { ToastService } from '../../core/services/toast.service';
import {
  ReferenceDataService,
  ReferenceDataStatus,
  ReferenceDataset,
  AtecoCode,
  IstatComune,
} from './reference-data.service';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

type SearchTipo = 'comuni' | 'ateco';

interface DatasetRow {
  key: keyof ReferenceDataStatus;
  label: string;
  count: number;
}

/**
 * Pagina admin "Dati di riferimento": stato del popolamento delle tabelle
 * condivise (ATECO, ISTAT nazioni/province/comuni), ricerca comuni/ATECO e
 * reseed dei dataset dalle sorgenti.
 */
@Component({
  selector: 'app-reference-data',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TableModule,
    TagModule,
    InputTextModule,
    SelectButtonModule,
    DropdownModule,
    ProgressSpinnerModule,
    ConfirmDialogModule,
  ],
  providers: [ConfirmationService],
  template: `
    <div class="page">
      <p-confirmDialog></p-confirmDialog>

      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Dati di riferimento</h1>
          <p class="page-subtitle">Stato delle tabelle condivise ISTAT/ATECO, ricerca e aggiornamento</p>
        </div>
        <div class="page-actions">
          <p-button
            icon="pi pi-refresh"
            [outlined]="true"
            label="Aggiorna stato"
            [loading]="loadingStatus()"
            (onClick)="loadStatus()"
            ariaLabel="Aggiorna lo stato dei dataset"
          ></p-button>
        </div>
      </header>

      <!-- KPI conteggi dataset -->
      <div *ngIf="status() && !statusError()" class="stat-grid mb-4">
        <div *ngFor="let row of datasetRows()" class="stat-card">
          <span class="stat-card__label">{{ row.label }}</span>
          <span class="stat-card__value">{{ row.count | number }}</span>
          <span class="stat-card__hint">
            <p-tag
              [severity]="row.count > 0 ? 'success' : 'warning'"
              [value]="row.count > 0 ? 'Popolato' : 'Vuoto'"
              [icon]="row.count > 0 ? 'pi pi-check' : 'pi pi-exclamation-triangle'"
            ></p-tag>
          </span>
        </div>
      </div>

      <!-- Stato popolamento: loading/error -->
      <section *ngIf="loadingStatus() && !status()" class="surface-card mb-4">
        <div class="flex justify-content-center p-4">
          <p-progressSpinner styleClass="w-3rem h-3rem" ariaLabel="Caricamento stato dataset"></p-progressSpinner>
        </div>
      </section>

      <section *ngIf="statusError() && !loadingStatus()" class="surface-card mb-4">
        <div class="empty-state">
          <i class="pi pi-exclamation-triangle empty-state__icon empty-state__icon--danger" aria-hidden="true"></i>
          <span class="empty-state__title">Errore di caricamento</span>
          <p>Impossibile caricare lo stato dei dati di riferimento.</p>
          <p-button label="Riprova" icon="pi pi-refresh" [outlined]="true" (onClick)="loadStatus()"></p-button>
        </div>
      </section>

      <!-- === Ricerca === -->
      <section class="surface-card mb-4" aria-label="Ricerca dati di riferimento">
        <h2 class="ref-section-title mb-3">Ricerca</h2>
        <div class="grid formgrid mb-3" style="align-items: end;">
          <div class="field col-12 md:col-4">
            <label id="ref-tipo-label" class="block mb-2">Tipo</label>
            <p-selectButton
              [options]="tipoOptions"
              [(ngModel)]="searchTipo"
              optionLabel="label"
              optionValue="value"
              ariaLabelledBy="ref-tipo-label"
              (onChange)="onTipoChange()"
            ></p-selectButton>
          </div>
          <div class="field col-12 md:col-6">
            <label for="ref-query" class="block mb-2">Cerca</label>
            <input
              id="ref-query"
              pInputText
              class="w-full"
              [(ngModel)]="query"
              (keyup.enter)="search()"
              [placeholder]="searchTipo === 'comuni' ? 'es. Milano' : 'es. 38 o raccolta rifiuti'"
              [attr.aria-label]="searchTipo === 'comuni' ? 'Cerca un comune' : 'Cerca un codice ATECO'"
            />
          </div>
          <div class="field col-12 md:col-2">
            <p-button
              label="Cerca"
              icon="pi pi-search"
              styleClass="w-full"
              [loading]="searching()"
              [disabled]="!query.trim()"
              (onClick)="search()"
              ariaLabel="Avvia la ricerca"
            ></p-button>
          </div>
        </div>

        <!-- Risultati comuni -->
        <div class="table-responsive" *ngIf="searchTipo === 'comuni'">
          <p-table [value]="comuni()" [loading]="searching()" styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr>
                <th scope="col" style="width: 110px">Cod. ISTAT</th>
                <th scope="col">Comune</th>
                <th scope="col" style="width: 90px" class="text-center">Prov.</th>
                <th scope="col" style="width: 90px" class="text-center">CAP</th>
                <th scope="col" style="width: 110px" class="text-center">Catastale</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-c>
              <tr>
                <td>{{ c.code }}</td>
                <td><strong>{{ c.name }}</strong></td>
                <td class="text-center">{{ c.provinciaSigla }}</td>
                <td class="text-center">{{ c.cap || '-' }}</td>
                <td class="text-center">{{ c.codiceCatastale || '-' }}</td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="5">
                  <div class="empty-state">
                    <i class="pi pi-search empty-state__icon" aria-hidden="true"></i>
                    <span class="empty-state__title">{{ emptyMessage() }}</span>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>

        <!-- Risultati ATECO -->
        <div class="table-responsive" *ngIf="searchTipo === 'ateco'">
          <p-table [value]="ateco()" [loading]="searching()" styleClass="p-datatable-sm">
            <ng-template pTemplate="header">
              <tr>
                <th scope="col" style="width: 140px">Codice</th>
                <th scope="col">Descrizione</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-a>
              <tr>
                <td><strong>{{ a.code }}</strong></td>
                <td>{{ a.description }}</td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="2">
                  <div class="empty-state">
                    <i class="pi pi-search empty-state__icon" aria-hidden="true"></i>
                    <span class="empty-state__title">{{ emptyMessage() }}</span>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>

      <!-- === Aggiornamento (reseed) === -->
      <section class="surface-card" aria-label="Aggiornamento dati">
        <h2 class="ref-section-title mb-3">Aggiorna dati</h2>
        <div *ngIf="!isAdmin()" class="empty-state empty-state--compact">
          <i class="pi pi-lock empty-state__icon" aria-hidden="true"></i>
          <span class="empty-state__title">Accesso riservato agli amministratori</span>
          <p>Solo gli amministratori possono ripopolare i dati di riferimento.</p>
        </div>

        <ng-container *ngIf="isAdmin()">
          <p class="text-secondary">
            Ripopola i dati dalle sorgenti ufficiali. L'operazione viene eseguita in background
            e può richiedere alcuni minuti; aggiorna lo stato per verificare i nuovi conteggi.
          </p>
          <div class="grid formgrid" style="align-items: end;">
            <div class="field col-12 md:col-5">
              <label for="ref-dataset" class="block mb-2">Dataset</label>
              <p-dropdown
                inputId="ref-dataset"
                [options]="datasetOptions"
                [(ngModel)]="reseedDataset"
                optionLabel="label"
                optionValue="value"
                styleClass="w-full"
                ariaLabel="Dataset da ripopolare"
              ></p-dropdown>
            </div>
            <div class="field col-12 md:col-4 flex align-items-end">
              <p-button
                label="Aggiorna dati"
                icon="pi pi-cloud-download"
                [loading]="reseeding()"
                (onClick)="confirmReseed()"
                ariaLabel="Avvia l'aggiornamento del dataset selezionato"
              ></p-button>
            </div>
          </div>
        </ng-container>
      </section>
    </div>
  `,
  styles: [
    `
      .ref-section-title {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        margin: 0;
      }
      .text-right { text-align: right; }
      .text-center { text-align: center; }
      .text-secondary { color: var(--text-secondary); }
      .empty-state--compact { padding: var(--spacing-lg); }
      .empty-state__icon--danger { color: var(--color-danger); }
      .mb-4 { margin-bottom: var(--spacing-xl); }
      .mb-3 { margin-bottom: var(--spacing-base); }
      .mb-2 { margin-bottom: var(--spacing-sm); }
    `,
  ],
})
export class ReferenceDataComponent implements OnInit {
  private readonly referenceData = inject(ReferenceDataService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmationService);

  // Stato popolamento
  readonly status = signal<ReferenceDataStatus | null>(null);
  readonly loadingStatus = signal(false);
  readonly statusError = signal(false);

  // Ricerca
  readonly comuni = signal<IstatComune[]>([]);
  readonly ateco = signal<AtecoCode[]>([]);
  readonly searching = signal(false);
  readonly searched = signal(false);

  // Reseed
  readonly reseeding = signal(false);

  readonly isAdmin = computed(() => {
    const role = this.auth.currentUser()?.role;
    return !!role && ADMIN_ROLES.includes(role);
  });

  readonly datasetRows = computed<DatasetRow[]>(() => {
    const s = this.status();
    if (!s) return [];
    return [
      { key: 'ateco', label: 'Codici ATECO', count: s.ateco },
      { key: 'nazioni', label: 'Nazioni (ISTAT)', count: s.nazioni },
      { key: 'province', label: 'Province (ISTAT)', count: s.province },
      { key: 'comuni', label: 'Comuni (ISTAT)', count: s.comuni },
    ];
  });

  readonly emptyMessage = computed(() =>
    this.searched() ? 'Nessun risultato trovato.' : 'Inserisci un termine di ricerca.',
  );

  // Form state
  searchTipo: SearchTipo = 'comuni';
  query = '';
  reseedDataset: ReferenceDataset | null = null;

  readonly tipoOptions = [
    { label: 'Comuni', value: 'comuni' as SearchTipo },
    { label: 'ATECO', value: 'ateco' as SearchTipo },
  ];

  readonly datasetOptions: { label: string; value: ReferenceDataset | null }[] = [
    { label: 'Tutti i dataset', value: null },
    { label: 'Codici ATECO', value: 'ateco' },
    { label: 'Nazioni (ISTAT)', value: 'nazioni' },
    { label: 'Province (ISTAT)', value: 'province' },
    { label: 'Comuni (ISTAT)', value: 'comuni' },
  ];

  ngOnInit(): void {
    this.loadStatus();
  }

  loadStatus(): void {
    this.loadingStatus.set(true);
    this.statusError.set(false);
    this.referenceData.getStatus().subscribe({
      next: (s) => {
        this.status.set(s);
        this.loadingStatus.set(false);
      },
      error: () => {
        this.loadingStatus.set(false);
        this.statusError.set(true);
        this.toast.error('Impossibile caricare lo stato dei dati di riferimento');
      },
    });
  }

  onTipoChange(): void {
    this.comuni.set([]);
    this.ateco.set([]);
    this.searched.set(false);
  }

  search(): void {
    const q = this.query.trim();
    if (!q) return;
    this.searching.set(true);

    if (this.searchTipo === 'comuni') {
      this.referenceData.searchComuni(q).subscribe({
        next: (res) => {
          this.comuni.set(res || []);
          this.searched.set(true);
          this.searching.set(false);
        },
        error: () => {
          this.searching.set(false);
          this.toast.error('Errore nella ricerca dei comuni');
        },
      });
    } else {
      this.referenceData.searchAteco(q).subscribe({
        next: (res) => {
          this.ateco.set(res || []);
          this.searched.set(true);
          this.searching.set(false);
        },
        error: () => {
          this.searching.set(false);
          this.toast.error('Errore nella ricerca dei codici ATECO');
        },
      });
    }
  }

  confirmReseed(): void {
    const opt = this.datasetOptions.find((o) => o.value === this.reseedDataset);
    const label = opt && opt.value ? `il dataset "${opt.label}"` : 'tutti i dataset';
    this.confirm.confirm({
      message: `Confermi di voler ripopolare ${label}? L'operazione viene eseguita in background e sovrascrive i dati esistenti.`,
      header: 'Conferma aggiornamento',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Aggiorna',
      rejectLabel: 'Annulla',
      accept: () => this.reseed(),
    });
  }

  private reseed(): void {
    this.reseeding.set(true);
    this.referenceData.reseed(this.reseedDataset ?? undefined).subscribe({
      next: (res) => {
        this.reseeding.set(false);
        this.toast.success(
          `Aggiornamento avviato (${res.dataset}). Il completamento può richiedere alcuni minuti.`,
        );
      },
      error: (err) => {
        this.reseeding.set(false);
        this.toast.error(err?.error?.message || 'Errore nell\'avvio dell\'aggiornamento');
      },
    });
  }
}
