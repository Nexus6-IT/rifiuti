import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { HttpErrorResponse } from '@angular/common/http';

/**
 * SPID Re-Authentication Modal Component
 *
 * Triggered when backend returns 428 Precondition Required status code
 * per spec.md FR-027. Prompts user to re-authenticate via SPID/CIE before
 * continuing with high-risk operations (delete FIR, approve user, digital signature).
 *
 * Usage:
 * - HTTP interceptor catches 428 responses
 * - Shows this modal with explanation
 * - User clicks "Re-Authenticate with SPID" button
 * - Redirects to SPID login flow
 * - After successful re-auth, retries original operation
 */

export interface SpidReauthRequiredError {
  statusCode: 428;
  error: 'Precondition Required';
  message: string;
  requiredAction: 'SPID_REAUTH';
  lastAuthTime: number;
  requiredFreshness: number;
}

@Component({
  selector: 'app-spid-reauth-modal',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule, MessageModule],
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      [closable]="false"
      [draggable]="false"
      [resizable]="false"
      styleClass="spid-reauth-dialog"
      [style]="{ width: '90vw', maxWidth: '500px' }"
    >
      <ng-template pTemplate="header">
        <div class="dialog-header">
          <i class="pi pi-shield" style="font-size: 1.5rem; color: var(--brand-primary); margin-right: 0.5rem;" aria-hidden="true"></i>
          <span>Richiesta Nuova Autenticazione</span>
        </div>
      </ng-template>

      <div class="reauth-content">
        <p-message
          severity="warn"
          [text]="'Questa operazione richiede una nuova autenticazione SPID/CIE per motivi di sicurezza.'"
          [closable]="false"
        ></p-message>

        <div class="operation-details" *ngIf="errorData">
          <h4>Dettagli Operazione</h4>
          <p><strong>Operazione richiesta:</strong> {{ operationName }}</p>
          <p><strong>Ultima autenticazione:</strong> {{ formatLastAuthTime() }}</p>
          <p><strong>Tempo trascorso:</strong> {{ calculateTimeSinceAuth() }}</p>
        </div>

        <div class="security-notice">
          <p>
            <i class="pi pi-info-circle"></i>
            Per la tua sicurezza, le operazioni critiche richiedono una riautenticazione
            se sono trascorsi più di <strong>15 minuti</strong> dall'ultimo accesso SPID.
          </p>
        </div>

        <div class="action-explanation">
          <h4>Cosa succederà:</h4>
          <ol>
            <li>Verrai reindirizzato al provider SPID/CIE</li>
            <li>Effettua nuovamente l'accesso con le tue credenziali</li>
            <li>Ritornerai automaticamente a questa pagina</li>
            <li>L'operazione richiesta verrà completata</li>
          </ol>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <div class="dialog-footer">
          <button
            pButton
            type="button"
            label="Annulla"
            icon="pi pi-times"
            class="p-button-text p-button-secondary"
            (click)="onCancel()"
            [disabled]="isReauthenticating"
          ></button>
          <button
            pButton
            type="button"
            label="Riautentica con SPID"
            icon="pi pi-shield"
            (click)="onReauthenticate()"
            [loading]="isReauthenticating"
            [disabled]="isReauthenticating"
          ></button>
        </div>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    :host ::ng-deep .spid-reauth-dialog {
      .dialog-header {
        display: flex;
        align-items: center;
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }

      .reauth-content {
        padding: var(--spacing-base) 0;

        .operation-details {
          margin: var(--spacing-lg) 0;
          padding: var(--spacing-base);
          background-color: var(--surface-hover);
          border-radius: var(--radius-md);
          border-left: 4px solid var(--brand-primary);

          h4 {
            margin: 0 0 var(--spacing-sm) 0;
            font-size: var(--font-size-base);
            color: var(--text-primary);
          }

          p {
            margin: var(--spacing-sm) 0;
            font-size: var(--font-size-sm);
            color: var(--text-secondary);

            strong {
              color: var(--text-primary);
            }
          }
        }

        .security-notice {
          margin: var(--spacing-base) 0;
          padding: var(--spacing-md);
          background-color: var(--color-warning-bg);
          border: 1px solid var(--color-warning);
          border-radius: var(--radius-md);
          display: flex;
          align-items: flex-start;

          i {
            color: var(--color-warning);
            margin-right: 0.5rem;
            margin-top: 0.2rem;
          }

          p {
            margin: 0;
            font-size: var(--font-size-sm);
            color: var(--color-warning);
          }
        }

        .action-explanation {
          margin: var(--spacing-lg) 0;

          h4 {
            margin: 0 0 var(--spacing-sm) 0;
            font-size: var(--font-size-base);
            color: var(--text-primary);
          }

          ol {
            margin: var(--spacing-sm) 0;
            padding-left: 1.5rem;
            color: var(--text-secondary);

            li {
              margin: var(--spacing-sm) 0;
              font-size: var(--font-size-sm);
              line-height: var(--line-height-normal);
            }
          }
        }
      }

      .dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--spacing-sm);
      }
    }

    /* Su mobile i bottoni del footer vanno a piena larghezza, mantenendo l'altezza DS */
    @media (max-width: 768px) {
      :host ::ng-deep .spid-reauth-dialog {
        .dialog-footer {
          flex-direction: column-reverse;
          gap: var(--spacing-md);

          button {
            width: 100%;
          }
        }
      }
    }
  `],
})
export class SpidReauthModalComponent implements OnInit {
  visible = false;
  isReauthenticating = false;
  errorData: SpidReauthRequiredError | null = null;
  operationName = 'Operazione critica';
  private pendingOperation: (() => void) | null = null;
  private cancelCallback: (() => void) | null = null;

  ngOnInit(): void {
    // Component will be controlled by HTTP interceptor
  }

  /**
   * Show the modal when a 428 response is received
   * @param error The HTTP error response with re-auth details
   * @param retryCallback Function to retry the original operation after re-auth
   * @param cancelCallback Function to call if user cancels
   */
  show(
    error: HttpErrorResponse,
    retryCallback: () => void,
    cancelCallback?: () => void,
  ): void {
    if (error.status === 428 && error.error?.requiredAction === 'SPID_REAUTH') {
      this.errorData = error.error;
      this.pendingOperation = retryCallback;
      this.cancelCallback = cancelCallback || null;
      this.operationName = this.extractOperationName(error);
      this.visible = true;
    }
  }

  /**
   * Hide the modal
   */
  hide(): void {
    this.visible = false;
    this.isReauthenticating = false;
    this.errorData = null;
    this.pendingOperation = null;
    this.cancelCallback = null;
  }

  /**
   * Handle re-authentication button click
   * Redirects user to SPID login flow
   */
  onReauthenticate(): void {
    this.isReauthenticating = true;

    // Store pending operation in sessionStorage for retrieval after SPID redirect
    if (this.pendingOperation) {
      sessionStorage.setItem('pendingOperation', 'retry');
      sessionStorage.setItem('returnUrl', window.location.pathname);
    }

    // Redirect to SPID authentication endpoint
    // The backend will handle the SPID flow and redirect back
    window.location.href = '/api/v1/auth/spid/login?returnUrl=' + encodeURIComponent(window.location.pathname);
  }

  /**
   * Handle cancel button click
   */
  onCancel(): void {
    if (this.cancelCallback) {
      this.cancelCallback();
    }
    this.hide();
  }

  /**
   * Format last authentication time for display
   */
  formatLastAuthTime(): string {
    if (!this.errorData?.lastAuthTime) return 'N/A';

    const date = new Date(this.errorData.lastAuthTime);
    return date.toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Calculate and format time elapsed since last authentication
   */
  calculateTimeSinceAuth(): string {
    if (!this.errorData?.lastAuthTime) return 'N/A';

    const now = Date.now();
    const elapsed = now - this.errorData.lastAuthTime;
    const minutes = Math.floor(elapsed / (60 * 1000));

    if (minutes < 60) {
      return `${minutes} minuti`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours} ore e ${remainingMinutes} minuti`;
  }

  /**
   * Extract operation name from error context or URL
   */
  private extractOperationName(error: HttpErrorResponse): string {
    const url = error.url || '';

    if (url.includes('delete')) return 'Eliminazione FIR';
    if (url.includes('signature')) return 'Firma digitale';
    if (url.includes('approve')) return 'Approvazione utente';

    return 'Operazione critica';
  }
}
