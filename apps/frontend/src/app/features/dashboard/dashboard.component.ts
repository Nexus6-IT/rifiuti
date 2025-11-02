import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ChartModule } from 'primeng/chart';
import { FirService } from '../fir/fir.service';
import { FIR, FIRStato } from '../../shared/models/fir.model';
import { SkeletonLoaderComponent } from '../../shared/components/skeleton-loader.component';
import { EmptyStateComponent } from '../../shared/components/empty-state.component';
import { ErrorStateComponent } from '../../shared/components/error-state.component';

interface DashboardStats {
  totalFIR: number;
  firInTransito: number;
  firConsegnati: number;
  firBozza: number;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    ChartModule,
    SkeletonLoaderComponent,
    EmptyStateComponent,
    ErrorStateComponent
  ],
  template: `
    <div class="dashboard">
      <!-- Page Header -->
      <div class="dashboard-header">
        <div>
          <h1 class="dashboard-title">Dashboard</h1>
          <p class="dashboard-subtitle">Panoramica generale del sistema di gestione rifiuti</p>
        </div>
      </div>

      <!-- Loading State for Stats -->
      <ng-container *ngIf="loading && recentFIR.length === 0">
        <div class="grid mb-4">
          <div class="col-12 md:col-6 lg:col-3" *ngFor="let _ of [1,2,3,4]">
            <app-skeleton-loader variant="stats" [repeat]="1" />
          </div>
        </div>
      </ng-container>

      <!-- Statistics Cards -->
      <div class="grid mb-4" *ngIf="!loading || recentFIR.length > 0">
        <div class="col-12 md:col-6 lg:col-3">
          <p-card styleClass="dashboard-card dashboard-card--primary">
            <div class="flex justify-content-between align-items-center">
              <div>
                <div class="card-label">Totale FIR</div>
                <div class="card-value">{{ stats.totalFIR }}</div>
              </div>
              <div class="card-icon card-icon--primary">
                <i class="pi pi-file" aria-hidden="true"></i>
              </div>
            </div>
          </p-card>
        </div>

        <div class="col-12 md:col-6 lg:col-3">
          <p-card styleClass="dashboard-card dashboard-card--warning">
            <div class="flex justify-content-between align-items-center">
              <div>
                <div class="card-label">In Transito</div>
                <div class="card-value card-value--warning">{{ stats.firInTransito }}</div>
              </div>
              <div class="card-icon card-icon--warning">
                <i class="pi pi-truck" aria-hidden="true"></i>
              </div>
            </div>
          </p-card>
        </div>

        <div class="col-12 md:col-6 lg:col-3">
          <p-card styleClass="dashboard-card dashboard-card--success">
            <div class="flex justify-content-between align-items-center">
              <div>
                <div class="card-label">Consegnati</div>
                <div class="card-value card-value--success">{{ stats.firConsegnati }}</div>
              </div>
              <div class="card-icon card-icon--success">
                <i class="pi pi-check-circle" aria-hidden="true"></i>
              </div>
            </div>
          </p-card>
        </div>

        <div class="col-12 md:col-6 lg:col-3">
          <p-card styleClass="dashboard-card dashboard-card--secondary">
            <div class="flex justify-content-between align-items-center">
              <div>
                <div class="card-label">Bozze</div>
                <div class="card-value">{{ stats.firBozza }}</div>
              </div>
              <div class="card-icon card-icon--secondary">
                <i class="pi pi-pencil" aria-hidden="true"></i>
              </div>
            </div>
          </p-card>
        </div>
      </div>

      <!-- Error State -->
      <app-error-state
        *ngIf="error && !loading"
        title="Errore nel caricamento della dashboard"
        [message]="error"
        (retry)="loadDashboardData()"
      />

      <!-- Content Area (only show if no error) -->
      <div class="grid" *ngIf="!error">
        <!-- Recent FIR Table -->
        <div class="col-12 lg:col-8">
          <p-card>
            <ng-template pTemplate="header">
              <div class="flex justify-content-between align-items-center p-3">
                <h3 class="section-title">FIR Recenti</h3>
                <p-button
                  label="Vedi tutti"
                  [text]="true"
                  routerLink="/fir"
                  icon="pi pi-arrow-right"
                  iconPos="right"
                  aria-label="Visualizza tutti i FIR"
                />
              </div>
            </ng-template>

            <!-- Loading State -->
            <app-skeleton-loader *ngIf="loading" variant="table" [rows]="5" />

            <!-- Table Content -->
            <p-table
              *ngIf="!loading"
              [value]="recentFIR"
              responsiveLayout="scroll"
              styleClass="dashboard-table"
            >
              <ng-template pTemplate="header">
                <tr>
                  <th scope="col">Numero</th>
                  <th scope="col">CER</th>
                  <th scope="col">Stato</th>
                  <th scope="col">Data</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-fir>
                <tr>
                  <td>
                    <span class="font-semibold">{{ fir.numeroProgressivo || 'N/A' }}</span>
                  </td>
                  <td>{{ fir.rifiuto.cerCode }}</td>
                  <td>
                    <p-tag
                      [value]="fir.stato"
                      [severity]="getStatoSeverity(fir.stato)"
                      [attr.aria-label]="'Stato: ' + fir.stato"
                    />
                  </td>
                  <td>
                    <time [dateTime]="fir.createdAt">
                      {{ fir.createdAt | date: 'dd/MM/yyyy HH:mm' }}
                    </time>
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="4">
                    <app-empty-state
                      icon="pi-file"
                      title="Nessun FIR recente"
                      message="Non ci sono FIR recenti da visualizzare. Inizia creando il tuo primo FIR."
                      actionLabel="Crea FIR"
                      actionIcon="pi pi-plus"
                      [routerLink]="['/fir']"
                    />
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </p-card>
        </div>

        <!-- Chart Section -->
        <div class="col-12 lg:col-4">
          <p-card>
            <ng-template pTemplate="header">
              <div class="p-3">
                <h3 class="section-title">FIR per Stato</h3>
              </div>
            </ng-template>

            <!-- Loading State -->
            <div *ngIf="loading" class="chart-skeleton">
              <app-skeleton-loader variant="circle" width="200px" [repeat]="1" />
            </div>

            <!-- Chart -->
            <p-chart
              *ngIf="!loading"
              type="doughnut"
              [data]="chartData"
              [options]="chartOptions"
              aria-label="Grafico a ciambella che mostra la distribuzione dei FIR per stato"
            />
          </p-card>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dashboard {
      animation: fadeIn 0.3s ease-in;
    }

    .dashboard-header {
      margin-bottom: var(--spacing-xl, 1.75rem);
    }

    .dashboard-title {
      margin: 0 0 var(--spacing-xs, 0.5rem) 0;
      font-size: var(--font-size-2xl, 1.875rem);
      font-weight: var(--font-weight-bold, 700);
      color: var(--text-primary, #1f2937);
    }

    .dashboard-subtitle {
      margin: 0;
      font-size: var(--font-size-base, 1rem);
      color: var(--text-secondary, #6b7280);
    }

    :host ::ng-deep .dashboard-card {
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      border: 1px solid var(--gray-200, #e5e7eb);
    }

    :host ::ng-deep .dashboard-card:hover {
      transform: translateY(-2px);
      box-shadow: var(--shadow-lg);
    }

    :host ::ng-deep .dashboard-card--primary {
      border-top: 3px solid var(--brand-accent, #0277bd);
    }

    :host ::ng-deep .dashboard-card--warning {
      border-top: 3px solid var(--brand-secondary, #ff6f00);
    }

    :host ::ng-deep .dashboard-card--success {
      border-top: 3px solid var(--brand-primary, #2e7d32);
    }

    :host ::ng-deep .dashboard-card--secondary {
      border-top: 3px solid var(--gray-400, #9ca3af);
    }

    .card-label {
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-medium, 500);
      color: var(--text-secondary, #6b7280);
      margin-bottom: var(--spacing-xs, 0.5rem);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .card-value {
      font-size: var(--font-size-3xl, 2.25rem);
      font-weight: var(--font-weight-bold, 700);
      color: var(--text-primary, #1f2937);
      line-height: 1;
    }

    .card-value--warning {
      color: var(--brand-secondary, #ff6f00);
    }

    .card-value--success {
      color: var(--brand-primary, #2e7d32);
    }

    .card-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      font-size: 1.75rem;
    }

    .card-icon--primary {
      background: rgba(2, 119, 189, 0.1);
      color: var(--brand-accent, #0277bd);
    }

    .card-icon--warning {
      background: rgba(255, 111, 0, 0.1);
      color: var(--brand-secondary, #ff6f00);
    }

    .card-icon--success {
      background: rgba(46, 125, 50, 0.1);
      color: var(--brand-primary, #2e7d32);
    }

    .card-icon--secondary {
      background: var(--gray-100, #f3f4f6);
      color: var(--gray-600, #4b5563);
    }

    .section-title {
      margin: 0;
      font-size: var(--font-size-lg, 1.125rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--text-primary, #1f2937);
    }

    .chart-skeleton {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: var(--spacing-2xl, 2rem);
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
      .dashboard,
      :host ::ng-deep .dashboard-card {
        animation: none;
        transition: none;
      }
    }
  `]
})
export class DashboardComponent implements OnInit {
  stats: DashboardStats = {
    totalFIR: 0,
    firInTransito: 0,
    firConsegnati: 0,
    firBozza: 0
  };

