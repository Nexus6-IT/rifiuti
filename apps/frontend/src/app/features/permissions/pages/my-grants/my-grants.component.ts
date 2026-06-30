import { Component, OnInit, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { CardModule } from 'primeng/card'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { MessageModule } from 'primeng/message'
import { DialogService } from 'primeng/dynamicdialog'
import { MessageService } from 'primeng/api'
import {
  TemporaryPermissionApiService,
  PermissionGrant,
} from '../../services/temporary-permission-api.service'
import { PermissionRequestDialogComponent } from '../../components/permission-request-dialog/permission-request-dialog.component'

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
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">I miei permessi temporanei</h1>
          <p class="page-subtitle">
            Visualizza e gestisci le tue concessioni di permessi temporanei
          </p>
        </div>
        <div class="page-actions">
          <button
            pButton
            type="button"
            label="Richiedi permessi"
            icon="pi pi-plus"
            (click)="openRequestDialog()"
          ></button>
        </div>
      </header>

      @if (isLoading()) {
        <div class="surface-card">
          <div class="loading-container" role="status" aria-live="polite">
            <p-progressSpinner ariaLabel="Caricamento"></p-progressSpinner>
            <p>Caricamento delle concessioni...</p>
          </div>
        </div>
      }

      @if (error()) {
        <p-message severity="error" [text]="error()!" styleClass="w-full"></p-message>
      }

      @if (!isLoading() && grants().length === 0) {
        <div class="surface-card">
          <div class="empty-state">
            <i class="pi pi-shield empty-state__icon" aria-hidden="true"></i>
            <p class="empty-state__title">Nessuna concessione di permessi</p>
            <p>Non hai ancora concessioni di permessi temporanei.</p>
            <button
              pButton
              label="Richiedi la prima concessione"
              icon="pi pi-plus"
              (click)="openRequestDialog()"
            ></button>
          </div>
        </div>
      }

      @if (!isLoading() && grants().length > 0) {
        <div class="surface-card">
          <div class="table-responsive">
            <p-table [value]="grants()" [paginator]="true" [rows]="10">
              <ng-template pTemplate="header">
                <tr>
                  <th>Stato</th>
                  <th>Permessi</th>
                  <th>Periodo</th>
                  <th>Richiesto il</th>
                  <th>Esito approvazione</th>
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
                        <span class="more-count">+{{ grant.permissions.length - 2 }} altri</span>
                      }
                    </div>
                  </td>

                  <td>
                    <div class="time-cell">
                      <div><strong>Inizio:</strong> {{ formatDate(grant.startTime) }}</div>
                      <div><strong>Fine:</strong> {{ formatDate(grant.endTime) }}</div>
                    </div>
                  </td>

                  <td>{{ formatDate(grant.requestedAt) }}</td>

                  <td>
                    @if (grant.status === 'pending') {
                      <span class="status-text">In attesa di approvazione</span>
                    }
                    @if (grant.status === 'approved') {
                      <div class="approval-info">
                        <div><strong>Approvato da:</strong> {{ grant.approvedBy }}</div>
                        <div>
                          <small>{{ formatDate(grant.approvedAt!) }}</small>
                        </div>
                      </div>
                    }
                    @if (grant.status === 'rejected') {
                      <div class="approval-info">
                        <div><strong>Rifiutato:</strong> {{ grant.approvalReason }}</div>
                      </div>
                    }
                    @if (grant.status === 'revoked') {
                      <div class="approval-info">
                        <div><strong>Revocato</strong></div>
                      </div>
                    }
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-base);
        padding: var(--spacing-2xl);
        color: var(--text-secondary);
      }

      .permissions-cell {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-xs);
      }

      .permissions-cell code {
        font-size: var(--font-size-xs);
        background: var(--color-gray-100);
        padding: var(--spacing-xs) var(--spacing-sm);
        border-radius: var(--radius-base);
        font-family: var(--font-family-mono);
      }

      .more-count {
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }

      .time-cell {
        font-size: var(--font-size-sm);
      }
      .approval-info {
        font-size: var(--font-size-sm);
      }
      .status-text {
        color: var(--text-tertiary);
      }
    `,
  ],
})
export class MyGrantsComponent implements OnInit {
  isLoading = signal(false)
  error = signal<string | null>(null)
  grants = signal<PermissionGrant[]>([])

  constructor(
    private apiService: TemporaryPermissionApiService,
    private dialogService: DialogService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.loadGrants()
  }

  loadGrants(): void {
    this.isLoading.set(true)
    this.error.set(null)

    this.apiService.listMyGrants().subscribe({
      next: response => {
        this.grants.set(response.data.grants)
        this.isLoading.set(false)
      },
      error: error => {
        this.error.set(`Impossibile caricare le concessioni: ${error.message}`)
        this.isLoading.set(false)
      },
    })
  }

  openRequestDialog(): void {
    const ref = this.dialogService.open(PermissionRequestDialogComponent, {
      header: 'Richiedi permessi temporanei',
      width: '600px',
      modal: true,
    })

    ref.onClose.subscribe(result => {
      if (result?.success) {
        this.loadGrants() // Refresh list
      }
    })
  }

  getStatusLabel(grant: PermissionGrant): string {
    if (grant.status === 'approved' && grant.isActive) return 'Attivo'
    if (grant.status === 'approved' && grant.isExpired) return 'Scaduto'
    if (grant.status === 'pending') return 'In attesa'
    if (grant.status === 'rejected') return 'Rifiutato'
    if (grant.status === 'revoked') return 'Revocato'
    return grant.status
  }

  getStatusSeverity(grant: PermissionGrant): 'success' | 'info' | 'warning' | 'danger' {
    if (grant.isActive) return 'success'
    if (grant.status === 'pending') return 'warning'
    if (grant.status === 'rejected' || grant.status === 'revoked') return 'danger'
    return 'info'
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString('it-IT')
  }
}
