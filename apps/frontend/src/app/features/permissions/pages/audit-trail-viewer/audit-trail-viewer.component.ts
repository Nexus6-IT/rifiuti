import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { PaginatorModule } from 'primeng/paginator';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { AuditApiService } from '../../services/audit-api.service';
import { AuditTimelineComponent } from '../../components/audit-timeline/audit-timeline.component';
import { AuditFiltersComponent } from '../../components/audit-filters/audit-filters.component';
import { CsvExportButtonComponent } from '../../components/csv-export-button/csv-export-button.component';

/**
 * AuditTrailViewerComponent
 * Main page for viewing and filtering audit logs
 * T156: Audit trail viewer page per User Story 4
 *
 * Purpose: Provide comprehensive audit trail viewer for compliance officers
 *
 * Requirements from spec.md FR-018:
 * - Display audit logs in timeline format
 * - Filter by user, date range, decision, resource
 * - Export to CSV for ARPA inspections
 * - Paginate large result sets
 * - Show performance metrics
 *
 * Requirements from plan.md:
 * - <500ms P95 query latency display
 * - Support up to 1M audit logs per tenant
 * - Mobile-friendly responsive design
 * - Real-time updates (optional)
 */
@Component({
  selector: 'app-audit-trail-viewer',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ButtonModule,
    PaginatorModule,
    ProgressSpinnerModule,
    MessageModule,
    AuditTimelineComponent,
    AuditFiltersComponent,
    CsvExportButtonComponent,
  ],
  template: `
    <div class="audit-trail-viewer">
      <!-- Header -->
      <div class="page-header">
        <div class="header-content">
          <h1>
            <i class="pi pi-shield"></i>
            Audit Trail
          </h1>
          <p class="header-subtitle">
            View and analyze permission check logs for compliance
          </p>
        </div>

        <div class="header-actions">
          <app-csv-export-button [filters]="exportFilters()"></app-csv-export-button>
          <button
            pButton
            type="button"
            label="Refresh"
            icon="pi pi-refresh"
            class="p-button-outlined"
            (click)="loadAuditLogs()"
            [disabled]="isLoading()"
          ></button>
        </div>
      </div>

      <!-- Filters -->
      <app-audit-filters
        (filtersChanged)="onFiltersChanged($event)"
      ></app-audit-filters>

      <!-- Statistics Card -->
      @if (statistics()) {
        <p-card class="statistics-card">
          <div class="statistics-grid">
            <div class="stat-item">
              <div class="stat-icon" style="background: var(--blue-100); color: var(--blue-700);">
                <i class="pi pi-list"></i>
              </div>
              <div class="stat-content">
                <span class="stat-value">{{ statistics()!.totalLogs | number }}</span>
                <span class="stat-label">Total Logs</span>
              </div>
            </div>

            <div class="stat-item">
              <div class="stat-icon" style="background: var(--green-100); color: var(--green-700);">
                <i class="pi pi-check"></i>
              </div>
              <div class="stat-content">
                <span class="stat-value">{{ statistics()!.allowedCount | number }}</span>
                <span class="stat-label">Allowed</span>
              </div>
            </div>

            <div class="stat-item">
              <div class="stat-icon" style="background: var(--red-100); color: var(--red-700);">
                <i class="pi pi-times"></i>
              </div>
              <div class="stat-content">
                <span class="stat-value">{{ statistics()!.deniedCount | number }}</span>
                <span class="stat-label">Denied</span>
              </div>
            </div>

            <div class="stat-item">
              <div class="stat-icon" style="background: var(--purple-100); color: var(--purple-700);">
                <i class="pi pi-users"></i>
              </div>
              <div class="stat-content">
                <span class="stat-value">{{ statistics()!.uniqueUsers | number }}</span>
                <span class="stat-label">Unique Users</span>
              </div>
            </div>
          </div>
        </p-card>
      }

      <!-- Performance Metrics -->
      @if (performanceMetrics()) {
        <p-message
          [severity]="performanceMetrics()!.exceededTarget ? 'warn' : 'info'"
          [text]="'Query completed in ' + performanceMetrics()!.queryTimeMs.toFixed(2) + 'ms' + (performanceMetrics()!.exceededTarget ? ' (exceeded 500ms target)' : '')"
        ></p-message>
      }

      <!-- Loading State -->
      @if (isLoading()) {
        <div class="loading-container">
          <p-progressSpinner></p-progressSpinner>
          <p>Loading audit logs...</p>
        </div>
      }

      <!-- Error State -->
      @if (error()) {
        <p-message
          severity="error"
          [text]="'Failed to load audit logs: ' + error()"
        ></p-message>
      }

      <!-- Audit Timeline -->
      @if (!isLoading() && !error() && auditLogs().length > 0) {
        <p-card class="timeline-card">
          <app-audit-timeline
            [logs]="auditLogs()"
            [showDetails]="showDetails()"
          ></app-audit-timeline>
        </p-card>
      }

      <!-- Empty State -->
      @if (!isLoading() && !error() && auditLogs().length === 0) {
        <p-card class="empty-state-card">
          <div class="empty-state">
            <i class="pi pi-info-circle"></i>
            <h3>No audit logs found</h3>
            <p>Try adjusting your filters or check back later</p>
          </div>
        </p-card>
      }

      <!-- Pagination -->
      @if (pagination() && pagination()!.total > 0) {
        <p-paginator
          [rows]="pagination()!.pageSize || 50"
          [totalRecords]="pagination()!.total"
          [first]="((pagination()!.page || 1) - 1) * (pagination()!.pageSize || 50)"
          (onPageChange)="onPageChange($event)"
        ></p-paginator>
      }
    </div>
  `,
  styles: [`
    .audit-trail-viewer {
      padding: 2rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 2rem;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .header-content h1 {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin: 0 0 0.5rem 0;
      font-size: 2rem;
      font-weight: 700;
      color: var(--text-color);
    }

    .header-subtitle {
      margin: 0;
      color: var(--text-color-secondary);
      font-size: 1rem;
    }

    .header-actions {
      display: flex;
      gap: 1rem;
      align-items: center;
    }

    .statistics-card {
      margin-bottom: 1.5rem;
    }

    .statistics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1.5rem;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .stat-icon {
      width: 3rem;
      height: 3rem;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
    }

    .stat-content {
      display: flex;
      flex-direction: column;
    }

    .stat-value {
      font-size: 1.75rem;
      font-weight: 700;
      line-height: 1;
      margin-bottom: 0.25rem;
      color: var(--text-color);
    }

    .stat-label {
      font-size: 0.875rem;
      color: var(--text-color-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .timeline-card {
      margin-top: 1.5rem;
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem;
      gap: 1rem;
    }

    .loading-container p {
      color: var(--text-color-secondary);
    }

    .empty-state-card {
      margin-top: 1.5rem;
    }

    .empty-state {
      text-align: center;
      padding: 4rem;
    }

    .empty-state i {
      font-size: 4rem;
      color: var(--text-color-secondary);
      opacity: 0.5;
      margin-bottom: 1.5rem;
    }

    .empty-state h3 {
      margin: 0 0 0.5rem 0;
      font-size: 1.5rem;
      color: var(--text-color);
    }

    .empty-state p {
      margin: 0;
      color: var(--text-color-secondary);
    }

    /* Mobile responsive */
    @media (max-width: 768px) {
      .audit-trail-viewer {
        padding: 1rem;
      }

      .page-header {
        flex-direction: column;
        align-items: flex-start;
      }

      .header-actions {
        width: 100%;
        flex-direction: column;
      }

      .header-actions button {
        width: 100%;
      }

      .statistics-grid {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class AuditTrailViewerComponent implements OnInit {
  // Signals
  isLoading = signal(false);
  error = signal<string | null>(null);
  auditLogs = signal<any[]>([]);
  pagination = signal<{
    total: number;
    page?: number;
    pageSize?: number;
    totalPages: number;
  } | null>(null);
  performanceMetrics = signal<{
    queryTimeMs: number;
    exceededTarget: boolean;
  } | null>(null);
  statistics = signal<{
    totalLogs: number;
    allowedCount: number;
    deniedCount: number;
    uniqueUsers: number;
  } | null>(null);
  showDetails = signal(false);

  // Filters
  currentFilters: any = {};
  currentPage = 1;
  pageSize = 50;

  // Computed
  exportFilters = computed(() => ({
    userId: this.currentFilters.userId,
    startDate: this.currentFilters.startDate,
    endDate: this.currentFilters.endDate,
  }));

  constructor(private auditApiService: AuditApiService) {}

  ngOnInit(): void {
    this.loadAuditLogs();
    this.loadStatistics();
  }

  loadAuditLogs(): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.auditApiService
      .getAuditTrail({
        ...this.currentFilters,
        page: this.currentPage,
        pageSize: this.pageSize,
      })
      .subscribe({
        next: (response) => {
          this.auditLogs.set(response.data.logs);
          this.pagination.set(response.data.pagination);
          this.performanceMetrics.set(response.data.performanceMetrics || null);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.error.set(error.message || 'Unknown error');
          this.isLoading.set(false);
        },
      });
  }

  loadStatistics(): void {
    this.auditApiService.getStatistics(this.currentFilters).subscribe({
      next: (response) => {
        this.statistics.set(response.data);
      },
      error: (error) => {
        console.error('Failed to load statistics:', error);
      },
    });
  }

  onFiltersChanged(filters: any): void {
    this.currentFilters = filters;
    this.currentPage = 1; // Reset to first page
    this.loadAuditLogs();
    this.loadStatistics();
  }

  onPageChange(event: any): void {
    this.currentPage = event.page + 1; // PrimeNG uses 0-based pages
    this.pageSize = event.rows;
    this.loadAuditLogs();
  }
}
