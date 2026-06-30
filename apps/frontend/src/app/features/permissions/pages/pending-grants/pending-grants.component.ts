import { Component, OnInit, signal } from '@angular/core'
import { CommonModule } from '@angular/common'
import { CardModule } from 'primeng/card'
import { ButtonModule } from 'primeng/button'
import { TableModule } from 'primeng/table'
import { TagModule } from 'primeng/tag'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { MessageModule } from 'primeng/message'
import { ToastModule } from 'primeng/toast'
import { DialogService } from 'primeng/dynamicdialog'
import { MessageService } from 'primeng/api'
import {
  TemporaryPermissionApiService,
  PermissionGrant,
} from '../../services/temporary-permission-api.service'

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
    ToastModule,
  ],
  providers: [DialogService, MessageService],
  template: `
    <div class="page">
      <header class="page-header">
        <div class="page-header__titles">
          <h1 class="page-title">Richieste di permesso in attesa</h1>
          <p class="page-subtitle">Esamina e approva le richieste di permessi temporanei</p>
        </div>
        <div class="page-actions">
          <button
            pButton
            type="button"
            label="Aggiorna"
            icon="pi pi-refresh"
            class="p-button-outlined"
            (click)="loadPendingGrants()"
            [loading]="isLoading()"
          ></button>
        </div>
      </header>

      @if (isLoading()) {
        <div class="surface-card">
          <div class="loading-container" role="status" aria-live="polite">
            <p-progressSpinner ariaLabel="Caricamento"></p-progressSpinner>
            <p>Caricamento delle richieste...</p>
          </div>
        </div>
      }

      @if (error()) {
        <p-message severity="error" [text]="error()!" styleClass="w-full"></p-message>
      }

      @if (!isLoading() && pendingGrants().length === 0) {
        <div class="surface-card">
          <div class="empty-state">
            <i
              class="pi pi-check-circle empty-state__icon"
              style="color: var(--color-success);"
              aria-hidden="true"
            ></i>
            <p class="empty-state__title">Nessuna richiesta in attesa</p>
            <p>Tutte le richieste di permesso sono state esaminate.</p>
          </div>
        </div>
      }

      @if (!isLoading() && pendingGrants().length > 0) {
        <div class="surface-card">
          <div class="table-responsive">
            <p-table [value]="pendingGrants()">
              <ng-template pTemplate="header">
                <tr>
                  <th>Utente</th>
                  <th>Permessi richiesti</th>
                  <th>Periodo</th>
                  <th>Motivazione</th>
                  <th>Richiesto il</th>
                  <th style="width: 200px">Azioni</th>
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
                      <div><strong>Inizio:</strong> {{ formatDate(grant.startTime) }}</div>
                      <div><strong>Fine:</strong> {{ formatDate(grant.endTime) }}</div>
                      <div class="duration">Durata: {{ calculateDuration(grant) }}</div>
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
                        label="Approva"
                        icon="pi pi-check"
                        class="p-button-sm p-button-success"
                        (click)="approveGrant(grant)"
                        [attr.aria-label]="'Approva la richiesta di ' + grant.userId"
                      ></button>

                      <button
                        pButton
                        type="button"
                        label="Rifiuta"
                        icon="pi pi-times"
                        class="p-button-sm p-button-danger"
                        (click)="rejectGrant(grant)"
                        [attr.aria-label]="'Rifiuta la richiesta di ' + grant.userId"
                      ></button>
                    </div>
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </div>
        </div>
      }

      <p-toast></p-toast>
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
        flex-wrap: wrap;
        gap: var(--spacing-xs);
      }

      .time-cell {
        font-size: var(--font-size-sm);
      }

      .duration {
        margin-top: var(--spacing-sm);
        color: var(--text-tertiary);
      }

      .justification-cell {
        max-width: 320px;
        font-size: var(--font-size-sm);
        line-height: var(--line-height-normal);
      }

      .action-buttons {
        display: flex;
        gap: var(--spacing-sm);
        flex-direction: column;
      }
    `,
  ],
})
export class PendingGrantsComponent implements OnInit {
  isLoading = signal(false)
  error = signal<string | null>(null)
  pendingGrants = signal<PermissionGrant[]>([])

  constructor(
    private apiService: TemporaryPermissionApiService,
    private messageService: MessageService
  ) {}

  ngOnInit(): void {
    this.loadPendingGrants()
  }

  loadPendingGrants(): void {
    this.isLoading.set(true)
    this.error.set(null)

    this.apiService.listPending().subscribe({
      next: response => {
        this.pendingGrants.set(response.data.grants)
        this.isLoading.set(false)
      },
      error: error => {
        this.error.set(`Impossibile caricare le richieste in attesa: ${error.message}`)
        this.isLoading.set(false)
      },
    })
  }

  approveGrant(grant: PermissionGrant): void {
    const reason = prompt("Inserisci la motivazione dell'approvazione:")
    if (!reason) return

    this.apiService.approve(grant.id, reason).subscribe({
      next: response => {
        this.messageService.add({
          severity: 'success',
          summary: 'Approvata',
          detail: response.message,
        })
        this.loadPendingGrants() // Refresh
      },
      error: error => {
        this.messageService.add({
          severity: 'error',
          summary: 'Approvazione non riuscita',
          detail: error.error?.message || error.message,
        })
      },
    })
  }

  rejectGrant(grant: PermissionGrant): void {
    const reason = prompt('Inserisci la motivazione del rifiuto:')
    if (!reason) return

    this.apiService.reject(grant.id, reason).subscribe({
      next: response => {
        this.messageService.add({
          severity: 'info',
          summary: 'Rifiutata',
          detail: response.message,
        })
        this.loadPendingGrants() // Refresh
      },
      error: error => {
        this.messageService.add({
          severity: 'error',
          summary: 'Rifiuto non riuscito',
          detail: error.error?.message || error.message,
        })
      },
    })
  }

  formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleString('it-IT')
  }

  calculateDuration(grant: PermissionGrant): string {
    const start = new Date(grant.startTime)
    const end = new Date(grant.endTime)
    const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)

    if (durationHours < 24) {
      return `${Math.round(durationHours)} ore`
    }

    const durationDays = durationHours / 24
    return `${durationDays.toFixed(1)} giorni`
  }
}
