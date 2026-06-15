import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
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
    ButtonModule,
    PaginatorModule,
    ProgressSpinnerModule,
    MessageModule,
    AuditTimelineComponent,
    AuditFiltersComponent,
    CsvExportButtonComponent,
  ],
  template: `
    <div class="page audit-trail-viewer">
      <!-- Intestazione -->
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">
            <i class="pi pi-shield" aria-hidden="true"></i>
            Registro di audit
          </h1>
          <p class="page-subtitle">
            Visualizza e analizza i log dei controlli di permesso per la conformità
          </p>
        </div>

        <div class="page-actions">
          <app-csv-export-button [filters]="exportFilters()"></app-csv-export-button>
          <button
            pButton
            type="button"
            label="Aggiorna"
            icon="pi pi-refresh"
            class="p-button-outlined"
            (click)="loadAuditLogs()"
            [disabled]="isLoading()"
          ></button>
        </div>
      </header>

      <!-- Filtri -->
      <app-audit-filters
        (filtersChanged)="onFiltersChanged($event)"
      ></app-audit-filters>

      <!-- Statistiche -->
      @if (statistics()) {
        <div class="stat-grid statistics-grid">
          <div class="stat-card">
            <span class="stat-card__label">Log totali</span>
            <span class="stat-card__value">{{ statistics()!.totalLogs | number }}</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Consentiti</span>
            <span class="stat-card__value stat-success">{{ statistics()!.allowedCount | number }}</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Negati</span>
            <span class="stat-card__value stat-danger">{{ statistics()!.deniedCount | number }}</span>
          </div>
          <div class="stat-card">
            <span class="stat-card__label">Utenti unici</span>
            <span class="stat-card__value">{{ statistics()!.uniqueUsers | number }}</span>
          </div>
        </div>
      }

      <!-- Metriche di performance -->
      @if (performanceMetrics()) {
        <p-message
          styleClass="w-full"
          [severity]="performanceMetrics()!.exceededTarget ? 'warn' : 'info'"
          [text]="'Query completata in ' + performanceMetrics()!.queryTimeMs.toFixed(2) + ' ms' + (performanceMetrics()!.exceededTarget ? ' (oltre il limite di 500 ms)' : '')"
        ></p-message>
      }

      <!-- Stato di caricamento -->
      @if (isLoading()) {
        <div class="surface-card">
          <div class="empty-state" role="status" aria-live="polite">
            <p-progressSpinner ariaLabel="Caricamento"></p-progressSpinner>
            <p class="empty-state__title">Caricamento dei log di audit...</p>
          </div>
        </div>
      }

      <!-- Stato di errore -->
      @if (error()) {
        <p-message
          styleClass="w-full"
          severity="error"
          [text]="'Impossibile caricare i log di audit: ' + error()"
        ></p-message>
      }

      <!-- Timeline audit -->
      @if (!isLoading() && !error() && auditLogs().length > 0) {
        <div class="surface-card timeline-card">
          <app-audit-timeline
            [logs]="auditLogs()"
            [showDetails]="showDetails()"
          ></app-audit-timeline>
        </div>
      }

      <!-- Stato vuoto -->
      @if (!isLoading() && !error() && auditLogs().length === 0) {
        <div class="surface-card">
          <div class="empty-state">
            <i class="pi pi-info-circle empty-state__icon" aria-hidden="true"></i>
            <p class="empty-state__title">Nessun log di audit trovato</p>
            <p>Prova a modificare i filtri o riprova più tardi.</p>
          </div>
        </div>
      }

      <!-- Paginazione -->
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
    .page-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-md);
    }
    .page-title i { color: var(--brand-primary-dark); }

    .statistics-grid { margin-bottom: var(--spacing-lg); }
    .stat-success { color: var(--color-success); }
    .stat-danger { color: var(--color-danger); }

    .timeline-card { margin-top: var(--spacing-lg); padding: 0; overflow: hidden; }

    .empty-state { padding: var(--spacing-3xl) var(--spacing-base); }

    :host ::ng-deep .w-full { width: 100%; display: block; margin: var(--spacing-base) 0; }
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
