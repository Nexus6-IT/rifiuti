import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { DialogService } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { TemporaryPermissionApiService, PermissionGrant } from '../../services/temporary-permission-api.service';

/**
 * PendingGrantsComponent
 * T217: Admin view of pending permission requests
 */
@Component({
  selector: 'app-pending-grants',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ButtonModule,
    TableModule,
    TagModule,
    ProgressSpinnerModule,
    MessageModule,
  ],
  providers: [DialogService, MessageService],
  template: `
    <div class="pending-grants-page">
      <div class="page-header">
        <div>
          <h1>Pending Permission Requests</h1>
          <p>Review and approve temporary permission requests</p>
        </div>

        <button
          pButton
          type="button"
          label="Refresh"
          icon="pi pi-refresh"
          class="p-button-outlined"
          (click)="loadPendingGrants()"
          [loading]="isLoading()"
        ></button>
      </div>

      @if (isLoading()) {
        <div class="loading-container">
          <p-progressSpinner></p-progressSpinner>
        </div>
      }

      @if (error()) {
        <p-message severity="error" [text]="error()!"></p-message>
      }

      @if (!isLoading() && pendingGrants().length === 0) {
        <p-card>
          <div class="empty-state">
            <i class="pi pi-check-circle" style="font-size: 3rem; color: var(--green-500);"></i>
            <h3>No Pending Requests</h3>
            <p>All permission requests have been reviewed.</p>
          </div>
        </p-card>
      }

      @if (!isLoading() && pendingGrants().length > 0) {
        <p-card>
          <p-table [value]="pendingGrants()">
            <ng-template pTemplate="header">
              <tr>
                <th>User</th>
                <th>Requested Permissions</th>
                <th>Time Period</th>
                <th>Justification</th>
                <th>Requested At</th>
                <th style="width: 200px">Actions</th>
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-grant>
              <tr>
                <td>
                  <strong>{{ grant.userId }}</strong>
                </td>

                <td>
                  <div class="permissions-cell">
                    @for (permission of grant.permissions; track permission) {
                      <p-tag [value]="permission" severity="info"></p-tag>
                    }
                  </div>
                </td>

                <td>
                  <div class="time-cell">
                    <div><strong>Start:</strong> {{ formatDate(grant.startTime) }}</div>
                    <div><strong>End:</strong> {{ formatDate(grant.endTime) }}</div>
                    <div class="duration">Duration: {{ calculateDuration(grant) }}</div>
                  </div>
                </td>

                <td>
                  <div class="justification-cell">
                    {{ grant.justification }}
                  </div>
                </td>

                <td>{{ formatDate(grant.requestedAt) }}</td>

                <td>
                  <div class="action-buttons">
                    <button
                      pButton
                      type="button"
                      label="Approve"
                      icon="pi pi-check"
                      class="p-button-sm p-button-success"
                      (click)="approveGrant(grant)"
                    ></button>

                    <button
                      pButton
                      type="button"
                      label="Reject"
                      icon="pi pi-times"
                      class="p-button-sm p-button-danger"
                      (click)="rejectGrant(grant)"
                    ></button>
                  </div>
                </td>
              </tr>
            </ng-template>
          </p-table>
        </p-card>
      }
    </div>
  `,
  styles: [`
    .pending-grants-page {
      padding: 2rem;
      max-width: 1600px;
      margin: 0 auto;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }

    .page-header h1 {
      margin: 0 0 0.5rem 0;
      font-size: 2rem;
    }

    .page-header p {
      margin: 0;
      color: var(--text-color-secondary);
    }

    .loading-container {
      display: flex;
      justify-content: center;
      padding: 4rem;
    }

    .empty-state {
      text-align: center;
      padding: 4rem 2rem;
    }

    .empty-state h3 {
      margin: 1rem 0 0.5rem 0;
    }

    .permissions-cell {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }

    .time-cell {
      font-size: 0.875rem;
    }

    .duration {
      margin-top: 0.5rem;
      color: var(--text-color-secondary);
      font-style: italic;
    }

    .justification-cell {
      max-width: 300px;
      font-size: 0.875rem;
      line-height: 1.4;
    }

    .action-buttons {
      display: flex;
      gap: 0.5rem;
      flex-direction: column;
    }
  `],
})
export class PendingGrantsComponent implements OnInit {
  isLoading = signal(false);
  error = signal<string | null>(null);
  pendingGrants = signal<PermissionGrant[]>([]);

  constructor(
    private apiService: TemporaryPermissionApiService,
    private messageService: MessageService,
  ) {}

  ngOnInit(): void {
    this.loadPendingGrants();
  }

  loadPendingGrants(): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.apiService.listPending().subscribe({
      next: (response) => {
        this.pendingGrants.set(response.data.grants);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.error.set(`Failed to load pending grants: ${error.message}`);
        this.isLoading.set(false);
      },
    });
  }

  approveGrant(grant: PermissionGrant): void {
    const reason = prompt('Enter approval reason:');
    if (!reason) return;

    this.apiService.approve(grant.id, reason).subscribe({
      next: (response) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Approved',
          detail: response.message,
        });
        this.loadPendingGrants(); // Refresh
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Approval Failed',
          detail: error.error?.message || error.message,
        });
      },
    });
  }

  rejectGrant(grant: PermissionGrant): void {
    const reason = prompt('Enter rejection reason:');
    if (!reason) return;

    this.apiService.reject(grant.id, reason).subscribe({
      next: (response) => {
        this.messageService.add({
          severity: 'info',
          summary: 'Rejected',
          detail: response.message,
        });
        this.loadPendingGrants(); // Refresh
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Rejection Failed',
          detail: error.error?.message || error.message,
        });
      },
    });
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString();
  }

  calculateDuration(grant: PermissionGrant): string {
    const start = new Date(grant.startTime);
    const end = new Date(grant.endTime);
    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);

    if (durationHours < 24) {
      return `${Math.round(durationHours)} hours`;
    }

    const durationDays = durationHours / 24;
    return `${durationDays.toFixed(1)} days`;
  }
}
