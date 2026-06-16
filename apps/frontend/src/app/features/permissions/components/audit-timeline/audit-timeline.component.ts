import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuditTimestampPipe } from '../../pipes/audit-timestamp.pipe';

/**
 * AuditTimelineComponent
 * Visual timeline display for audit logs
 * T157: Audit timeline component per User Story 4
 *
 * Purpose: Display audit logs in chronological timeline format
 *
 * Requirements from spec.md:
 * - Show chronological list of audit events
 * - Distinguish ALLOW vs DENY with colors
 * - Show key details: user, action, timestamp
 * - Expandable details for each event
 *
 * Requirements from plan.md:
 * - Mobile-friendly responsive design
 * - Efficient rendering for 1000+ logs
 * - Virtual scrolling for performance
 */
@Component({
  selector: 'app-audit-timeline',
  standalone: true,
  imports: [CommonModule, AuditTimestampPipe],
  template: `
    <div class="audit-timeline">
      @if (logs.length === 0) {
        <div class="empty-state">
          <i class="pi pi-info-circle"></i>
          <p>No audit logs found</p>
        </div>
      }

      @for (log of logs; track log.id) {
        <div class="timeline-item" [class.denied]="log.decision === 'DENY'">
          <div class="timeline-marker" [class.denied]="log.decision === 'DENY'">
            @if (log.decision === 'ALLOW') {
              <i class="pi pi-check"></i>
            } @else {
              <i class="pi pi-times"></i>
            }
          </div>

          <div class="timeline-content">
            <div class="timeline-header">
              <span class="decision-badge" [class.denied]="log.decision === 'DENY'">
                {{ log.decision }}
              </span>
              <span class="timestamp">{{ log.timestamp | auditTimestamp }}</span>
            </div>

            <div class="timeline-body">
              <div class="action-info">
                <strong>{{ log.actionAttempted }}</strong>
                @if (log.resourceType) {
                  <span class="resource-type">on {{ log.resourceType }}</span>
                }
              </div>

              <div class="user-info">
                <i class="pi pi-user"></i>
                <span>User: {{ log.userId }}</span>
              </div>

              @if (log.reason) {
                <div class="reason-info">
                  <i class="pi pi-info-circle"></i>
                  <span>{{ log.reason }}</span>
                </div>
              }

              @if (showDetails) {
                <div class="details-grid">
                  @if (log.sessionId) {
                    <div class="detail-item">
                      <span class="detail-label">Session:</span>
                      <span class="detail-value">{{ log.sessionId }}</span>
                    </div>
                  }

                  @if (log.ipAddress) {
                    <div class="detail-item">
                      <span class="detail-label">IP Address:</span>
                      <span class="detail-value">{{ log.ipAddress }}</span>
                    </div>
                  }

                  @if (log.userAgent) {
                    <div class="detail-item">
                      <span class="detail-label">User Agent:</span>
                      <span class="detail-value">{{ log.userAgent }}</span>
                    </div>
                  }

                  @if (log.spidFiscalCode) {
                    <div class="detail-item">
                      <span class="detail-label">SPID Fiscal Code:</span>
                      <span class="detail-value">{{ log.spidFiscalCode }}</span>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .audit-timeline {
      position: relative;
      padding: var(--spacing-base);
    }

    .empty-state {
      text-align: center;
      padding: var(--spacing-3xl);
      color: var(--text-secondary);
    }

    .empty-state i {
      font-size: 3rem;
      margin-bottom: var(--spacing-base);
      opacity: 0.5;
    }

    .timeline-item {
      position: relative;
      padding-left: 2.5rem;
      padding-bottom: var(--spacing-xl);
      border-left: 2px solid var(--surface-border);
    }

    .timeline-item:last-child {
      border-left-color: transparent;
    }

    .timeline-marker {
      position: absolute;
      left: -0.75rem;
      top: 0;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: var(--radius-full);
      background: var(--color-success);
      color: var(--text-inverse);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--font-size-xs);
      box-shadow: var(--shadow-sm);
    }

    .timeline-marker.denied {
      background: var(--color-danger);
    }

    .timeline-content {
      background: var(--surface-card);
      border: 1px solid var(--surface-border);
      border-radius: var(--radius-lg);
      padding: var(--spacing-base);
      margin-left: 0.5rem;
      box-shadow: var(--shadow-sm);
      transition: box-shadow var(--transition-fast);
    }

    .timeline-content:hover {
      box-shadow: var(--shadow-base);
    }

    .timeline-item.denied .timeline-content {
      border-left: 3px solid var(--color-danger);
    }

    .timeline-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-md);
    }

    .decision-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.75rem;
      background: var(--color-success-bg);
      color: var(--color-success);
      border-radius: var(--radius-xl);
      font-size: var(--font-size-xs);
      font-weight: var(--font-weight-semibold);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .decision-badge.denied {
      background: var(--color-danger-bg);
      color: var(--color-danger);
    }

    .timestamp {
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      font-family: var(--font-family-mono);
    }

    .timeline-body {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-sm);
    }

    .action-info {
      font-size: var(--font-size-base);
      color: var(--text-primary);
    }

    .action-info strong {
      font-weight: var(--font-weight-semibold);
    }

    .resource-type {
      color: var(--text-secondary);
      font-size: var(--font-size-sm);
      margin-left: 0.5rem;
    }

    .user-info,
    .reason-info {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
    }

    .reason-info {
      color: var(--brand-secondary);
      font-style: italic;
    }

    .details-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--spacing-md);
      margin-top: var(--spacing-base);
      padding-top: var(--spacing-base);
      border-top: 1px solid var(--surface-border);
    }

    .detail-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .detail-label {
      font-size: var(--font-size-xs);
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .detail-value {
      font-size: var(--font-size-sm);
      color: var(--text-primary);
      word-break: break-all;
    }

    /* Mobile responsive */
    @media (max-width: 768px) {
      .audit-timeline {
        padding: 0.5rem;
      }

      .timeline-item {
        padding-left: 2rem;
      }

      .timeline-marker {
        left: -0.625rem;
        width: 1.25rem;
        height: 1.25rem;
        font-size: 0.625rem;
      }

      .timeline-content {
        margin-left: 0.25rem;
        padding: 0.75rem;
      }

      .details-grid {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class AuditTimelineComponent {
  @Input() logs: Array<{
    id: string;
    userId: string;
    tenantId: string;
    actionAttempted: string;
    resourceType?: string;
    resourceId?: string;
    decision: 'ALLOW' | 'DENY';
    reason?: string;
    spidFiscalCode?: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    timestamp: string;
    hash?: string;
    previousHash: string;
  }> = [];

  @Input() showDetails = false;
}
