import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { Router } from '@angular/router'
import { ProgressSpinnerModule } from 'primeng/progressspinner'
import { AuthService } from '../../core/services/auth.service'

/**
 * Riceve i token dopo il login SAML/Keycloak.
 * Il backend reindirizza qui con i token nel fragment:
 *   /auth/callback#accessToken=...&refreshToken=...&expiresIn=...
 * Li salva, carica la sessione e porta alla dashboard.
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [CommonModule, ProgressSpinnerModule],
  template: `
    <main class="callback" role="status" aria-live="polite">
      <div class="callback__card">
        <div class="callback__brand">
          <span class="callback__glyph"><i class="pi pi-sync" aria-hidden="true"></i></span>
          <span class="callback__name">WasteFlow</span>
        </div>

        <p-progressSpinner
          strokeWidth="4"
          [style]="{ width: '56px', height: '56px' }"
          ariaLabel="Accesso in corso"
        ></p-progressSpinner>

        <h1 class="callback__title">{{ message }}</h1>
        <p class="callback__hint">
          Stiamo verificando la tua identità digitale, attendi qualche istante.
        </p>
      </div>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .callback {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--spacing-lg);
        background:
          radial-gradient(120% 90% at 50% 0%, var(--brand-primary-50) 0%, transparent 60%),
          var(--surface-ground);
      }
      .callback__card {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: var(--spacing-base);
        width: 100%;
        max-width: 400px;
        padding: clamp(2rem, 5vw, 3rem);
        background: var(--surface-card);
        border: 1px solid var(--surface-border);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-md);
        animation: fadeInUp var(--transition-base);
      }
      .callback__brand {
        display: flex;
        align-items: center;
        gap: 0.55rem;
        margin-bottom: var(--spacing-sm);
      }
      .callback__glyph {
        width: 38px;
        height: 38px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(--brand-primary-50);
        border: 1px solid var(--brand-primary-100);
        border-radius: var(--radius-md);
      }
      .callback__glyph i {
        font-size: 1.15rem;
        color: var(--brand-primary-dark);
      }
      .callback__name {
        font-family: var(--font-display);
        font-weight: var(--font-weight-bold);
        font-size: var(--font-size-lg);
        color: var(--text-primary);
      }
      .callback__title {
        font-family: var(--font-display);
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-semibold);
        margin: var(--spacing-sm) 0 0;
        color: var(--text-primary);
      }
      .callback__hint {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        line-height: var(--line-height-normal);
      }
      @media (prefers-reduced-motion: reduce) {
        .callback__card {
          animation: none;
        }
      }
    `,
  ],
})
export class AuthCallbackComponent implements OnInit {
  private readonly authService = inject(AuthService)
  private readonly router = inject(Router)
  message = 'Accesso in corso…'

  ngOnInit(): void {
    const raw = window.location.hash || ''
    const hash = raw.startsWith('#') ? raw.substring(1) : raw
    const params = new URLSearchParams(hash)
    const accessToken = params.get('accessToken')
    const refreshToken = params.get('refreshToken')

    if (!accessToken || !refreshToken) {
      this.router.navigate(['/login'])
      return
    }

    this.authService.completeSpidLogin(accessToken, refreshToken).subscribe({
      next: () => {
        // Pulisce il fragment (token) dall'URL e va alla dashboard
        history.replaceState(null, '', window.location.pathname)
        this.router.navigate(['/dashboard'])
      },
      error: () => {
        this.message = 'Accesso non riuscito. Reindirizzamento…'
        this.router.navigate(['/login'])
      },
    })
  }
}
