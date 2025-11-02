import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { OfflinePermissionService } from '../../state/offline-permission.store';
import { ConnectionMonitorService } from '../../services/connection-monitor.service';
import { PermissionSyncQueueService } from '../../services/permission-sync-queue.service';

/**
 * Offline Indicator Component
 *
 * Implements spec.md FR-040: Shows "Last synced" timestamp
 * - Displays offline status banner
 * - Shows last synced timestamp
 * - Provides manual sync button
 * - Shows sync progress
 */

@Component({
  selector: 'app-offline-indicator',
  standalone: true,
  imports: [CommonModule, MessageModule, ButtonModule],
  template: `
    <div class="offline-indicator" *ngIf="!(connectionMonitor.isOnline$ | async)">
      <p-message
        severity="warn"
        styleClass="offline-banner"
        [closable]="false"
      >
        <div class="offline-content">
          <div class="offline-text">
            <i class="pi pi-wifi" style="margin-right: 0.5rem;"></i>
            <span><strong>Modalità offline</strong> - {{getLastSyncText()}}</span>
          </div>
          <button
            pButton
            type="button"
            label="Riprova connessione"
            icon="pi pi-refresh"
            class="p-button-sm p-button-warning"
            (click)="retryConnection()"
            [loading]="isRetrying"
          ></button>
        </div>
      </p-message>
    </div>

    <div class="sync-indicator" *ngIf="(connectionMonitor.isOnline$ | async) && isSyncing()">
      <p-message
        severity="info"
        styleClass="sync-banner"
        [closable]="false"
      >
        <div class="sync-content">
          <i class="pi pi-spin pi-spinner" style="margin-right: 0.5rem;"></i>
          <span>Sincronizzazione in corso... {{syncProgress}}</span>
        </div>
      </p-message>
    </div>
  `,
  styles: [`
    .offline-indicator, .sync-indicator {
      position: fixed;
      top: 60px;
      left: 0;
      right: 0;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }

    .offline-content, .sync-content {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      gap: 1rem;
    }

    .offline-text {
      display: flex;
      align-items: center;
    }

    @media (max-width: 768px) {
      .offline-content {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  `],
})
export class OfflineIndicatorComponent {
  isRetrying = false;
  syncProgress = '';

  constructor(
    public connectionMonitor: ConnectionMonitorService,
    private offlinePermissionService: OfflinePermissionService,
    private syncQueue: PermissionSyncQueueService,
  ) {
    this.syncQueue.getSyncProgress().subscribe(progress => {
      this.syncProgress = `${progress.completed}/${progress.total}`;
    });
  }

  getLastSyncText(): string {
    return this.offlinePermissionService.getLastSyncedFormatted();
  }

  isSyncing(): boolean {
    return this.offlinePermissionService.isSyncing$();
  }

  async retryConnection(): Promise<void> {
    this.isRetrying = true;
    const isOnline = await this.connectionMonitor.testConnection();

    if (isOnline) {
      await this.syncQueue.syncAll();
    }

    this.isRetrying = false;
  }
}
