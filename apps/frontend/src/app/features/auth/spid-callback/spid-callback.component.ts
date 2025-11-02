import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../core/services/auth.service';

/**
 * SPID Callback Component
 *
 * Handles SAML callback from Keycloak after SPID/CIE authentication.
 * Processes SAML response and redirects to original destination.
 */
@Component({
  selector: 'app-spid-callback',
  standalone: true,
  imports: [CommonModule, ProgressSpinnerModule, MessageModule],
  template: `
    <div class="callback-container">
      @if (processing) {
        <div class="text-center">
          <p-progressSpinner
            styleClass="w-4rem h-4rem"
            strokeWidth="4"
            animationDuration="1s">
          </p-progressSpinner>
          <h2 class="mt-4 text-2xl font-semibold">Autenticazione in corso...</h2>
          <p class="mt-2 text-color-secondary">
            Stiamo completando l'accesso con SPID
          </p>
        </div>
      }

      @if (error) {
        <div class="text-center max-w-md">
          <p-message
            severity="error"
            [text]="errorMessage"
            styleClass="w-full mb-4">
          </p-message>

          <h2 class="text-2xl font-semibold mb-2">Autenticazione fallita</h2>
          <p class="text-color-secondary mb-4">
            Si è verificato un errore durante l'autenticazione SPID.
          </p>

          <button
            class="p-button p-component"
            (click)="returnToLogin()">
            <span class="pi pi-arrow-left mr-2"></span>
            Torna al login
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .callback-container {
        min-height: 100vh;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 2rem;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      }

      :host ::ng-deep .p-progress-spinner-circle {
        stroke: white;
      }

      h2,
      p {
        color: white;
      }

      button {
        background: white;
        color: #667eea;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 4px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s;
      }

      button:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }
    `,
  ],
})
export class SpidCallbackComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected processing = true;
  protected error = false;
  protected errorMessage = '';

  ngOnInit(): void {
    this.handleCallback();
  }

  private handleCallback(): void {
    // Get SAML response from query params
    const samlResponse = this.route.snapshot.queryParams['SAMLResponse'];
    const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard';

    if (!samlResponse) {
      this.showError('SAML response mancante');
      return;
    }

    // Process callback
    this.authService.handleCallback(samlResponse).subscribe({
      next: (response) => {
        console.log('SPID authentication successful', response);

        // Wait a moment to show success state, then redirect
        setTimeout(() => {
          this.router.navigate([returnUrl]);
        }, 1000);
      },
      error: (error) => {
        console.error('SPID authentication failed', error);

        const message =
          error.error?.message ||
          error.message ||
          'Errore durante l\'autenticazione SPID';

        this.showError(message);
      },
    });
  }

  private showError(message: string): void {
    this.processing = false;
    this.error = true;
    this.errorMessage = message;
  }

  protected returnToLogin(): void {
    this.router.navigate(['/login']);
  }
}
