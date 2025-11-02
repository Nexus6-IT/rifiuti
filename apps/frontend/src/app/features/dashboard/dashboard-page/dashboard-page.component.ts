import { Component, inject, signal, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ChartModule } from 'primeng/chart';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ProgressBarModule } from 'primeng/progressbar';
import { DividerModule } from 'primeng/divider';
import { SkeletonModule } from 'primeng/skeleton';
import { DashboardService, DashboardData } from '../../../core/services/dashboard.service';
import { MessageService } from 'primeng/api';

/**
 * Dashboard Page Component
 *
 * Main analytics dashboard for Italian waste management:
 * - Overview stats (FIRs, waste, compliance)
 * - Status breakdown charts
 * - Waste type analysis
 * - RENTRI sync status
 * - Signature metrics
 * - Trends and predictions
 *
 * Features:
 * - Real-time data refresh
 * - Interactive charts (PrimeNG Chart.js)
 * - CSV export
 * - Responsive grid layout
 */
@Component({
  selector: 'app-dashboard-page',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ChartModule,
    ButtonModule,
    TagModule,
    ProgressBarModule,
    DividerModule,
    SkeletonModule,
  ],
  template: `
    <div class="dashboard-page">
      <!-- Header -->
      <div class="dashboard-header flex justify-content-between align-items-center mb-4">
        <div>
          <h1 class="text-3xl font-bold m-0">Dashboard Analitiche</h1>
          <p class="text-gray-600 mt-2">
            Monitoraggio FIR e gestione rifiuti in tempo reale
          </p>
        </div>
        <div class="flex gap-2">
          <p-button
            label="Aggiorna"
            icon="pi pi-refresh"
            [outlined]="true"
            (onClick)="loadDashboard()"
            [loading]="isLoading()"
          />
          <p-button
            label="Esporta CSV"
            icon="pi pi-download"
            (onClick)="exportCSV()"
          />
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="isLoading() && !dashboard()" class="grid">
        <div class="col-12 md:col-3" *ngFor="let i of [1,2,3,4]">
          <p-card>
            <p-skeleton height="80px" />
          </p-card>
        </div>
      </div>

      <!-- Dashboard Content -->
      <div *ngIf="dashboard() as data" class="dashboard-content">
        <!-- Overview Stats -->
        <div class="grid mb-4">
          <div class="col-12 md:col-3">
            <p-card styleClass="stat-card">
              <div class="stat-content">
                <div class="stat-icon bg-blue-100">
                  <i class="pi pi-file text-blue-600 text-3xl"></i>
                </div>
                <div class="stat-details">
                  <span class="stat-label">FIR Totali</span>
                  <h2 class="stat-value">{{ data.overview.totalFIRs }}</h2>
                  <span class="stat-change text-green-600" *ngIf="growthPercentage() > 0">
                    <i class="pi pi-arrow-up"></i> +{{ (growthPercentage() * 100).toFixed(1) }}%
                  </span>
                </div>
              </div>
            </p-card>
          </div>

          <div class="col-12 md:col-3">
            <p-card styleClass="stat-card">
              <div class="stat-content">
                <div class="stat-icon bg-green-100">
                  <i class="pi pi-check-circle text-green-600 text-3xl"></i>
                </div>
                <div class="stat-details">
                  <span class="stat-label">FIR Completati</span>
                  <h2 class="stat-value">{{ data.overview.completedFIRs }}</h2>
                  <span class="stat-subtitle">
                    {{ (completionRate() * 100).toFixed(0) }}% del totale
                  </span>
                </div>
              </div>
            </p-card>
          </div>

          <div class="col-12 md:col-3">
            <p-card styleClass="stat-card">
              <div class="stat-content">
                <div class="stat-icon bg-purple-100">
                  <i class="pi pi-shopping-cart text-purple-600 text-3xl"></i>
                </div>
                <div class="stat-details">
                  <span class="stat-label">Rifiuti Totali</span>
                  <h2 class="stat-value">{{ formatWeight(data.overview.totalWasteKg) }}</h2>
                  <span class="stat-subtitle">tonnellate</span>
                </div>
              </div>
            </p-card>
          </div>

          <div class="col-12 md:col-3">
            <p-card styleClass="stat-card">
              <div class="stat-content">
                <div class="stat-icon" [class]="complianceBgClass()">
                  <i class="pi pi-shield text-3xl" [class]="complianceIconClass()"></i>
                </div>
                <div class="stat-details">
                  <span class="stat-label">Conformità</span>
                  <h2 class="stat-value">{{ (data.compliance.score * 100).toFixed(0) }}%</h2>
                  <p-tag
                    [value]="data.compliance.level"
                    [severity]="getComplianceSeverity(data.compliance.level)"
                  />
                </div>
              </div>
            </p-card>
          </div>
        </div>

        <!-- Charts Row 1 -->
        <div class="grid mb-4">
          <!-- Status Breakdown -->
          <div class="col-12 md:col-6">
            <p-card header="Stato FIR">
              <p-chart
                type="pie"
                [data]="statusChartData()"
                [options]="chartOptions"
                height="300px"
              />
            </p-card>
          </div>

          <!-- Waste by Destination -->
          <div class="col-12 md:col-6">
            <p-card header="Destinazione Rifiuti">
              <p-chart
                type="doughnut"
                [data]="destinationChartData()"
                [options]="chartOptions"
                height="300px"
              />
              <p-divider />
              <div class="text-center">
                <p class="text-lg font-semibold">
                  Tasso di Riciclo: {{ (data.waste.recyclingRate * 100).toFixed(1) }}%
                </p>
                <p-progressBar
                  [value]="data.waste.recyclingRate * 100"
                  [showValue]="false"
                  styleClass="mt-2"
                />
              </div>
            </p-card>
          </div>
        </div>

        <!-- Charts Row 2 -->
        <div class="grid mb-4">
          <!-- Top CER Codes -->
          <div class="col-12 md:col-6">
            <p-card header="Top 10 Codici CER">
              <p-chart
                type="bar"
                [data]="cerChartData()"
                [options]="barChartOptions"
                height="300px"
              />
            </p-card>
          </div>

          <!-- Trends -->
          <div class="col-12 md:col-6">
            <p-card header="Andamento Mensile">
              <div class="trend-stats mb-4">
                <div class="trend-item">
                  <span class="trend-label">Mese Corrente</span>
                  <span class="trend-value">{{ data.trends.monthOverMonth.current }}</span>
                </div>
                <div class="trend-item">
                  <span class="trend-label">Mese Precedente</span>
                  <span class="trend-value">{{ data.trends.monthOverMonth.previous }}</span>
                </div>
                <div class="trend-item">
                  <span class="trend-label">Crescita</span>
                  <span class="trend-value" [class.text-green-600]="data.trends.monthOverMonth.percentage > 0">
                    {{ (data.trends.monthOverMonth.percentage * 100).toFixed(1) }}%
                  </span>
                </div>
                <div class="trend-item">
                  <span class="trend-label">Previsione Prossimo Mese</span>
                  <span class="trend-value text-blue-600">{{ data.trends.prediction.nextMonth }}</span>
                </div>
              </div>
            </p-card>
          </div>
        </div>

        <!-- Metrics Row -->
        <div class="grid mb-4">
          <!-- RENTRI Sync -->
          <div class="col-12 md:col-6">
            <p-card header="Stato Sincronizzazione RENTRI">
              <div class="metric-grid">
                <div class="metric-item">
                  <span class="metric-label">Tasso Sincronizzazione</span>
                  <p-progressBar
                    [value]="data.rentri.syncRate * 100"
                    [showValue]="true"
                    valueTemplate="{value}%"
                  />
                </div>
                <div class="metric-row">
                  <div>
                    <p class="text-sm text-gray-600 mb-1">FIR Sincronizzati</p>
                    <p class="text-2xl font-bold text-green-600">{{ data.rentri.synced }}</p>
                  </div>
                  <div>
                    <p class="text-sm text-gray-600 mb-1">In Attesa</p>
                    <p class="text-2xl font-bold text-orange-600">{{ data.rentri.pending }}</p>
                  </div>
                </div>
              </div>
            </p-card>
          </div>

          <!-- Signatures -->
          <div class="col-12 md:col-6">
            <p-card header="Firme Digitali">
              <div class="metric-grid">
                <div class="metric-item">
                  <span class="metric-label">Tasso Completamento</span>
                  <p-progressBar
                    [value]="data.signatures.completionRate * 100"
                    [showValue]="true"
                    valueTemplate="{value}%"
                  />
                </div>
                <div class="metric-row">
                  <div>
                    <p class="text-sm text-gray-600 mb-1">Firme Complete</p>
                    <p class="text-2xl font-bold text-green-600">{{ data.signatures.completed }}</p>
                  </div>
                  <div>
                    <p class="text-sm text-gray-600 mb-1">Tempo Medio</p>
                    <p class="text-2xl font-bold text-blue-600">{{ data.signatures.averageTimeHours }}h</p>
                  </div>
                </div>
              </div>
            </p-card>
          </div>
        </div>

        <!-- Top Lists -->
        <div class="grid">
          <div class="col-12 md:col-6">
            <p-card header="Top 5 Produttori">
              <div class="top-list">
                <div *ngFor="let producer of data.top.producers; let i = index"
                     class="top-list-item">
                  <span class="top-rank">{{ i + 1 }}</span>
                  <span class="top-label">{{ producer.partitaIva }}</span>
                  <p-tag [value]="producer.count + ' FIR'" severity="info" />
                </div>
              </div>
            </p-card>
          </div>

          <div class="col-12 md:col-6">
            <p-card header="Top 5 Trasportatori">
              <div class="top-list">
                <div *ngFor="let carrier of data.top.carriers; let i = index"
                     class="top-list-item">
                  <span class="top-rank">{{ i + 1 }}</span>
                  <span class="top-label">{{ carrier.partitaIva }}</span>
                  <p-tag [value]="carrier.count + ' FIR'" severity="warning" />
                </div>
              </div>
            </p-card>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dashboard-page {
      padding: 2rem;
    }

    .stat-card {
      height: 100%;
    }

    .stat-content {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .stat-icon {
      width: 60px;
      height: 60px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .stat-details {
      flex: 1;
    }

    .stat-label {
      font-size: 0.875rem;
      color: #6b7280;
      text-transform: uppercase;
      font-weight: 500;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      margin: 0.25rem 0;
    }

    .stat-subtitle, .stat-change {
      font-size: 0.875rem;
      color: #6b7280;
    }

    .trend-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .trend-item {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .trend-label {
      font-size: 0.875rem;
      color: #6b7280;
    }

    .trend-value {
      font-size: 1.5rem;
      font-weight: 700;
    }

    .metric-grid {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .metric-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    .metric-label {
      display: block;
      margin-bottom: 0.5rem;
      font-size: 0.875rem;
      color: #6b7280;
    }

    .top-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .top-list-item {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      background: #f9fafb;
      border-radius: 8px;
    }

    .top-rank {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: #3b82f6;
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
    }

    .top-label {
      flex: 1;
      font-family: monospace;
    }
  `]
})
export class DashboardPageComponent implements OnInit {
  private readonly dashboardService = inject(DashboardService);
  private readonly messageService = inject(MessageService);

