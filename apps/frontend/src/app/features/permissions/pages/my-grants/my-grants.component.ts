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
import { PermissionRequestDialogComponent } from '../../components/permission-request-dialog/permission-request-dialog.component';

/**
 * MyGrantsComponent
 * T216: User view of their temporary permission grants
 */
@Component({
  selector: 'app-my-grants',
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
    <div class="my-grants-page">
      <div class="page-header">
        <div>
          <h1>My Temporary Permissions</h1>
          <p>View and manage your temporary permission grants</p>
        </div>

        <button
          pButton
          type="button"
          label="Request Permissions"
          icon="pi pi-plus"
          (click)="openRequestDialog()"
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

      @if (!isLoading() && grants().length === 0) {
        <p-card>
          <div class="empty-state">
            <i class="pi pi-shield" style="font-size: 3rem;"></i>
            <h3>No Permission Grants</h3>
            <p>You don't have any temporary permission grants yet.</p>
            <button
              pButton
              label="Request Your First Grant"
              icon="pi pi-plus"
              (click)="openRequestDialog()"
            ></button>
          </div>
        </p-card>
      }

      @if (!isLoading() && grants().length > 0) {
        <p-card>
          <p-table [value]="grants()" [paginator]="true" [rows]="10">
            <ng-template pTemplate="header">
              <tr>
                <th>Status</th>
                <th>Permissions</th>
                <th>Time Period</th>
                <th>Requested</th>
                <th>Approval Status</th>
              </tr>
            </ng-template>

            <ng-template pTemplate="body" let-grant>
              <tr>
                <td>
                  <p-tag
                    [value]="getStatusLabel(grant)"
                    [severity]="getStatusSeverity(grant)"
                  ></p-tag>
                </td>

                <td>
                  <div class="permissions-cell">
                    @for (permission of grant.permissions.slice(0, 2); track permission) {
                      <code>{{ permission }}</code>
                    }
                    @if (grant.permissions.length > 2) {
                      <span class="more-count">+{{ grant.permissions.length - 2 }} more</span>
                    }
                  </div>
                </td>

                <td>
                  <div class="time-cell">
                    <div>
                      <strong>Start:</strong> {{ formatDate(grant.startTime) }}
                    </div>
                    <div>
                      <strong>End:</strong> {{ formatDate(grant.endTime) }}
                    </div>
                  </div>
                </td>

                <td>{{ formatDate(grant.requestedAt) }}</td>

                <td>
                  @if (grant.status === 'pending') {
                    <span class="status-text">Awaiting approval</span>
                  }
                  @if (grant.status === 'approved') {
                    <div class="approval-info">
                      <div><strong>Approved by:</strong> {{ grant.approvedBy }}</div>
                      <div><small>{{ formatDate(grant.approvedAt!) }}</small></div>
                    </div>
                  }
                  @if (grant.status === 'rejected') {
                    <div class="approval-info">
                      <div><strong>Rejected:</strong> {{ grant.approvalReason }}</div>
                    </div>
                  }
                  @if (grant.status === 'revoked') {
                    <div class="approval-info">
                      <div><strong>Revoked</strong></div>
                    </div>
                  }
                </td>
              </tr>
            </ng-template>
          </p-table>
        </p-card>
      }
    </div>
  `,
  styles: [`
    .my-grants-page {
      padding: 2rem;
      max-width: 1400px;
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

    .empty-state i {
      color: var(--text-color-secondary);
      opacity: 0.5;
      margin-bottom: 1rem;
    }

    .empty-state h3 {
      margin: 1rem 0 0.5rem 0;
    }

    .empty-state p {
      color: var(--text-color-secondary);
      margin-bottom: 1.5rem;
    }

    .permissions-cell {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .permissions-cell code {
      font-size: 0.75rem;
      background: var(--surface-100);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }

    .more-count {
      font-size: 0.75rem;
      color: var(--text-color-secondary);
      font-style: italic;
    }

    .time-cell {
      font-size: 0.875rem;
    }

    .approval-info {
      font-size: 0.875rem;
    }

    .status-text {
      color: var(--text-color-secondary);
      font-style: italic;
    }
  `],
})
export class MyGrantsComponent implements OnInit {
  isLoading = signal(false);
  error = signal<string | null>(null);
  grants = signal<PermissionGrant[]>([]);

  constructor(
    private apiService: TemporaryPermissionApiService,
    private dialogService: DialogService,
    private messageService: MessageService,
  ) {}

  ngOnInit(): void {
    this.loadGrants();
  }

  loadGrants(): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.apiService.listMyGrants().subscribe({
      next: (response) => {
        this.grants.set(response.data.grants);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.error.set(`Failed to load grants: ${error.message}`);
        this.isLoading.set(false);
      },
    });
  }

  openRequestDialog(): void {
    const ref = this.dialogService.open(PermissionRequestDialogComponent, {
      header: 'Request Temporary Permissions',
      width: '600px',
      modal: true,
    });

    ref.onClose.subscribe((result) => {
      if (result?.success) {
        this.loadGrants(); // Refresh list
      }
    });
  }

  getStatusLabel(grant: PermissionGrant): string {
    if (grant.status === 'approved' && grant.isActive) return 'Active';
    if (grant.status === 'approved' && grant.isExpired) return 'Expired';
    if (grant.status === 'pending') return 'Pending';
    if (grant.status === 'rejected') return 'Rejected';
    if (grant.status === 'revoked') return 'Revoked';
    return grant.status;
  }

  getStatusSeverity(grant: PermissionGrant): 'success' | 'info' | 'warning' | 'danger' {
    if (grant.isActive) return 'success';
    if (grant.status === 'pending') return 'warning';
    if (grant.status === 'rejected' || grant.status === 'revoked') return 'danger';
    return 'info';
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString();
  }
}
