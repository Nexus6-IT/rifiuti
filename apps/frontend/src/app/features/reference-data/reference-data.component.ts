import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
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
    CardModule,
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
    <div class="reference-data" style="max-width: 1100px; margin: 0 auto;">
      <p-confirmDialog></p-confirmDialog>

      <p-card>
        <ng-template pTemplate="header">
          <div class="p-3">
            <h2>Dati di riferimento</h2>
            <p class="text-muted">Stato delle tabelle condivise ISTAT/ATECO, ricerca e aggiornamento</p>
          </div>
        </ng-template>

        <!-- === Stato popolamento === -->
        <section class="mb-4">
          <div class="flex justify-content-between align-items-center mb-2">
            <h3 style="margin: 0;">Stato popolamento</h3>
            <p-button
              icon="pi pi-refresh"
              [text]="true"
              label="Aggiorna stato"
              [loading]="loadingStatus()"
              (onClick)="loadStatus()"
            ></p-button>
          </div>

          <!-- Loading -->
          <div *ngIf="loadingStatus() && !status()" class="text-center p-4">
            <p-progressSpinner styleClass="w-3rem h-3rem"></p-progressSpinner>
          </div>

          <!-- Error -->
          <div *ngIf="statusError() && !loadingStatus()" class="p-3">
            <p-tag severity="danger" value="Errore di caricamento"></p-tag>
            <p class="mt-2">Impossibile caricare lo stato dei dati di riferimento.</p>
            <p-button label="Riprova" icon="pi pi-refresh" [outlined]="true" (onClick)="loadStatus()"></p-button>
          </div>

          <!-- Tabella conteggi -->
          <p-table
            *ngIf="status() && !statusError()"
            [value]="datasetRows()"
            styleClass="p-datatable-sm"
          >
            <ng-template pTemplate="header">
              <tr>
                <th>Dataset</th>
                <th class="text-right">Record</th>
                <th class="text-center" style="width: 140px">Stato</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              <tr>
                <td>{{ row.label }}</td>
                <td class="text-right">{{ row.count | number }}</td>
                <td class="text-center">
                  <p-tag
                    [severity]="row.count > 0 ? 'success' : 'warning'"
                    [value]="row.count > 0 ? 'Popolato' : 'Vuoto'"
                  ></p-tag>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </section>

        <hr />

        <!-- === Ricerca === -->
        <section class="mb-4">
          <h3>Ricerca</h3>
          <div class="grid mb-3" style="align-items: end;">
            <div class="col-12 md:col-4">
              <label class="block mb-2">Tipo</label>
              <p-selectButton
                [options]="tipoOptions"
                [(ngModel)]="searchTipo"
                optionLabel="label"
                optionValue="value"
                (onChange)="onTipoChange()"
              ></p-selectButton>
            </div>
            <div class="col-12 md:col-6">
              <label class="block mb-2">Cerca</label>
              <input
                pInputText
                class="w-full"
                [(ngModel)]="query"
                (keyup.enter)="search()"
                [placeholder]="searchTipo === 'comuni' ? 'es. Milano' : 'es. 38 o raccolta rifiuti'"
              />
            </div>
            <div class="col-12 md:col-2">
              <p-button
                label="Cerca"
                icon="pi pi-search"
                styleClass="w-full"
                [loading]="searching()"
                [disabled]="!query.trim()"
                (onClick)="search()"
              ></p-button>
            </div>
          </div>

          <!-- Risultati comuni -->
          <p-table
            *ngIf="searchTipo === 'comuni'"
            [value]="comuni()"
            [loading]="searching()"
            styleClass="p-datatable-sm"
          >
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 110px">Cod. ISTAT</th>
                <th>Comune</th>
                <th style="width: 90px" class="text-center">Prov.</th>
                <th style="width: 90px" class="text-center">CAP</th>
                <th style="width: 110px" class="text-center">Catastale</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-c>
              <tr>
                <td>{{ c.code }}</td>
                <td>{{ c.name }}</td>
                <td class="text-center">{{ c.provinciaSigla }}</td>
                <td class="text-center">{{ c.cap || '-' }}</td>
                <td class="text-center">{{ c.codiceCatastale || '-' }}</td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="5" class="text-center">{{ emptyMessage() }}</td>
              </tr>
            </ng-template>
          </p-table>

          <!-- Risultati ATECO -->
          <p-table
            *ngIf="searchTipo === 'ateco'"
            [value]="ateco()"
            [loading]="searching()"
            styleClass="p-datatable-sm"
          >
            <ng-template pTemplate="header">
              <tr>
                <th style="width: 140px">Codice</th>
                <th>Descrizione</th>
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
                <td colspan="2" class="text-center">{{ emptyMessage() }}</td>
              </tr>
            </ng-template>
          </p-table>
        </section>

        <hr />

        <!-- === Aggiornamento (reseed) === -->
        <section>
          <h3>Aggiorna dati</h3>
          <div *ngIf="!isAdmin()" class="p-2">
            <p-tag severity="warning" value="Accesso riservato agli amministratori"></p-tag>
            <p class="mt-2">Solo gli amministratori possono ripopolare i dati di riferimento.</p>
          </div>

          <ng-container *ngIf="isAdmin()">
            <p class="text-muted">
              Ripopola i dati dalle sorgenti ufficiali. L'operazione viene eseguita in background
              e può richiedere alcuni minuti; aggiorna lo stato per verificare i nuovi conteggi.
            </p>
            <div class="grid" style="align-items: end;">
              <div class="col-12 md:col-5">
                <label class="block mb-2">Dataset</label>
                <p-dropdown
                  [options]="datasetOptions"
                  [(ngModel)]="reseedDataset"
                  optionLabel="label"
                  optionValue="value"
                  styleClass="w-full"
                ></p-dropdown>
              </div>
              <div class="col-12 md:col-4">
                <p-button
                  label="Aggiorna dati"
                  icon="pi pi-cloud-download"
                  [loading]="reseeding()"
                  (onClick)="confirmReseed()"
                ></p-button>
              </div>
            </div>
          </ng-container>
        </section>
      </p-card>
    </div>
  `,
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
