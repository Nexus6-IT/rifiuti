import { Component } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { Router, ActivatedRoute, RouterModule } from '@angular/router'
import { MessageService } from 'primeng/api'
import { CardModule } from 'primeng/card'
import { InputTextModule } from 'primeng/inputtext'
import { PasswordModule } from 'primeng/password'
import { ButtonModule } from 'primeng/button'
import { DividerModule } from 'primeng/divider'
import { AuthService } from '../../core/services/auth.service'

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    CardModule,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    DividerModule,
  ],
  template: `
    <div class="auth">
      <!-- ===== Pannello brand (sinistra) ===== -->
      <aside class="auth__brand" aria-hidden="true">
        <div class="auth__brand-inner">
          <div class="brand-mark">
            <span class="brand-mark__glyph"><i class="pi pi-sync"></i></span>
            <span class="brand-mark__name">WasteFlow</span>
          </div>

          <div class="brand-hero">
            <p class="brand-hero__eyebrow">Gestione digitale dei rifiuti</p>
            <h2 class="brand-hero__title">La tracciabilità dei rifiuti, semplice e conforme.</h2>
            <p class="brand-hero__lede">
              Piattaforma per la Pubblica Amministrazione: formulari, registri e comunicazioni
              ambientali in un unico flusso digitale.
            </p>
          </div>

          <ul class="brand-list">
            <li class="brand-list__item">
              <i class="pi pi-file-edit" aria-hidden="true"></i>
              <span>Gestione completa dei FIR</span>
            </li>
            <li class="brand-list__item">
              <i class="pi pi-sync" aria-hidden="true"></i>
              <span>Integrazione RENTRI</span>
            </li>
            <li class="brand-list__item">
              <i class="pi pi-chart-line" aria-hidden="true"></i>
              <span>Tracciabilità in tempo reale</span>
            </li>
            <li class="brand-list__item">
              <i class="pi pi-verified" aria-hidden="true"></i>
              <span>Conformità normativa garantita</span>
            </li>
          </ul>

          <p class="brand-foot">Piattaforma modulare per la Pubblica Amministrazione</p>
        </div>
      </aside>

      <!-- ===== Pannello form (destra) ===== -->
      <main class="auth__main" id="contenuto-login">
        <div class="auth__panel">
          <!-- Logo mobile (visibile solo dove il pannello brand è nascosto) -->
          <div class="auth__logo-mobile">
            <span class="brand-mark__glyph"><i class="pi pi-sync" aria-hidden="true"></i></span>
            <span class="brand-mark__name">WasteFlow</span>
          </div>

          <header class="auth__head">
            <h1 class="auth__title">Accedi</h1>
            <p class="auth__subtitle">Accedi a WasteFlow con le credenziali del tuo account.</p>
          </header>

          <!-- Accesso (via Keycloak). SPID/CIE saranno abilitati in una fase successiva. -->
          <div class="auth__idp" role="group" aria-label="Accesso">
            <p-button
              label="Accedi"
              icon="pi pi-sign-in"
              [loading]="loading"
              styleClass="w-full idp-button idp-button--spid"
              (onClick)="onSPIDLogin()"
              ariaLabel="Accedi a WasteFlow"
            />
          </div>

          <p class="auth__help">
            Non hai ancora un account?
            <a routerLink="/signup" class="auth__help-link">Registra la tua azienda</a>
          </p>
          <p class="auth__help" style="margin-top: 0.5rem">
            Hai bisogno di assistenza?
            <a href="mailto:supporto@wasteflow.it" class="auth__help-link">Contatta il supporto</a>
          </p>
        </div>

        <footer class="auth__footer">
          <span>&copy; {{ currentYear }} WasteFlow</span>
          <span class="auth__footer-sep" aria-hidden="true">·</span>
          <a routerLink="/legal/privacy" target="_blank" rel="noopener" class="auth__footer-link"
            >Privacy</a
          >
          <span class="auth__footer-sep" aria-hidden="true">·</span>
          <a routerLink="/legal/termini" target="_blank" rel="noopener" class="auth__footer-link"
            >Termini di servizio</a
          >
        </footer>
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .auth {
        min-height: 100vh;
        display: grid;
        grid-template-columns: 1.05fr 1fr;
        background: var(--surface-ground);
      }

      /* ============ Pannello brand ============ */
      .auth__brand {
        position: relative;
        overflow: hidden;
        color: var(--text-inverse);
        background:
          radial-gradient(120% 90% at 12% 8%, rgba(255, 255, 255, 0.16) 0%, transparent 46%),
          radial-gradient(130% 120% at 92% 100%, rgba(0, 0, 0, 0.22) 0%, transparent 55%),
          linear-gradient(
            150deg,
            var(--brand-primary) 0%,
            var(--brand-primary-dark) 62%,
            var(--brand-accent-dark) 100%
          );
      }
      .auth__brand::after {
        content: '';
        position: absolute;
        inset: 0;
        background-image: radial-gradient(
          circle at 78% 22%,
          rgba(255, 255, 255, 0.1) 0,
          transparent 42%
        );
        pointer-events: none;
      }
      .auth__brand-inner {
        position: relative;
        z-index: 1;
        height: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2xl);
        padding: clamp(2rem, 4vw, 4rem);
        max-width: 560px;
        margin-left: auto;
      }

      .brand-mark {
        display: flex;
        align-items: center;
        gap: 0.7rem;
      }
      .brand-mark__glyph {
        width: 44px;
        height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.16);
        border: 1px solid rgba(255, 255, 255, 0.28);
        border-radius: var(--radius-md);
        backdrop-filter: blur(8px);
      }
      .brand-mark__glyph i {
        font-size: 1.35rem;
        color: #fff;
      }
      .brand-mark__name {
        font-family: var(--font-display);
        font-weight: var(--font-weight-bold);
        font-size: var(--font-size-xl);
        letter-spacing: -0.01em;
        color: #fff;
      }

      .brand-hero {
        margin-top: auto;
      }
      .brand-hero__eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
        color: rgba(255, 255, 255, 0.82);
        margin: 0 0 var(--spacing-sm);
      }
      .brand-hero__title {
        font-family: var(--font-display);
        font-size: clamp(1.75rem, 3vw, 2.5rem);
        line-height: 1.15;
        font-weight: var(--font-weight-bold);
        color: #fff;
        margin: 0 0 var(--spacing-base);
        letter-spacing: -0.02em;
      }
      .brand-hero__lede {
        font-size: var(--font-size-lg);
        line-height: var(--line-height-relaxed);
        color: rgba(255, 255, 255, 0.9);
        margin: 0;
        max-width: 46ch;
      }

      .brand-list {
        list-style: none;
        display: grid;
        gap: var(--spacing-md);
      }
      .brand-list__item {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        font-size: var(--font-size-base);
        font-weight: var(--font-weight-medium);
        color: rgba(255, 255, 255, 0.95);
      }
      .brand-list__item i {
        width: 34px;
        height: 34px;
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: var(--radius-base);
        font-size: 1rem;
        color: #fff;
      }

      .brand-foot {
        margin: 0;
        font-size: var(--font-size-sm);
        color: rgba(255, 255, 255, 0.75);
      }

      /* ============ Pannello form ============ */
      .auth__main {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--spacing-xl);
        padding: clamp(1.5rem, 4vw, 3rem);
      }
      .auth__panel {
        width: 100%;
        max-width: 420px;
        animation: fadeInUp var(--transition-base);
      }

      .auth__logo-mobile {
        display: none;
        align-items: center;
        gap: 0.6rem;
        justify-content: center;
        margin-bottom: var(--spacing-xl);
      }
      .auth__logo-mobile .brand-mark__glyph {
        background: var(--brand-primary-50);
        border-color: var(--brand-primary-100);
      }
      .auth__logo-mobile .brand-mark__glyph i {
        color: var(--brand-primary-dark);
      }
      .auth__logo-mobile .brand-mark__name {
        color: var(--text-primary);
      }

      .auth__head {
        margin-bottom: var(--spacing-xl);
      }
      .auth__title {
        font-family: var(--font-display);
        font-size: var(--font-size-3xl);
        font-weight: var(--font-weight-bold);
        letter-spacing: -0.02em;
        margin: 0 0 var(--spacing-sm);
        color: var(--text-primary);
      }
      .auth__subtitle {
        margin: 0;
        color: var(--text-secondary);
        font-size: var(--font-size-base);
        line-height: var(--line-height-normal);
      }

      .auth__idp {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
      }

      .auth__sep {
        display: flex;
        align-items: center;
        gap: var(--spacing-base);
        margin: var(--spacing-xl) 0;
        color: var(--text-tertiary);
        font-size: var(--font-size-sm);
      }
      .auth__sep::before,
      .auth__sep::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--surface-border);
      }

      .auth__form {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .field__label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--text-secondary);
      }
      .field__req {
        color: var(--color-danger);
      }
      .field__hint {
        display: flex;
        align-items: flex-start;
        gap: 0.4rem;
        margin: 0;
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
        line-height: 1.45;
      }
      .field__hint i {
        margin-top: 1px;
        color: var(--color-info);
      }

      .auth__help {
        margin: var(--spacing-xl) 0 0;
        text-align: center;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }
      .auth__help-link {
        font-weight: var(--font-weight-semibold);
      }

      .auth__footer {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--font-size-xs);
        color: var(--text-tertiary);
      }
      .auth__footer-sep {
        color: var(--surface-border-strong);
      }
      .auth__footer-link {
        color: var(--text-tertiary);
        font-weight: var(--font-weight-medium);
      }
      .auth__footer-link:hover {
        color: var(--brand-primary-dark);
      }

      /* ============ Bottoni IdP / submit ============ */
      :host ::ng-deep .idp-button .p-button,
      :host ::ng-deep .submit-button .p-button {
        min-height: 50px;
        justify-content: center;
        font-size: var(--font-size-base) !important;
      }
      /* CIE in stile outlined ma con bordo più marcato */
      :host ::ng-deep .idp-button--cie .p-button {
        border-width: 1.5px;
      }

      /* ============ Responsive ============ */
      @media (max-width: 960px) {
        .auth {
          grid-template-columns: 1fr;
        }
        .auth__brand {
          display: none;
        }
        .auth__logo-mobile {
          display: flex;
        }
        .auth__main {
          min-height: 100vh;
          justify-content: center;
        }
      }

      @media (max-width: 420px) {
        .auth__main {
          padding: var(--spacing-lg) var(--spacing-base);
        }
        .auth__title {
          font-size: var(--font-size-2xl);
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .auth__panel {
          animation: none;
        }
      }
    `,
  ],
})
export class LoginComponent {
  email = ''
  password = ''
  loading = false
  emailTouched = false
  returnUrl = '/dashboard'
  readonly currentYear = new Date().getFullYear()

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private messageService: MessageService
  ) {
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard'
  }

  onLogin(): void {
    this.emailTouched = true
    if (!this.email) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Attenzione',
        detail: "Inserisci un'email",
      })
      return
    }

    this.loading = true
    this.authService.login(this.email).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Successo',
          detail: 'Login effettuato con successo',
        })
        this.router.navigate([this.returnUrl])
      },
      error: (error: any) => {
        this.loading = false
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: error.error?.message || 'Credenziali non valide',
        })
      },
    })
  }

  onSPIDLogin(): void {
    this.authService.loginWithSPID()
  }

  onCIELogin(): void {
    this.authService.loginWithCIE()
  }
}
