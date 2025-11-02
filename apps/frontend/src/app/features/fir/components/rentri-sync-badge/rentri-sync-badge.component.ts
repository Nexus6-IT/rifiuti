import { Component, Input, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { Subject, takeUntil, timer, switchMap } from 'rxjs';
import { RENTRISyncService, SyncJobStatus } from '../../services/rentri-sync.service';

/**
 * RENTRI Sync Status Badge Component
 *
 * Displays current RENTRI sync status for a FIR.
 * Shows badges with different colors based on sync status.
 * Automatically polls status for in-progress syncs.
 *
 * Usage:
 * ```html
 * <app-rentri-sync-badge
 *   [rentriSyncStatus]="fir.rentriSyncStatus"
 *   [syncJobId]="fir.syncJobId"
 *   [protocolNumber]="fir.rentriProtocolNumber">
 * </app-rentri-sync-badge>
 * ```
 */
@Component({
  selector: 'app-rentri-sync-badge',
  standalone: true,
  imports: [
    CommonModule,
    TagModule,
    TooltipModule,
    ProgressSpinnerModule,
  ],
  template: `
    <div class="rentri-sync-badge">
      @if (isPolling()) {
        <p-tag
          [severity]="'info'"
          [value]="pollingStatus()?.status || 'Processing'"
          [pTooltip]="getTooltipText()"
          tooltipPosition="top"
          styleClass="sync-status-badge">
          <i class="pi pi-spin pi-spinner mr-1"></i>
          {{ pollingStatus()?.progress }}%
        </p-tag>
      } @else {
        <p-tag
          [severity]="getSeverity()"
          [value]="getDisplayText()"
          [pTooltip]="getTooltipText()"
          tooltipPosition="top"
          styleClass="sync-status-badge">
          <i [class]="getIcon()" class="mr-1"></i>
        </p-tag>
      }
    </div>
  `,
  styles: [`
    .rentri-sync-badge {
      display: inline-block;
    }

    :host ::ng-deep .sync-status-badge {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
    }

    :host ::ng-deep .sync-status-badge i {
      font-size: 0.75rem;
    }
  `],
})
export class RENTRISyncBadgeComponent implements OnInit, OnDestroy {
  private readonly rentriSyncService = inject(RENTRISyncService);
  private readonly destroy$ = new Subject<void>();

  /**
   * Current RENTRI sync status from FIR
   * Values: PENDING, SYNCED, FAILED
   */
  @Input({ required: true }) rentriSyncStatus!: string;

  /**
   * Job ID for active sync (if any)
   */
  @Input() syncJobId?: string;

  /**
   * RENTRI protocol number (if synced)
   */
  @Input() protocolNumber?: string;

  /**
   * Sync attempt count
   */
  @Input() syncAttempts: number = 0;

  /**
   * Last sync error message
   */
  @Input() lastSyncError?: string;

  /**
   * Enable auto-polling for in-progress syncs
   */
  @Input() autoPoll: boolean = true;

  /**
   * Polling interval in milliseconds
   */
  @Input() pollInterval: number = 3000;

  // Signals
  protected readonly isPolling = signal(false);
  protected readonly pollingStatus = signal<SyncJobStatus | null>(null);

  ngOnInit(): void {
    // Start polling if there's an active job
    if (this.autoPoll && this.syncJobId && this.isInProgress()) {
      this.startPolling();
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Check if sync is in progress
   */
  private isInProgress(): boolean {
    return this.rentriSyncStatus === 'PENDING' ||
           this.rentriSyncStatus === 'IN_PROGRESS';
  }

  /**
   * Start polling job status
   */
  private startPolling(): void {
    if (!this.syncJobId) return;

    this.isPolling.set(true);

    timer(0, this.pollInterval)
      .pipe(
        switchMap(() => this.rentriSyncService.getSyncStatus(this.syncJobId!)),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: (status) => {
          this.pollingStatus.set(status);

          // Stop polling if job is done
          if (status.status === 'completed' || status.status === 'failed') {
            this.isPolling.set(false);
            this.destroy$.next();
          }
        },
        error: (error) => {
          console.error('Error polling sync status:', error);
          this.isPolling.set(false);
        },
      });
  }

  /**
   * Get badge severity (color)
   */
  protected getSeverity(): 'success' | 'info' | 'warning' | 'danger' {
    if (this.isPolling()) {
      return 'info';
    }

    switch (this.rentriSyncStatus) {
      case 'SYNCED':
        return 'success';
      case 'PENDING':
      case 'IN_PROGRESS':
        return 'info';
      case 'FAILED':
        return this.syncAttempts >= 5 ? 'danger' : 'warning';
      default:
        return 'info';
    }
  }

  /**
   * Get display text for badge
   */
  protected getDisplayText(): string {
    if (this.isPolling()) {
      const status = this.pollingStatus();
      return status ? `Syncing ${status.progress}%` : 'Syncing...';
    }

    switch (this.rentriSyncStatus) {
      case 'SYNCED':
        return 'Synced';
      case 'PENDING':
        return 'Pending';
      case 'IN_PROGRESS':
        return 'Syncing';
      case 'FAILED':
        return this.syncAttempts >= 5 ? 'Failed' : `Retry ${this.syncAttempts}/5`;
      default:
        return 'Unknown';
    }
  }

  /**
   * Get icon class
   */
  protected getIcon(): string {
    if (this.isPolling()) {
      return 'pi pi-spin pi-spinner';
    }

    switch (this.rentriSyncStatus) {
      case 'SYNCED':
        return 'pi pi-check-circle';
      case 'PENDING':
        return 'pi pi-clock';
      case 'IN_PROGRESS':
        return 'pi pi-spin pi-spinner';
      case 'FAILED':
        return 'pi pi-exclamation-triangle';
      default:
        return 'pi pi-question-circle';
    }
  }

  /**
   * Get tooltip text
   */
  protected getTooltipText(): string {
    if (this.isPolling()) {
      const status = this.pollingStatus();
      if (status) {
        return `Sync in progress (${status.progress}% complete) - Attempt ${status.attemptsMade}`;
      }
      return 'Sync in progress...';
    }

    switch (this.rentriSyncStatus) {
      case 'SYNCED':
        return this.protocolNumber
          ? `Synced to RENTRI - Protocol: ${this.protocolNumber}`
          : 'Successfully synced to RENTRI';

      case 'PENDING':
        return 'Waiting for sync to RENTRI';

      case 'IN_PROGRESS':
        return 'Sync to RENTRI in progress...';

      case 'FAILED':
        const attemptsText = this.syncAttempts >= 5
          ? 'Max retries reached'
          : `Will retry (${this.syncAttempts}/5 attempts)`;

        return this.lastSyncError
          ? `Sync failed: ${this.lastSyncError}\n${attemptsText}`
          : `Sync failed - ${attemptsText}`;

      default:
        return 'RENTRI sync status unknown';
    }
  }
}
