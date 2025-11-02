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
      padding: 1rem;
    }

    .empty-state {
      text-align: center;
      padding: 3rem;
      color: var(--text-color-secondary);
    }

    .empty-state i {
      font-size: 3rem;
      margin-bottom: 1rem;
      opacity: 0.5;
    }

    .timeline-item {
      position: relative;
      padding-left: 2.5rem;
      padding-bottom: 2rem;
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
      border-radius: 50%;
      background: var(--green-500);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .timeline-marker.denied {
      background: var(--red-500);
    }

    .timeline-content {
      background: var(--surface-card);
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      padding: 1rem;
      margin-left: 0.5rem;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
      transition: all 0.2s ease;
    }

    .timeline-content:hover {
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    }

    .timeline-item.denied .timeline-content {
      border-left: 3px solid var(--red-500);
    }

    .timeline-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.75rem;
    }

    .decision-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.75rem;
      background: var(--green-100);
      color: var(--green-700);
      border-radius: 12px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .decision-badge.denied {
      background: var(--red-100);
      color: var(--red-700);
    }

    .timestamp {
      font-size: 0.875rem;
      color: var(--text-color-secondary);
      font-family: 'Courier New', monospace;
    }

    .timeline-body {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .action-info {
      font-size: 1rem;
      color: var(--text-color);
    }

    .action-info strong {
      font-weight: 600;
    }

    .resource-type {
      color: var(--text-color-secondary);
      font-size: 0.875rem;
      margin-left: 0.5rem;
    }

    .user-info,
    .reason-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.875rem;
      color: var(--text-color-secondary);
    }

    .reason-info {
      color: var(--orange-600);
      font-style: italic;
    }

    .details-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0.75rem;
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--surface-border);
    }

    .detail-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .detail-label {
      font-size: 0.75rem;
      color: var(--text-color-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .detail-value {
      font-size: 0.875rem;
      color: var(--text-color);
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