  protected readonly isLoading = signal(false);
  protected readonly dashboard = signal<DashboardData | null>(null);

  protected readonly chartOptions = {
    plugins: {
      legend: {
        position: 'bottom' as const,
      },
    },
  };

  protected readonly barChartOptions = {
    ...this.chartOptions,
    indexAxis: 'y' as const,
  };

  // Computed values
  protected readonly growthPercentage = computed(() => {
    const data = this.dashboard();
    return data ? data.trends.monthOverMonth.percentage : 0;
  });

  protected readonly completionRate = computed(() => {
    const data = this.dashboard();
    if (!data || data.overview.totalFIRs === 0) return 0;
    return data.overview.completedFIRs / data.overview.totalFIRs;
  });

  protected readonly statusChartData = computed(() => {
    const data = this.dashboard();
    if (!data) return {};

    return {
      labels: Object.keys(data.status.breakdown),
      datasets: [{
        data: Object.values(data.status.breakdown),
        backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'],
      }],
    };
  });

  protected readonly destinationChartData = computed(() => {
    const data = this.dashboard();
    if (!data) return {};

    return {
      labels: ['Recupero', 'Smaltimento'],
      datasets: [{
        data: [
          data.waste.byDestination.recovery.count,
          data.waste.byDestination.disposal.count,
        ],
        backgroundColor: ['#10b981', '#ef4444'],
      }],
    };
  });

