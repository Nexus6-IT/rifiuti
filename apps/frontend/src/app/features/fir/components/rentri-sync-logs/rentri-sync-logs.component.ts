import { Component, Input, OnInit, inject, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ButtonModule } from 'primeng/button'
import { DropdownModule } from 'primeng/dropdown'
import { CalendarModule } from 'primeng/calendar'
import { CardModule } from 'primeng/card'
import { TooltipModule } from 'primeng/tooltip'
import { MessageModule } from 'primeng/message'
import {
  RENTRISyncService,
  SyncLogEntry,
  SyncLogsResponse,
} from '../../services/rentri-sync.service'

/**
 * RENTRI Sync Logs Viewer Component
 *
 * Displays audit logs of all RENTRI sync attempts.
 * Supports filtering by status, date range, and specific FIR.
 * Shows pagination for large result sets.
 *
 * Usage:
 * ```html
 * <app-rentri-sync-logs [firId]="selectedFirId"></app-rentri-sync-logs>
 * ```
 */
@Component({
  selector: 'app-rentri-sync-logs',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    TagModule,
    ButtonModule,
    DropdownModule,
    CalendarModule,
    CardModule,
    TooltipModule,
    MessageModule,
  ],
  template: `
    <p-card>
      <ng-template pTemplate="header">
        <div class="flex justify-content-between align-items-center p-3">
          <h3 class="m-0">RENTRI Sync Logs</h3>
          <p-button
            icon="pi pi-refresh"
            [text]="true"
            [rounded]="true"
            (onClick)="loadLogs()"
            [loading]="loading()"
            pTooltip="Refresh logs"
          >
          </p-button>
        </div>
      </ng-template>

      <!-- Filters -->
      <div class="grid mb-3">
        <div class="col-12 md:col-3">
          <label for="status-filter" class="block mb-2">Status</label>
          <p-dropdown
            id="status-filter"
            [(ngModel)]="filters.status"
            [options]="statusOptions"
            optionLabel="label"
            optionValue="value"
            placeholder="All statuses"
            [showClear]="true"
            (onChange)="onFilterChange()"
            styleClass="w-full"
          >
          </p-dropdown>
        </div>

        <div class="col-12 md:col-3">
          <label for="date-from" class="block mb-2">From Date</label>
          <p-calendar
            id="date-from"
            [(ngModel)]="filters.dateFrom"
            dateFormat="yy-mm-dd"
            [showIcon]="true"
            [showButtonBar]="true"
            (onSelect)="onFilterChange()"
            (onClear)="onFilterChange()"
            styleClass="w-full"
          >
          </p-calendar>
        </div>

        <div class="col-12 md:col-3">
          <label for="date-to" class="block mb-2">To Date</label>
          <p-calendar
            id="date-to"
            [(ngModel)]="filters.dateTo"
            dateFormat="yy-mm-dd"
            [showIcon]="true"
            [showButtonBar]="true"
            (onSelect)="onFilterChange()"
            (onClear)="onFilterChange()"
            styleClass="w-full"
          >
          </p-calendar>
        </div>

        <div class="col-12 md:col-3 flex align-items-end">
          <p-button
            label="Reset Filters"
            icon="pi pi-filter-slash"
            [text]="true"
            (onClick)="resetFilters()"
            styleClass="w-full"
          >
          </p-button>
        </div>
      </div>

      <!-- Error Message -->
      @if (errorMessage()) {
        <p-message severity="error" [text]="errorMessage()!" styleClass="w-full mb-3"> </p-message>
      }

      <!-- Logs Table -->
      <p-table
        [value]="logs()"
        [loading]="loading()"
        [paginator]="true"
        [rows]="pageSize"
        [totalRecords]="totalRecords()"
        [lazy]="true"
        (onLazyLoad)="onPageChange($event)"
        [rowsPerPageOptions]="[10, 20, 50, 100]"
        styleClass="p-datatable-sm"
      >
        <ng-template pTemplate="header">
          <tr>
            <th pSortableColumn="createdAt">
              Date
              <p-sortIcon field="createdAt"></p-sortIcon>
            </th>
            @if (!firId) {
              <th>FIR ID</th>
            }
            <th>Status</th>
            <th>Attempt</th>
            <th>Protocol #</th>
            <th>Duration</th>
            <th>Error</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-log>
          <tr>
            <td>{{ log.createdAt | date: 'dd/MM/yyyy HH:mm:ss' }}</td>
            @if (!firId) {
              <td>
                <span class="font-mono text-sm">{{ formatFirId(log.firId) }}</span>
              </td>
            }
            <td>
              <p-tag [severity]="getStatusSeverity(log.status)" [value]="log.status"> </p-tag>
            </td>
            <td>
              <span class="font-semibold">{{ log.attempt }}</span>
            </td>
            <td>
              @if (log.protocolNumber) {
                <span class="font-mono text-sm">{{ log.protocolNumber }}</span>
              } @else {
                <span class="text-tertiary">-</span>
              }
            </td>
            <td>
              @if (log.durationMs) {
                {{ formatDuration(log.durationMs) }}
              } @else {
                <span class="text-tertiary">-</span>
              }
            </td>
            <td>
              @if (log.errorMessage) {
                <span
                  class="text-sm sync-error"
                  [pTooltip]="log.errorMessage"
                  tooltipPosition="left"
                >
                  {{ truncateError(log.errorMessage) }}
                </span>
              } @else {
                <span class="text-tertiary">-</span>
              }
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td [attr.colspan]="firId ? 6 : 7" class="text-center py-4">
              <i class="pi pi-info-circle text-2xl text-tertiary mb-2"></i>
              <p class="text-tertiary m-0">No sync logs found</p>
            </td>
          </tr>
        </ng-template>
      </p-table>
    </p-card>
  `,
  styles: [
    `
      :host ::ng-deep .p-datatable .p-datatable-thead > tr > th {
        font-weight: var(--font-weight-semibold);
        background-color: var(--color-gray-50);
      }

      .font-mono {
        font-family: var(--font-family-mono);
      }

      .sync-error {
        color: var(--color-danger);
      }
    `,
  ],
})
export class RENTRISyncLogsComponent implements OnInit {
  private readonly rentriSyncService = inject(RENTRISyncService)

