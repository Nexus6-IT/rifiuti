import { Component, Input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { AuditApiService } from '../../services/audit-api.service';

/**
 * CsvExportButtonComponent
 * CSV export button for audit logs
 * T161: CSV export button per User Story 4
 *
 * Purpose: Export audit logs to CSV for ARPA inspections
 *
 * Requirements from spec.md FR-018:
 * - Export audit logs to CSV format
 * - Include all relevant columns
 * - Support filtered exports
 * - Download automatically
 *
 * Requirements from plan.md:
 * - Show loading state during export
 * - Handle large exports gracefully
 * - Provide user feedback
 */
@Component({
  selector: 'app-csv-export-button',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <button
      pButton
      type="button"
      [label]="isExporting() ? 'Exporting...' : 'Export to CSV'"
      icon="pi pi-download"
      [loading]="isExporting()"
      [disabled]="isExporting()"
      (click)="exportToCsv()"
      class="export-button"
    ></button>
  `,
  styles: [`
    .export-button {
      background: var(--color-success);
      border-color: var(--color-success);
    }

    .export-button:hover:not(:disabled) {
      background: var(--brand-primary-dark);
      border-color: var(--brand-primary-dark);
    }
  `],
})
export class CsvExportButtonComponent {
  @Input() filters: {
    userId?: string;
    startDate?: Date;
    endDate?: Date;
  } = {};

  isExporting = signal(false);

  constructor(private auditApiService: AuditApiService) {}

  exportToCsv(): void {
    this.isExporting.set(true);

    this.auditApiService.exportAuditTrail(this.filters).subscribe({
      next: (blob) => {
        // Create download link
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        // Generate filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        link.download = `audit-trail-${timestamp}.csv`;

        // Trigger download
        document.body.appendChild(link);
        link.click();

        // Cleanup
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);

        this.isExporting.set(false);
      },
      error: (error) => {
        console.error('Failed to export audit trail:', error);
        this.isExporting.set(false);
        // TODO: Show error notification
      },
    });
  }
}