  protected readonly cerChartData = computed(() => {
    const data = this.dashboard();
    if (!data) return {};

    const top10 = data.waste.byCERCode.slice(0, 10);

    return {
      labels: top10.map(w => w.cerCode),
      datasets: [{
        label: 'Quantità (kg)',
        data: top10.map(w => w.totalQuantity),
        backgroundColor: '#3b82f6',
      }],
    };
  });

  ngOnInit(): void {
    this.loadDashboard();
  }

  protected async loadDashboard(): Promise<void> {
    this.isLoading.set(true);

    try {
      const data = await this.dashboardService.getDashboard().toPromise();
      this.dashboard.set(data || null);
    } catch (error) {
      console.error('Failed to load dashboard', error);
      this.messageService.add({
        severity: 'error',
        summary: 'Errore',
        detail: 'Impossibile caricare i dati del dashboard',
      });
    } finally {
      this.isLoading.set(false);
    }
  }

  protected exportCSV(): void {
    this.dashboardService.downloadExport('csv');
    this.messageService.add({
      severity: 'success',
      summary: 'Export Avviato',
      detail: 'Il download del CSV inizierà a breve',
    });
  }

  protected formatWeight(kg: number): string {
    return (kg / 1000).toFixed(1);
  }

  protected complianceBgClass(): string {
    const data = this.dashboard();
    if (!data) return 'bg-gray-100';

    const score = data.compliance.score;
    if (score >= 0.9) return 'bg-green-100';
    if (score >= 0.7) return 'bg-blue-100';
    if (score >= 0.5) return 'bg-orange-100';
    return 'bg-red-100';
  }

  protected complianceIconClass(): string {
    const data = this.dashboard();
    if (!data) return 'text-gray-600';

    const score = data.compliance.score;
    if (score >= 0.9) return 'text-green-600';
    if (score >= 0.7) return 'text-blue-600';
    if (score >= 0.5) return 'text-orange-600';
    return 'text-red-600';
  }

  protected getComplianceSeverity(level: string): 'success' | 'info' | 'warning' | 'danger' {
    const severities: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
      EXCELLENT: 'success',
      GOOD: 'info',
      NEEDS_IMPROVEMENT: 'warning',
      CRITICAL: 'danger',
    };
    return severities[level] || 'info';
  }
}
