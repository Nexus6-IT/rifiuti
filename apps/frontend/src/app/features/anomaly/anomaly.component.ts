import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { DropdownModule } from 'primeng/dropdown';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ToastService } from '../../core/services/toast.service';
import { Anomaly, AnomalySeverity, AnomalyService, AnomalyType } from './anomaly.service';

type TagSeverity = 'success' | 'info' | 'warning' | 'danger' | undefined;

/**
 * Pagina Anomalie: rilevamento automatico di incongruenze su FIR e movimenti
 * (CER non in catalogo, quantità anomale, descrizioni mancanti, giacenze impossibili).
 * Consuma GET /anomaly. Filtri (severità/tipo) applicati lato client.
 */
@Component({
  selector: 'app-anomaly',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    DropdownModule,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
    MessageModule,
  ],
  template: `
    <div class="anomaly-page" style="max-width: 1100px; margin: 0 auto;">
      <p-card>
        <ng-template pTemplate="header">
          <div class="p-3 flex justify-content-between align-items-start" style="gap: 1rem;">
            <div>
              <h2 style="margin: 0;">Anomalie</h2>
              <p class="text-muted">Rilevamento automatico di incongruenze su FIR e movimenti</p>
            </div>
            <p-button
              label="Aggiorna"
              icon="pi pi-refresh"
              [loading]="loading()"
              (onClick)="load()"
            ></p-button>
          </div>
        </ng-template>

        <!-- Filtri -->
        <div class="grid mb-3" *ngIf="!loading() && !error()">
          <div class="col-12 md:col-4">
            <label class="block mb-2">Gravità</label>
            <p-dropdown
              [options]="severityOptions"
              [(ngModel)]="selectedSeverity"
              optionLabel="label"
              optionValue="value"
              [showClear]="true"
              placeholder="Tutte"
              styleClass="w-full"
              (onChange)="applyFilters()"
            ></p-dropdown>
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">Tipo</label>
            <p-dropdown
              [options]="typeOptions"
              [(ngModel)]="selectedType"
              optionLabel="label"
              optionValue="value"
              [showClear]="true"
              placeholder="Tutti"
              styleClass="w-full"
              (onChange)="applyFilters()"
            ></p-dropdown>
          </div>
          <div class="col-12 md:col-4 flex align-items-end">
            <span class="text-muted">{{ filtered().length }} anomalie</span>
          </div>
        </div>

        <!-- Loading -->
        <div *ngIf="loading()" class="flex justify-content-center p-5">
          <p-progressSpinner styleClass="w-4rem h-4rem" strokeWidth="4"></p-progressSpinner>
        </div>

        <!-- Error -->
        <div *ngIf="error() && !loading()" class="mt-3">
          <p-message
            severity="error"
            text="Impossibile caricare le anomalie. Riprova."
            styleClass="w-full"
          ></p-message>
        </div>

        <!-- Empty -->
        <div *ngIf="!loading() && !error() && loaded() && filtered().length === 0" class="mt-3">
          <p-message
            severity="success"
            text="Nessuna anomalia rilevata per i criteri selezionati."
            styleClass="w-full"
          ></p-message>
        </div>

        <!-- Tabella -->
        <p-table
          *ngIf="!loading() && !error() && filtered().length > 0"
          [value]="filtered()"
          styleClass="p-datatable-sm mt-2"
          [paginator]="filtered().length > 10"
          [rows]="10"
          responsiveLayout="scroll"
          [rowHover]="true"
        >
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 120px">Gravità</th>
              <th style="width: 200px">Tipo</th>
              <th>Messaggio</th>
              <th style="width: 160px">FIR</th>
              <th style="width: 120px">CER</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-a>
            <tr>
              <td>
                <p-tag
                  [value]="severityLabel(a.severity)"
                  [severity]="severityTag(a.severity)"
                  [rounded]="true"
                ></p-tag>
              </td>
              <td>{{ typeLabel(a.type) }}</td>
              <td>{{ a.message }}</td>
              <td>{{ a.firNumber || '-' }}</td>
              <td>{{ a.cerCode || '-' }}</td>
            </tr>
          </ng-template>
          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="5" class="text-center">Nessuna anomalia.</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `,
  styles: [
    `
      .text-muted {
        color: #6c757d;
        margin: 0;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 1rem;
      }
      .col-12 {
        grid-column: span 12;
      }
      @media (min-width: 768px) {
        .md\\:col-4 {
          grid-column: span 4;
        }
      }
    `,
  ],
})
export class AnomalyComponent implements OnInit {
  private readonly anomalyService = inject(AnomalyService);
  private readonly toast = inject(ToastService);

  readonly anomalies = signal<Anomaly[]>([]);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal(false);

  selectedSeverity: AnomalySeverity | null = null;
  selectedType: AnomalyType | null = null;

  // Trigger per ricalcolare il computed sui filtri (ngModel non è signal-based).
  private readonly filterTick = signal(0);

  readonly filtered = computed<Anomaly[]>(() => {
    this.filterTick();
    return this.anomalies().filter(
      (a) =>
        (!this.selectedSeverity || a.severity === this.selectedSeverity) &&
        (!this.selectedType || a.type === this.selectedType),
    );
  });

  readonly severityOptions = [
    { label: 'Alta', value: 'HIGH' as AnomalySeverity },
    { label: 'Media', value: 'MEDIUM' as AnomalySeverity },
    { label: 'Bassa', value: 'LOW' as AnomalySeverity },
  ];

  readonly typeOptions = [
    { label: 'CER non in catalogo', value: 'INVALID_CER' as AnomalyType },
    { label: 'Quantità non positiva', value: 'NON_POSITIVE_QUANTITY' as AnomalyType },
    { label: 'Quantità eccessiva', value: 'EXCESSIVE_QUANTITY' as AnomalyType },
    { label: 'Descrizione mancante', value: 'MISSING_DESCRIPTION' as AnomalyType },
    { label: 'Giacenza impossibile', value: 'NEGATIVE_STOCK' as AnomalyType },
  ];

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(false);
    this.anomalyService.detect().subscribe({
      next: (data) => {
        this.anomalies.set(data || []);
        this.loaded.set(true);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
        this.toast.error('Errore nel caricamento delle anomalie');
      },
    });
  }

  applyFilters(): void {
    this.filterTick.update((v) => v + 1);
  }

  severityTag(severity: AnomalySeverity): TagSeverity {
    switch (severity) {
      case 'HIGH':
        return 'danger';
      case 'MEDIUM':
        return 'warning';
      case 'LOW':
        return 'info';
      default:
        return undefined;
    }
  }

  severityLabel(severity: AnomalySeverity): string {
    return this.severityOptions.find((o) => o.value === severity)?.label ?? severity;
  }

  typeLabel(type: AnomalyType): string {
    return this.typeOptions.find((o) => o.value === type)?.label ?? type;
  }
}
