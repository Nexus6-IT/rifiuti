import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { CardModule } from 'primeng/card';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { ChartModule } from 'primeng/chart';

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
    CardModule,
    TableModule,
    TagModule,
    ButtonModule,
    ChartModule,
  ],
  template: `
    <div class="consultant-dashboard">
      <div class="dashboard-header">
        <h1>Consultant Dashboard</h1>
        <p class="subtitle">Managing {{ dashboardData().totalTenants }} client tenants</p>
      </div>

      <!-- KPI Summary Cards -->
      <div class="kpi-grid">
        <p-card styleClass="kpi-card">
          <div class="kpi-content">
            <i class="pi pi-building kpi-icon"></i>
            <div class="kpi-details">
              <span class="kpi-value">{{ dashboardData().totalTenants }}</span>
              <span class="kpi-label">Active Clients</span>
            </div>
          </div>
        </p-card>

        <p-card styleClass="kpi-card">
          <div class="kpi-content">
            <i class="pi pi-file kpi-icon warning"></i>
            <div class="kpi-details">
              <span class="kpi-value">{{ dashboardData().totalPendingFirs }}</span>
              <span class="kpi-label">Pending FIRs</span>
            </div>
          </div>
        </p-card>

        <p-card styleClass="kpi-card">
          <div class="kpi-content">
            <i class="pi pi-calendar kpi-icon info"></i>
            <div class="kpi-details">
              <span class="kpi-value">{{ dashboardData().totalMudDeadlines }}</span>
              <span class="kpi-label">Upcoming Deadlines</span>
            </div>
          </div>
        </p-card>

        <p-card styleClass="kpi-card">
          <div class="kpi-content">
            <i class="pi pi-exclamation-triangle kpi-icon danger"></i>
            <div class="kpi-details">
              <span class="kpi-value">{{ dashboardData().totalRentriSyncFailures }}</span>
              <span class="kpi-label">Sync Failures</span>
            </div>
          </div>
        </p-card>
      </div>

      <!-- Pending FIRs by Client -->
      <p-card header="Pending FIRs by Client" styleClass="mb-4">
        <p-table
          [value]="dashboardData().pendingFirsByClient"
          [paginator]="true"
          [rows]="10"
          styleClass="p-datatable-sm">

          <ng-template pTemplate="header">
            <tr>
              <th>Client</th>
              <th>Tenant ID</th>
              <th style="width: 8rem">Pending Count</th>
              <th style="width: 10rem">Actions</th>
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
                  label="Switch"
                  class="p-button-sm"
                  (click)="switchToTenant(client.tenantId)"
                  pTooltip="Switch to this tenant"></button>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="4">No pending FIRs across all clients</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- Upcoming Deadlines -->
      <p-card header="Upcoming MUD Deadlines" styleClass="mb-4">
        <p-table
          [value]="dashboardData().upcomingDeadlines"
          [paginator]="true"
          [rows]="10"
          styleClass="p-datatable-sm">

          <ng-template pTemplate="header">
            <tr>
              <th>Client</th>
              <th>Deadline Type</th>
              <th>Due Date</th>
              <th>Days Remaining</th>
              <th style="width: 10rem">Actions</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-deadline>
            <tr>
              <td>{{ deadline.tenantName }}</td>
              <td>{{ deadline.deadlineType }}</td>
              <td>{{ deadline.deadlineDate | date: 'short' }}</td>
              <td>
                <p-tag
                  [value]="getDaysRemaining(deadline.deadlineDate) + ' days'"
                  [severity]="getSeverityForDeadline(deadline.deadlineDate)"></p-tag>
              </td>
              <td>
                <button
                  pButton
                  icon="pi pi-arrow-right"
                  label="View"
                  class="p-button-sm p-button-outlined"
                  (click)="switchToTenant(deadline.tenantId)"></button>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="5">No upcoming deadlines</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- RENTRI Sync Failures Widget -->
      <p-card header="RENTRI Sync Failures" styleClass="mb-4" *ngIf="dashboardData().totalRentriSyncFailures > 0">
        <div class="sync-failures-grid">
          <div
            *ngFor="let failure of dashboardData().rentriSyncFailures"
            class="sync-failure-item">
            <div class="failure-header">
              <span class="failure-tenant">{{ failure.tenantName }}</span>
              <p-tag
                [value]="failure.failureCount + ' failures'"
                severity="danger"></p-tag>
            </div>
            <div class="failure-details">
              <span class="failure-last-attempt">
                Last attempt: {{ failure.lastAttemptAt | date: 'short' }}
              </span>
              <span class="failure-error">{{ failure.errorMessage }}</span>
            </div>
            <div class="failure-actions">
              <button
                pButton
                icon="pi pi-refresh"
                label="Retry"
                class="p-button-sm p-button-danger"
                (click)="retryRentriSync(failure.tenantId)"></button>
              <button
                pButton
                icon="pi pi-arrow-right"
                label="Switch"
                class="p-button-sm p-button-outlined"
                (click)="switchToTenant(failure.tenantId)"></button>
            </div>
          </div>
        </div>
      </p-card>

      <!-- Pending FIRs Trend Chart -->
      <p-card header="Pending FIRs Trend (Last 7 Days)" styleClass="mb-4">
        <p-chart
          type="line"
          [data]="pendingFirsTrendData()"
          [options]="chartOptions()"
          [style]="{ width: '100%', height: '300px' }"></p-chart>
      </p-card>

      <!-- Deadline Timeline Visualization -->
      <p-card header="Deadline Timeline" styleClass="mb-4">
        <div class="deadline-timeline">
          <div
            *ngFor="let deadline of dashboardData().upcomingDeadlines.slice(0, 5)"
            class="timeline-item"
            [class.urgent]="getDaysRemaining(deadline.deadlineDate) <= 7"
            [class.warning]="getDaysRemaining(deadline.deadlineDate) > 7 && getDaysRemaining(deadline.deadlineDate) <= 14">
            <div class="timeline-marker"></div>
            <div class="timeline-content">
              <div class="timeline-header">
                <strong>{{ deadline.tenantName }}</strong>
                <span class="timeline-date">{{ deadline.deadlineDate | date: 'mediumDate' }}</span>
              </div>
              <p class="timeline-description">{{ deadline.deadlineType }}</p>
              <div class="timeline-footer">
                <p-tag
                  [value]="getDaysRemaining(deadline.deadlineDate) + ' days remaining'"
                  [severity]="getSeverityForDeadline(deadline.deadlineDate)"></p-tag>
              </div>
            </div>
          </div>

          <div *ngIf="dashboardData().upcomingDeadlines.length === 0" class="no-deadlines">
            <i class="pi pi-check-circle"></i>
            <span>No upcoming deadlines</span>
          </div>
        </div>
      </p-card>

      <!-- Recent Activity -->
      <p-card header="Recent Activity Across All Clients" styleClass="mb-4">
        <div class="activity-feed">
          <div
            *ngFor="let activity of dashboardData().recentActivity"
            class="activity-item">
            <div class="activity-icon">
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

          <div *ngIf="dashboardData().recentActivity.length === 0" class="no-activity">
            <i class="pi pi-info-circle"></i>
            <span>No recent activity</span>
          </div>
        </div>
      </p-card>

      <!-- Loading State -->
      <div *ngIf="isLoading()" class="loading-overlay">
        <i class="pi pi-spin pi-spinner" style="font-size: 3rem"></i>
        <p>Loading dashboard...</p>
      </div>
    </div>
  `,
  styles: [`
    .consultant-dashboard {
      padding: 2rem;
      position: relative;
    }

    .dashboard-header {
      margin-bottom: 2rem;
    }

    .subtitle {
      color: #6c757d;
      font-size: 1.125rem;
      margin-top: 0.5rem;
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 1.5rem;
      margin-bottom: 2rem;
    }

    .kpi-card {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .kpi-content {
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }

    .kpi-icon {
      font-size: 3rem;
      color: #1976d2;
    }

    .kpi-icon.warning {
      color: #f57c00;
    }

    .kpi-icon.info {
      color: #0288d1;
    }

    .kpi-icon.danger {
      color: #d32f2f;
    }

    .kpi-details {
      display: flex;
      flex-direction: column;
    }

    .kpi-value {
      font-size: 2.5rem;
      font-weight: 700;
      line-height: 1;
      color: #2c3e50;
    }

    .kpi-label {
      font-size: 0.875rem;
      color: #6c757d;
      margin-top: 0.5rem;
    }

    .activity-feed {
      max-height: 500px;
      overflow-y: auto;
    }

    .activity-item {
      display: flex;
      gap: 1rem;
      padding: 1rem;
      border-bottom: 1px solid #e9ecef;
    }

    .activity-item:last-child {
      border-bottom: none;
    }

    .activity-icon {
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #e3f2fd;
      color: #1976d2;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .activity-details {
      flex: 1;
    }

    .activity-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .activity-time {
      color: #6c757d;
      font-size: 0.875rem;
    }

    .activity-description {
      margin: 0;
      color: #495057;
    }

    .no-activity {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      padding: 3rem;
      color: #6c757d;
      font-style: italic;
    }

    .no-activity i {
      font-size: 3rem;
    }

    .loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.9);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      z-index: 1000;
    }

    :host ::ng-deep .p-card {
      margin-bottom: 1.5rem;
    }

    :host ::ng-deep .p-card-header {
      font-size: 1.25rem;
      font-weight: 600;
    }

    /* RENTRI Sync Failures Widget */
    .sync-failures-grid {
      display: grid;
      gap: 1rem;
    }

    .sync-failure-item {
      padding: 1rem;
      border: 1px solid #ef5350;
      border-radius: 4px;
      background: #ffebee;
    }

    .failure-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }

    .failure-tenant {
      font-weight: 600;
      font-size: 1rem;
      color: #2c3e50;
    }

    .failure-details {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .failure-last-attempt {
      font-size: 0.875rem;
      color: #6c757d;
    }

    .failure-error {
      font-size: 0.875rem;
      color: #d32f2f;
      font-family: 'Courier New', monospace;
    }

    .failure-actions {
      display: flex;
      gap: 0.5rem;
    }

    /* Deadline Timeline */
    .deadline-timeline {
      padding: 1rem 0;
    }

    .timeline-item {
      display: flex;
      gap: 1rem;
      padding: 1rem;
      border-left: 3px solid #1976d2;
      margin-bottom: 1rem;
      background: #f5f5f5;
      border-radius: 0 4px 4px 0;
      transition: all 0.3s ease;
    }

    .timeline-item:hover {
      background: #e3f2fd;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .timeline-item.warning {
      border-left-color: #ff9800;
      background: #fff3e0;
    }

    .timeline-item.urgent {
      border-left-color: #d32f2f;
      background: #ffebee;
      animation: pulse-urgent 2s ease-in-out infinite;
    }

    @keyframes pulse-urgent {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.8;
      }
    }

    .timeline-marker {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: currentColor;
      margin-top: 0.5rem;
      flex-shrink: 0;
    }

    .timeline-content {
      flex: 1;
    }

    .timeline-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .timeline-date {
      color: #6c757d;
      font-size: 0.875rem;
    }

    .timeline-description {
      margin: 0.5rem 0;
      color: #495057;
    }

    .timeline-footer {
      margin-top: 0.75rem;
    }

    .no-deadlines {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      padding: 3rem;
      color: #4caf50;
      font-style: italic;
    }

    .no-deadlines i {
      font-size: 3rem;
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
        label: 'Pending FIRs',
        data: [],
        fill: false,
        borderColor: '#1976d2',
        tension: 0.4,
        pointBackgroundColor: '#1976d2',
        pointBorderColor: '#fff',
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
          text: 'Date',
        },
      },
      y: {
        display: true,
        title: {
          display: true,
          text: 'Count',
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
          label: 'Pending FIRs',
          data,
          fill: false,
          borderColor: '#1976d2',
          tension: 0.4,
          pointBackgroundColor: '#1976d2',
          pointBorderColor: '#fff',
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