  /**
   * Optional FIR ID to filter logs
   * If provided, only shows logs for this FIR
   */
  @Input() firId?: string

  /**
   * Page size for pagination
   */
  @Input() pageSize: number = 20

  // Signals
  protected readonly logs = signal<SyncLogEntry[]>([])
  protected readonly loading = signal(false)
  protected readonly errorMessage = signal<string | null>(null)
  protected readonly totalRecords = signal(0)

  // Filters
  protected filters = {
    status: null as 'SUCCESS' | 'FAILURE' | 'PENDING' | null,
    dateFrom: null as Date | null,
    dateTo: null as Date | null,
  }

  // Current page
  private currentPage = 1

  // Status filter options
  protected readonly statusOptions = [
    { label: 'Success', value: 'SUCCESS' },
    { label: 'Failure', value: 'FAILURE' },
    { label: 'Pending', value: 'PENDING' },
  ]

  ngOnInit(): void {
    this.loadLogs()
  }

  /**
   * Load logs from API
   */
  protected loadLogs(): void {
    this.loading.set(true)
    this.errorMessage.set(null)

    const params: any = {
      page: this.currentPage,
      limit: this.pageSize,
    }

    // Add FIR ID filter if provided
    if (this.firId) {
      params.firId = this.firId
    }

    // Add status filter
    if (this.filters.status) {
      params.status = this.filters.status
    }

    // Add date filters
    if (this.filters.dateFrom) {
      params.dateFrom = this.formatDate(this.filters.dateFrom)
    }

    if (this.filters.dateTo) {
      params.dateTo = this.formatDate(this.filters.dateTo)
    }

    this.rentriSyncService.getSyncLogs(params).subscribe({
      next: (response: SyncLogsResponse) => {
        this.logs.set(response.data)
        this.totalRecords.set(response.total)
        this.loading.set(false)
      },
      error: error => {
        console.error('Error loading sync logs:', error)
        this.errorMessage.set('Failed to load sync logs. Please try again.')
        this.loading.set(false)
      },
    })
  }

  /**
   * Handle page change
   */
  protected onPageChange(event: any): void {
    this.currentPage = event.first / event.rows + 1
    this.pageSize = event.rows
    this.loadLogs()
  }

  /**
   * Handle filter change
   */
  protected onFilterChange(): void {
    this.currentPage = 1
    this.loadLogs()
  }

  /**
   * Reset all filters
   */
  protected resetFilters(): void {
    this.filters = {
      status: null,
      dateFrom: null,
      dateTo: null,
    }
    this.currentPage = 1
    this.loadLogs()
  }

  /**
   * Get status severity for tag color
   */
  protected getStatusSeverity(status: string): 'success' | 'danger' | 'warning' {
    switch (status) {
      case 'SUCCESS':
        return 'success'
      case 'FAILURE':
        return 'danger'
      case 'PENDING':
        return 'warning'
      default:
        return 'warning'
    }
  }

  /**
   * Format FIR ID for display (show first 8 chars)
   */
  protected formatFirId(firId: string): string {
    return firId.substring(0, 8) + '...'
  }

  /**
   * Format duration from milliseconds
   */
  protected formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(1)}s`
    } else {
      const minutes = Math.floor(ms / 60000)
      const seconds = ((ms % 60000) / 1000).toFixed(0)
      return `${minutes}m ${seconds}s`
    }
  }

  /**
   * Truncate error message for display
   */
  protected truncateError(error: string, maxLength: number = 50): string {
    return error.length > maxLength ? error.substring(0, maxLength) + '...' : error
  }

  /**
   * Format date to YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}
