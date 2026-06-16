import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { ChartModule } from 'primeng/chart';
import { TooltipModule } from 'primeng/tooltip';

/**
 * ConsultantDashboardComponent
 * Aggregated dashboard for consultants managing multiple client tenants
 * Per spec.md: Show cross-tenant KPIs and activity
 *
 * Features:
 * - Total tenant count and overview
 * - Pending FIRs grouped by client
 * - Upcoming MUD deadlines across all clients
 * - RENTRI sync failures requiring attention
 * - Recent activity feed across all tenants
 * - Quick tenant switching from dashboard
 *
 * T115: Consultant dashboard page with aggregated metrics
 */
@Component({
  selector: 'app-consultant-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    TagModule,
    ButtonModule,
    ChartModule,
    TooltipModule,
  ],
  template: `
    <div class="page consultant-dashboard">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Dashboard consulente</h1>
          <p class="page-subtitle">Gestione di {{ dashboardData().totalTenants }} clienti</p>
        </div>
      </header>

      <!-- KPI -->
      <div class="stat-grid kpi-grid">
        <div class="stat-card">
          <span class="stat-card__label"><i class="pi pi-building" aria-hidden="true"></i> Clienti attivi</span>
          <span class="stat-card__value">{{ dashboardData().totalTenants }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__label"><i class="pi pi-file" aria-hidden="true"></i> FIR in attesa</span>
          <span class="stat-card__value">{{ dashboardData().totalPendingFirs }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__label"><i class="pi pi-calendar" aria-hidden="true"></i> Scadenze imminenti</span>
          <span class="stat-card__value">{{ dashboardData().totalMudDeadlines }}</span>
        </div>
        <div class="stat-card">
          <span class="stat-card__label"><i class="pi pi-exclamation-triangle" aria-hidden="true"></i> Errori di sincronizzazione</span>
          <span class="stat-card__value" [class.stat-danger]="dashboardData().totalRentriSyncFailures > 0">{{ dashboardData().totalRentriSyncFailures }}</span>
        </div>
      </div>

      <!-- FIR in attesa per cliente -->
      <section class="surface-card mb-section" aria-label="FIR in attesa per cliente">
        <h2 class="card-title">FIR in attesa per cliente</h2>
        <div class="table-responsive">
          <p-table
            [value]="dashboardData().pendingFirsByClient"
            [paginator]="true"
            [rows]="10"
            styleClass="p-datatable-sm">

            <ng-template pTemplate="header">
              <tr>
                <th>Cliente</th>
                <th>ID tenant</th>
                <th style="width: 8rem">In attesa</th>
                <th style="width: 10rem">Azioni</th>
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-client>
              <tr>
                <td>{{ client.tenantName }}</td>
                <td><code>{{ client.tenantId }}</code></td>
                <td>
                  <p-tag
                    [value]="client.pendingCount"
                    [severity]="client.pendingCount > 10 ? 'danger' : 'warning'"></p-tag>
                </td>
                <td>
                  <button
                    pButton
                    icon="pi pi-arrow-right"
                    label="Passa"
                    class="p-button-sm"
                    (click)="switchToTenant(client.tenantId)"
                    pTooltip="Passa a questo tenant"
                    [attr.aria-label]="'Passa al tenant ' + client.tenantName"></button>
                </td>
              </tr>
            </ng-template>

            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="4">
                  <div class="empty-state">
                    <i class="pi pi-check-circle empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessun FIR in attesa tra tutti i clienti</p>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>

      <!-- Scadenze imminenti -->
      <section class="surface-card mb-section" aria-label="Scadenze MUD imminenti">
        <h2 class="card-title">Scadenze MUD imminenti</h2>
        <div class="table-responsive">
          <p-table
            [value]="dashboardData().upcomingDeadlines"
            [paginator]="true"
            [rows]="10"
            styleClass="p-datatable-sm">

            <ng-template pTemplate="header">
              <tr>
                <th>Cliente</th>
                <th>Tipo scadenza</th>
                <th>Data</th>
                <th>Giorni rimanenti</th>
                <th style="width: 10rem">Azioni</th>
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-deadline>
              <tr>
                <td>{{ deadline.tenantName }}</td>
                <td>{{ deadline.deadlineType }}</td>
                <td>{{ deadline.deadlineDate | date: 'short' }}</td>
                <td>
                  <p-tag
                    [value]="getDaysRemaining(deadline.deadlineDate) + ' giorni'"
                    [severity]="getSeverityForDeadline(deadline.deadlineDate)"></p-tag>
                </td>
                <td>
                  <button
                    pButton
                    icon="pi pi-arrow-right"
                    label="Vedi"
                    class="p-button-sm p-button-outlined"
                    (click)="switchToTenant(deadline.tenantId)"
                    [attr.aria-label]="'Vedi il tenant ' + deadline.tenantName"></button>
                </td>
              </tr>
            </ng-template>

            <ng-template pTemplate="emptymessage">
              <tr>
                <td colspan="5">
                  <div class="empty-state">
                    <i class="pi pi-check-circle empty-state__icon" aria-hidden="true"></i>
                    <p class="empty-state__title">Nessuna scadenza imminente</p>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </div>
      </section>

      <!-- Errori di sincronizzazione RENTRI -->
      <section class="surface-card mb-section" *ngIf="dashboardData().totalRentriSyncFailures > 0" aria-label="Errori di sincronizzazione RENTRI">
        <h2 class="card-title">Errori di sincronizzazione RENTRI</h2>
        <div class="sync-failures-grid">
          <div
            *ngFor="let failure of dashboardData().rentriSyncFailures"
            class="sync-failure-item">
            <div class="failure-header">
              <span class="failure-tenant">{{ failure.tenantName }}</span>
              <p-tag
                [value]="failure.failureCount + ' errori'"
                severity="danger"></p-tag>
            </div>
            <div class="failure-details">
              <span class="failure-last-attempt">
                Ultimo tentativo: {{ failure.lastAttemptAt | date: 'short' }}
              </span>
              <span class="failure-error">{{ failure.errorMessage }}</span>
            </div>
            <div class="failure-actions">
              <button
                pButton
                icon="pi pi-refresh"
                label="Riprova"
                class="p-button-sm p-button-danger"
                (click)="retryRentriSync(failure.tenantId)"></button>
              <button
                pButton
                icon="pi pi-arrow-right"
                label="Passa"
                class="p-button-sm p-button-outlined"
                (click)="switchToTenant(failure.tenantId)"></button>
            </div>
          </div>
        </div>
      </section>

      <!-- Andamento FIR in attesa -->
      <section class="surface-card mb-section" aria-label="Andamento FIR in attesa (ultimi 7 giorni)">
        <h2 class="card-title">Andamento FIR in attesa (ultimi 7 giorni)</h2>
        <p-chart
          type="line"
          [data]="pendingFirsTrendData()"
          [options]="chartOptions()"
          [style]="{ width: '100%', height: '300px' }"></p-chart>
      </section>

      <!-- Timeline scadenze -->
      <section class="surface-card mb-section" aria-label="Timeline delle scadenze">
        <h2 class="card-title">Timeline delle scadenze</h2>
        <div class="deadline-timeline">
          <div
            *ngFor="let deadline of dashboardData().upcomingDeadlines.slice(0, 5)"
            class="timeline-item"
            [class.urgent]="getDaysRemaining(deadline.deadlineDate) <= 7"
            [class.warning]="getDaysRemaining(deadline.deadlineDate) > 7 && getDaysRemaining(deadline.deadlineDate) <= 14">
            <div class="timeline-marker" aria-hidden="true"></div>
            <div class="timeline-content">
              <div class="timeline-header">
                <strong>{{ deadline.tenantName }}</strong>
                <span class="timeline-date">{{ deadline.deadlineDate | date: 'mediumDate' }}</span>
              </div>
              <p class="timeline-description">{{ deadline.deadlineType }}</p>
              <div class="timeline-footer">
                <p-tag
                  [value]="getDaysRemaining(deadline.deadlineDate) + ' giorni rimanenti'"
                  [severity]="getSeverityForDeadline(deadline.deadlineDate)"></p-tag>
              </div>
            </div>
          </div>

          <div *ngIf="dashboardData().upcomingDeadlines.length === 0" class="empty-state">
            <i class="pi pi-check-circle empty-state__icon" aria-hidden="true"></i>
            <p class="empty-state__title">Nessuna scadenza imminente</p>
          </div>
        </div>
      </section>

      <!-- Attività recenti -->
      <section class="surface-card mb-section" aria-label="Attività recenti tra tutti i clienti">
        <h2 class="card-title">Attività recenti tra tutti i clienti</h2>
        <div class="activity-feed">
          <div
            *ngFor="let activity of dashboardData().recentActivity"
            class="activity-item">
            <div class="activity-icon" aria-hidden="true">
              <i class="pi pi-file"></i>
            </div>
            <div class="activity-details">
              <div class="activity-header">
                <strong>{{ activity.tenantName }}</strong>
                <span class="activity-time">{{ activity.activityDate | date: 'short' }}</span>
              </div>
              <p class="activity-description">{{ activity.description }}</p>
            </div>
          </div>

          <div *ngIf="dashboardData().recentActivity.length === 0" class="empty-state">
            <i class="pi pi-info-circle empty-state__icon" aria-hidden="true"></i>
            <p class="empty-state__title">Nessuna attività recente</p>
          </div>
        </div>
      </section>

      <!-- Stato di caricamento -->
      <div *ngIf="isLoading()" class="loading-overlay" role="status" aria-live="polite">
        <i class="pi pi-spin pi-spinner" style="font-size: 3rem" aria-hidden="true"></i>
        <p>Caricamento della dashboard...</p>
      </div>
    </div>
  `,
  styles: [`
    .consultant-dashboard { position: relative; }

    .card-title {
      font-family: var(--font-display);
      font-size: var(--font-size-xl);
      margin: 0 0 var(--spacing-base);
    }

    .mb-section { margin-bottom: var(--spacing-lg); }

    .kpi-grid { margin-bottom: var(--spacing-lg); }
    .stat-card__label { display: inline-flex; align-items: center; gap: var(--spacing-sm); }
    .stat-card__label i { color: var(--brand-primary); }
    .stat-danger { color: var(--color-danger); }

    .activity-feed { max-height: 500px; overflow-y: auto; }

    .activity-item {
      display: flex;
      gap: var(--spacing-base);
      padding: var(--spacing-base);
      border-bottom: 1px solid var(--surface-border);
    }
    .activity-item:last-child { border-bottom: none; }

    .activity-icon {
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--brand-primary-50);
      color: var(--brand-primary-dark);
      border-radius: var(--radius-full);
      flex-shrink: 0;
    }

    .activity-details { flex: 1; min-width: 0; }
    .activity-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--spacing-sm);
      margin-bottom: var(--spacing-sm);
    }
    .activity-time { color: var(--text-tertiary); font-size: var(--font-size-sm); }
    .activity-description { margin: 0; color: var(--text-secondary); }

    .loading-overlay {
      position: absolute;
      inset: 0;
      background: rgba(255, 255, 255, 0.9);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--spacing-base);
      color: var(--text-secondary);
      z-index: var(--z-modal);
    }
    .loading-overlay i { color: var(--brand-primary); }

    /* Errori RENTRI */
    .sync-failures-grid { display: grid; gap: var(--spacing-base); }
    .sync-failure-item {
      padding: var(--spacing-base);
      border: 1px solid var(--color-danger);
      border-radius: var(--radius-md);
      background: var(--color-danger-bg);
    }
    .failure-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--spacing-sm);
      margin-bottom: var(--spacing-md);
    }
    .failure-tenant { font-weight: var(--font-weight-semibold); color: var(--text-primary); }
    .failure-details {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm);
      margin-bottom: var(--spacing-base);
    }
    .failure-last-attempt { font-size: var(--font-size-sm); color: var(--text-tertiary); }
    .failure-error {
      font-size: var(--font-size-sm);
      color: var(--color-danger);
      font-family: var(--font-family-mono);
      word-break: break-word;
    }
    .failure-actions { display: flex; flex-wrap: wrap; gap: var(--spacing-sm); }

    /* Timeline scadenze */
    .deadline-timeline { padding: var(--spacing-sm) 0; }
    .timeline-item {
      display: flex;
      gap: var(--spacing-base);
      padding: var(--spacing-base);
      border-left: 3px solid var(--brand-primary);
      margin-bottom: var(--spacing-base);
      background: var(--color-gray-50);
      border-radius: 0 var(--radius-base) var(--radius-base) 0;
      transition: background var(--transition-base), box-shadow var(--transition-base);
    }
    .timeline-item:hover { background: var(--surface-hover); box-shadow: var(--shadow-sm); }
    .timeline-item.warning { border-left-color: var(--color-warning); background: var(--color-warning-bg); }
    .timeline-item.urgent { border-left-color: var(--color-danger); background: var(--color-danger-bg); }

    .timeline-marker {
      width: 12px;
      height: 12px;
      border-radius: var(--radius-full);
      background: currentColor;
      margin-top: 0.4rem;
      flex-shrink: 0;
    }
    .timeline-content { flex: 1; min-width: 0; }
    .timeline-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--spacing-sm);
      margin-bottom: var(--spacing-sm);
    }
    .timeline-date { color: var(--text-tertiary); font-size: var(--font-size-sm); }
    .timeline-description { margin: var(--spacing-sm) 0; color: var(--text-secondary); }
    .timeline-footer { margin-top: var(--spacing-md); }

    @media (max-width: 576px) {
      .failure-actions button, .timeline-item { width: 100%; }
    }
  `]
})
export class ConsultantDashboardComponent implements OnInit {
  private readonly http = inject(HttpClient);

