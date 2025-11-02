import { Pipe, PipeTransform } from '@angular/core';

/**
 * AuditTimestampPipe
 * Formats timestamps with millisecond precision for audit logs
 * T158: Audit timestamp pipe per User Story 4
 *
 * Purpose: Display precise timestamps for compliance and debugging
 *
 * Requirements from spec.md:
 * - Millisecond precision (ISO 8601 format)
 * - Human-readable format for UI
 * - Support relative time display
 *
 * Usage:
 * {{ timestamp | auditTimestamp }}              // Full format
 * {{ timestamp | auditTimestamp:'short' }}      // Short format
 * {{ timestamp | auditTimestamp:'relative' }}   // Relative time
 */
@Pipe({
  name: 'auditTimestamp',
  standalone: true,
})
export class AuditTimestampPipe implements PipeTransform {
  transform(
    value: string | Date | undefined | null,
    format: 'full' | 'short' | 'relative' | 'iso' = 'full',
  ): string {
    if (!value) return '-';

    const date = typeof value === 'string' ? new Date(value) : value;

    if (isNaN(date.getTime())) return 'Invalid date';

    switch (format) {
      case 'iso':
        return this.formatIso(date);

      case 'short':
        return this.formatShort(date);

      case 'relative':
        return this.formatRelative(date);

      case 'full':
      default:
        return this.formatFull(date);
    }
  }

  /**
   * Format: 2024-01-20 14:35:22.123
   * Full timestamp with millisecond precision
   */
  private formatFull(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${milliseconds}`;
  }

  /**
   * Format: 14:35:22.123
   * Time only with millisecond precision
   */
  private formatShort(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0');

    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
  }

  /**
   * Format: 2 minutes ago, 3 hours ago, etc.
   * Relative time display
   */
  private formatRelative(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    if (diffMs < 0) {
      return 'in the future';
    }

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) {
      return seconds === 1 ? '1 second ago' : `${seconds} seconds ago`;
    }

    if (minutes < 60) {
      return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
    }

    if (hours < 24) {
      return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    }

    if (days < 30) {
      return days === 1 ? '1 day ago' : `${days} days ago`;
    }

    // For older dates, show full format
    return this.formatFull(date);
  }

  /**
   * Format: 2024-01-20T14:35:22.123Z
   * ISO 8601 format with milliseconds
   */
  private formatIso(date: Date): string {
    return date.toISOString();
  }
}
