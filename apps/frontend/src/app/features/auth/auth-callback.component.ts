import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { AuthService } from '../../core/services/auth.service';

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
    <div style="min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1rem;">
      <p-progressSpinner strokeWidth="4" ariaLabel="Accesso in corso"></p-progressSpinner>
      <p>{{ message }}</p>
    </div>
  `,
})
export class AuthCallbackComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  message = 'Accesso in corso…';

  ngOnInit(): void {
    const raw = window.location.hash || '';
    const hash = raw.startsWith('#') ? raw.substring(1) : raw;
    const params = new URLSearchParams(hash);
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');

    if (!accessToken || !refreshToken) {
      this.router.navigate(['/login']);
      return;
    }

    this.authService.completeSpidLogin(accessToken, refreshToken).subscribe({
      next: () => {
        // Pulisce il fragment (token) dall'URL e va alla dashboard
        history.replaceState(null, '', window.location.pathname);
        this.router.navigate(['/dashboard']);
      },
      error: () => {
        this.message = 'Accesso non riuscito. Reindirizzamento…';
        this.router.navigate(['/login']);
      },
    });
  }
}
