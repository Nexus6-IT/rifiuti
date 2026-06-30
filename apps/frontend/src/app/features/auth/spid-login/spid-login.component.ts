import { Component, OnInit, inject } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ActivatedRoute } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { CardModule } from 'primeng/card'
import { DividerModule } from 'primeng/divider'
import { AuthService } from '../../../core/services/auth.service'

/**
 * SPID Login Component
 *
 * Displays SPID and CIE login options.
 * Redirects to Keycloak SAML endpoint on button click.
 */
@Component({
  selector: 'app-spid-login',
  standalone: true,
  imports: [CommonModule, ButtonModule, CardModule, DividerModule],
  template: `
    <div class="login-container">
      <p-card styleClass="login-card">
        <ng-template pTemplate="header">
          <div class="text-center py-4">
            <h1 class="login-brand mb-2">WasteFlow</h1>
            <p class="login-muted">Sistema di gestione rifiuti conforme RENTRI</p>
          </div>
        </ng-template>

        <div class="text-center mb-4">
          <h2 class="login-heading mb-2">Accedi con identità digitale</h2>
          <p class="login-muted">Utilizza SPID o CIE per accedere in modo sicuro</p>
        </div>

        <!-- SPID Login Button -->
        <button
          pButton
          type="button"
          label="Entra con SPID"
          icon="pi pi-user"
          class="w-full mb-3 idp-btn"
          data-cy="spid-button"
          (click)="loginWithSPID()"
        ></button>

        <p-divider align="center">
          <span class="login-muted">oppure</span>
        </p-divider>

        <!-- CIE Login Button -->
        <button
          pButton
          type="button"
          label="Entra con CIE"
          icon="pi pi-id-card"
          class="w-full idp-btn p-button-outlined"
          data-cy="cie-button"
          (click)="loginWithCIE()"
        ></button>

        <ng-template pTemplate="footer">
          <div class="text-center text-sm login-muted">
            <p class="mb-2">
              <i class="pi pi-info-circle mr-1"></i>
              L'accesso richiede SPID livello 2 o superiore per firmare documenti
            </p>
            <p>
              <i class="pi pi-shield mr-1"></i>
              Connessione sicura protetta da crittografia
            </p>
          </div>
        </ng-template>
      </p-card>

      <!-- Info Section -->
      <div class="info-section mt-4">
        <p-card>
          <ng-template pTemplate="header">
            <div class="px-3 pt-3">
              <h3 class="login-subheading">Cos'è SPID?</h3>
            </div>
          </ng-template>

          <p class="mb-3">
            SPID (Sistema Pubblico di Identità Digitale) è il sistema di autenticazione che permette
            a cittadini e imprese di accedere ai servizi online della Pubblica Amministrazione con
            un'unica identità digitale.
          </p>

          <h4 class="login-list-title mb-2">Livelli di sicurezza:</h4>
          <ul class="list-disc pl-5 mb-3">
            <li><strong>Livello 1:</strong> Username e password (accesso base)</li>
            <li>
              <strong>Livello 2:</strong> Username, password + OTP (richiesto per firme digitali)
            </li>
            <li>
              <strong>Livello 3:</strong> Username, password + token hardware (massima sicurezza)
            </li>
          </ul>

          <p class="text-sm login-muted">
            Non hai SPID?
            <a href="https://www.spid.gov.it" target="_blank" rel="noopener" class="login-link">
              Scopri come ottenerlo
            </a>
          </p>
        </p-card>
      </div>
    </div>
  `,
  styles: [
    `
      .login-container {
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        padding: var(--spacing-xl);
        gap: var(--spacing-base);
        background:
          radial-gradient(120% 90% at 50% 0%, var(--brand-primary-50) 0%, transparent 60%),
          var(--surface-ground);
      }

      .login-card {
        width: 100%;
        max-width: 500px;
        box-shadow: var(--shadow-md);
      }

      .info-section {
        width: 100%;
        max-width: 500px;
      }

      .login-brand {
        font-family: var(--font-display);
        font-size: var(--font-size-3xl);
        font-weight: var(--font-weight-bold);
        letter-spacing: -0.02em;
        color: var(--brand-primary-dark);
        margin: 0;
      }
      .login-heading {
        font-family: var(--font-display);
        font-size: var(--font-size-2xl);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin: 0;
      }
      .login-subheading {
        font-family: var(--font-display);
        font-size: var(--font-size-lg);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        margin: 0;
      }
      .login-list-title {
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }
      .login-muted {
        color: var(--text-secondary);
      }
      .login-link {
        color: var(--brand-primary-dark);
        font-weight: var(--font-weight-semibold);
        text-decoration: none;
      }
      .login-link:hover {
        text-decoration: underline;
      }

      /* Bottoni IdP a piena larghezza, leggermente più alti (variante lg DS) */
      :host ::ng-deep .idp-btn.p-button {
        height: var(--control-lg);
        justify-content: center;
        font-size: var(--font-size-base) !important;
      }
    `,
  ],
})
export class SpidLoginComponent implements OnInit {
  private readonly authService = inject(AuthService)
  private readonly route = inject(ActivatedRoute)

  private returnUrl?: string

  ngOnInit(): void {
    // Get return URL from query params
    this.returnUrl = this.route.snapshot.queryParams['returnUrl']
  }

  loginWithSPID(): void {
    this.authService.loginWithSPID(this.returnUrl)
  }

  loginWithCIE(): void {
    this.authService.loginWithCIE(this.returnUrl)
  }
}
