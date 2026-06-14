import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { CalendarModule } from 'primeng/calendar';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ToastService } from '../../core/services/toast.service';
import { EsgReport, EsgService } from './esg.service';

/**
 * Pagina ESG / CO2: indicatori ambientali aggregati del tenant.
 * Mostra tasso di recupero, kg deviati da discarica, CO2 evitata e i totali
 * prodotto/recupero/smaltimento, con dettaglio per codice CER.
 * Filtro periodo opzionale (data inizio/fine).
 */
@Component({
  selector: 'app-esg',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    CalendarModule,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
    MessageModule,
  ],
  template: `
    <div class="esg-page" style="max-width: 1100px; margin: 0 auto;">
      <p-card>
        <ng-template pTemplate="header">
          <div class="p-3">
            <h2>ESG / CO2 — Indicatori ambientali</h2>
            <p class="text-muted">
              Tasso di recupero, rifiuti deviati da discarica e CO2 evitata, con dettaglio per CER
            </p>
          </div>
        </ng-template>

        <!-- Filtro periodo -->
        <div class="grid mb-3" style="align-items: end;">
          <div class="col-12 md:col-4">
            <label class="block mb-2">Data inizio</label>
            <p-calendar
              [(ngModel)]="startDate"
              dateFormat="yy-mm-dd"
              [showIcon]="true"
              [showButtonBar]="true"
              [maxDate]="endDate || undefined"
              placeholder="Tutto il periodo"
              styleClass="w-full"
              inputStyleClass="w-full"
            ></p-calendar>
          </div>
          <div class="col-12 md:col-4">
            <label class="block mb-2">Data fine</label>
            <p-calendar
              [(ngModel)]="endDate"
              dateFormat="yy-mm-dd"
              [showIcon]="true"
              [showButtonBar]="true"
              [minDate]="startDate || undefined"
              placeholder="Tutto il periodo"
              styleClass="w-full"
              inputStyleClass="w-full"
            ></p-calendar>
          </div>
          <div class="col-12 md:col-4 flex gap-2">
            <p-button
              label="Aggiorna"
              icon="pi pi-refresh"
              [loading]="loading()"
              (onClick)="loadReport()"
            ></p-button>
            <p-button
              label="Azzera filtro"
              icon="pi pi-filter-slash"
              [text]="true"
              [disabled]="loading()"
              (onClick)="clearFilter()"
            ></p-button>
          </div>
        </div>

        <!-- Loading -->
        <div *ngIf="loading()" class="flex justify-content-center p-5">
          <p-progressSpinner strokeWidth="4" [style]="{ width: '50px', height: '50px' }"></p-progressSpinner>
        </div>

        <!-- Error -->
        <div *ngIf="!loading() && error()" class="mt-3">
          <p-message
            severity="error"
            text="Impossibile caricare il report ESG. Riprova."
            styleClass="w-full"
          ></p-message>
        </div>

        <!-- Report -->
        <ng-container *ngIf="!loading() && !error() && report() as r">
          <div class="mb-3">
            <p-tag
              *ngIf="r.period"
              severity="info"
              [value]="'Periodo: ' + (r.period.from | date: 'dd/MM/yyyy') + ' — ' + (r.period.to | date: 'dd/MM/yyyy')"
            ></p-tag>
            <p-tag *ngIf="!r.period" severity="info" value="Periodo: tutto lo storico"></p-tag>
          </div>

          <!-- KPI principali -->
          <div class="grid mb-2">
            <div class="col-12 md:col-4">
              <div class="kpi-card">
                <span class="kpi-label">Tasso di recupero</span>
                <span class="kpi-value">{{ r.totals.recyclingRate * 100 | number: '1.0-1' }}%</span>
              </div>
            </div>
            <div class="col-12 md:col-4">
              <div class="kpi-card">
                <span class="kpi-label">Deviati da discarica</span>
                <span class="kpi-value">{{ r.landfillDivertedKg | number: '1.0-0' }} <small>kg</small></span>
              </div>
            </div>
            <div class="col-12 md:col-4">
              <div class="kpi-card kpi-card--accent">
                <span class="kpi-label">CO2 evitata</span>
                <span class="kpi-value">{{ r.co2AvoidedKg | number: '1.0-0' }} <small>kg</small></span>
              </div>
            </div>
          </div>

          <!-- KPI secondari: totali -->
          <div class="grid mb-4">
            <div class="col-12 md:col-4">
              <div class="kpi-card kpi-card--sub">
                <span class="kpi-label">Prodotto</span>
                <span class="kpi-value-sm">{{ r.totals.producedKg | number: '1.0-0' }} <small>kg</small></span>
              </div>
            </div>
            <div class="col-12 md:col-4">
              <div class="kpi-card kpi-card--sub">
                <span class="kpi-label">Recupero</span>
                <span class="kpi-value-sm">{{ r.totals.recoveryKg | number: '1.0-0' }} <small>kg</small></span>
              </div>
            </div>
            <div class="col-12 md:col-4">
              <div class="kpi-card kpi-card--sub">
                <span class="kpi-label">Smaltimento</span>
                <span class="kpi-value-sm">{{ r.totals.disposalKg | number: '1.0-0' }} <small>kg</small></span>
              </div>
            </div>
          </div>

          <!-- Dettaglio per CER -->
          <h3>Dettaglio per codice CER</h3>
          <p-table [value]="r.byCer" styleClass="p-datatable-sm" [rowHover]="true" responsiveLayout="scroll">
            <ng-template pTemplate="header">
              <tr>
                <th>CER</th>
                <th class="text-right">Recupero (kg)</th>
                <th class="text-right">Smaltimento (kg)</th>
                <th class="text-right">CO2 evitata (kg)</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-row>
              <tr>
                <td><strong>{{ row.cerCode }}</strong></td>
                <td class="text-right">{{ row.recoveryKg | number: '1.0-0' }}</td>
                <td class="text-right">{{ row.disposalKg | number: '1.0-0' }}</td>
                <td class="text-right">{{ row.co2AvoidedKg | number: '1.0-0' }}</td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="4" class="text-center">
                  Nessun dato disponibile per il periodo selezionato.
                </td>
              </tr>
            </ng-template>
          </p-table>
        </ng-container>
      </p-card>
    </div>
  `,
  styles: [
    `
      .text-muted {
        color: #6c757d;
        margin: 0;
      }

      .kpi-card {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
        padding: 1.25rem;
        height: 100%;
        border: 1px solid var(--surface-border, #dee2e6);
        border-radius: 8px;
        background: var(--surface-card, #ffffff);
      }

      .kpi-card--accent {
        border-color: var(--primary-color, #22c55e);
        background: var(--primary-50, #f0fdf4);
      }

      .kpi-card--sub {
        padding: 1rem 1.25rem;
      }

      .kpi-label {
        font-size: 0.85rem;
        color: #6c757d;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }

      .kpi-value {
        font-size: 1.85rem;
        font-weight: 700;
        line-height: 1.1;
      }

      .kpi-value-sm {
        font-size: 1.35rem;
        font-weight: 600;
        line-height: 1.1;
      }

      .kpi-value small,
      .kpi-value-sm small {
        font-size: 0.9rem;
        font-weight: 500;
        color: #6c757d;
      }
    `,
  ],
})
export class EsgComponent implements OnInit {
  private readonly esgService = inject(EsgService);
  private readonly toast = inject(ToastService);

  readonly report = signal<EsgReport | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);

  startDate: Date | null = null;
  endDate: Date | null = null;

  ngOnInit(): void {
    this.loadReport();
  }

  loadReport(): void {
    this.loading.set(true);
    this.error.set(false);

    this.esgService.getReport(this.toIso(this.startDate), this.toIso(this.endDate)).subscribe({
      next: (r) => {
        this.report.set(r);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
        this.report.set(null);
        this.toast.error('Errore nel caricamento del report ESG');
      },
    });
  }

  clearFilter(): void {
    this.startDate = null;
    this.endDate = null;
    this.loadReport();
  }

  /** Converte una Date locale in stringa ISO yyyy-mm-dd (senza shift di fuso). */
  private toIso(date: Date | null): string | undefined {
    if (!date) return undefined;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