  dashboardData = signal<any>({
    totalTenants: 0,
    totalPendingFirs: 0,
    totalMudDeadlines: 0,
    totalRentriSyncFailures: 0,
    pendingFirsByClient: [],
    upcomingDeadlines: [],
    recentActivity: [],
    rentriSyncFailures: [],
    pendingFirsTrend: [],
  });

  isLoading = signal(false);

  // Chart data for pending FIRs trend
  pendingFirsTrendData = signal<any>({
    labels: [],
    datasets: [
      {
        label: 'FIR in attesa',
        data: [],
        fill: false,
        borderColor: '#0d9488',
        tension: 0.4,
        pointBackgroundColor: '#0d9488',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 5,
      },
    ],
  });

  chartOptions = signal<any>({
    maintainAspectRatio: false,
    responsive: true,
    plugins: {
      legend: {
        display: true,
        position: 'top',
      },
      tooltip: {
        mode: 'index',
        intersect: false,
      },
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: 'Data',
        },
      },
      y: {
        display: true,
        title: {
          display: true,
          text: 'Conteggio',
        },
        beginAtZero: true,
      },
    },
  });

  ngOnInit(): void {
    this.loadDashboard();
  }

  private loadDashboard(): void {
    this.isLoading.set(true);

    this.http.get('/api/v1/consultant/dashboard').subscribe({
      next: (data: any) => {
        this.dashboardData.set(data);
        this.updateChartData(data.pendingFirsTrend || []);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Failed to load consultant dashboard:', error);
        this.isLoading.set(false);
      },
    });
  }

  private updateChartData(trendData: any[]): void {
    const labels = trendData.map((item) => item.date);
    const data = trendData.map((item) => item.count);

    this.pendingFirsTrendData.set({
      labels,
      datasets: [
        {
          label: 'FIR in attesa',
          data,
          fill: false,
          borderColor: '#0d9488',
          tension: 0.4,
          pointBackgroundColor: '#0d9488',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointRadius: 5,
        },
      ],
    });
  }

  switchToTenant(tenantId: string): void {
    // This will be implemented with the tenant switch service (T117)
    console.log('Switching to tenant:', tenantId);
  }

  retryRentriSync(tenantId: string): void {
    console.log('Retrying RENTRI sync for tenant:', tenantId);

    this.http.post(`/api/v1/consultant/tenants/${tenantId}/retry-rentri-sync`, {}).subscribe({
      next: () => {
        console.log('RENTRI sync retry initiated');
        // Reload dashboard to update sync status
        this.loadDashboard();
      },
      error: (error) => {
        console.error('Failed to retry RENTRI sync:', error);
      },
    });
  }

  getDaysRemaining(deadlineDate: string): number {
    const deadline = new Date(deadlineDate);
    const now = new Date();
    const diffTime = deadline.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }

  getSeverityForDeadline(deadlineDate: string): 'success' | 'warning' | 'danger' {
    const days = this.getDaysRemaining(deadlineDate);
    if (days <= 7) return 'danger';
    if (days <= 14) return 'warning';
    return 'success';
  }
}
