import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
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
  imports: [CommonModule, ProgressSpinnerModule, MessageModule, ButtonModule],
  template: `
    <div class="callback-container">
      <div class="callback-card">
        @if (processing) {
          <div class="text-center">
            <p-progressSpinner
              styleClass="w-4rem h-4rem"
              strokeWidth="4"
              animationDuration="1s">
            </p-progressSpinner>
            <h2 class="callback-title mt-4">Autenticazione in corso...</h2>
            <p class="callback-hint mt-2">
              Stiamo completando l'accesso con SPID
            </p>
          </div>
        }

        @if (error) {
          <div class="text-center">
            <p-message
              severity="error"
              [text]="errorMessage"
              styleClass="w-full mb-4">
            </p-message>

            <h2 class="callback-title mb-2">Autenticazione fallita</h2>
            <p class="callback-hint mb-4">
              Si è verificato un errore durante l'autenticazione SPID.
            </p>

            <p-button
              label="Torna al login"
              icon="pi pi-arrow-left"
              [outlined]="true"
              (onClick)="returnToLogin()"
              ariaLabel="Torna alla pagina di login">
            </p-button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .callback-container {
        min-height: 100vh;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: var(--spacing-lg);
        background:
          radial-gradient(120% 90% at 50% 0%, var(--brand-primary-50) 0%, transparent 60%),
          var(--surface-ground);
      }
      .callback-card {
        width: 100%;
        max-width: 420px;
        padding: clamp(2rem, 5vw, 3rem);
        background: var(--surface-card);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-md);
      }
      .callback-title {
        font-family: var(--font-display);
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin: 0;
      }
      .callback-hint {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        margin: 0;
        line-height: var(--line-height-normal);
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