  recentFIR: FIR[] = [];
  loading = false;
  error = '';

  chartData: any;
  chartOptions: any;

  constructor(private firService: FirService) {}

  ngOnInit(): void {
    this.loadDashboardData();
    this.initChart();
  }

  loadDashboardData(): void {
    this.loading = true;
    this.error = '';
    this.firService.getFIRList(1, 5).subscribe({
      next: (response) => {
        this.recentFIR = response.items;
        this.calculateStats(response.items);
        this.updateChartData();
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.error = err.error?.message || 'Si è verificato un errore nel caricamento dei dati. Riprova più tardi.';
      }
    });
  }

  calculateStats(firList: FIR[]): void {
    this.stats.totalFIR = firList.length;
    this.stats.firInTransito = firList.filter(f => f.stato === FIRStato.IN_TRANSITO).length;
    this.stats.firConsegnati = firList.filter(f => f.stato === FIRStato.CONSEGNATO).length;
    this.stats.firBozza = firList.filter(f => f.stato === FIRStato.BOZZA).length;
  }

  initChart(): void {
    this.chartOptions = {
      plugins: {
        legend: {
          position: 'bottom'
        }
      }
    };
  }

  updateChartData(): void {
    this.chartData = {
      labels: ['Bozza', 'Emesso', 'In Transito', 'Consegnato', 'Annullato'],
      datasets: [
        {
          data: [
            this.stats.firBozza,
            0, // Count emesso separately if needed
            this.stats.firInTransito,
            this.stats.firConsegnati,
            0  // Count annullato separately if needed
          ],
          backgroundColor: ['#6c757d', '#0dcaf0', '#ffc107', '#198754', '#dc3545']
        }
      ]
    };
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
