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
import { SegnoMarchioComponent } from '../../shared/components/segno-marchio.component'

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
    SegnoMarchioComponent,
  ],
  template: `
    <div class="auth">
      <!-- ===== Pannello brand (sinistra) ===== -->
      <aside class="auth__brand" aria-hidden="true">
        <div class="auth__brand-inner">
          <div class="brand-mark">
            <app-segno-marchio [dimensione]="32" />
            <span class="brand-mark__name">WasteFlow</span>
          </div>

          <div class="brand-hero">
            <p class="brand-hero__eyebrow">Gestione digitale dei rifiuti</p>
            <h2 class="brand-hero__title">Formulari, registro e RENTRI in un solo posto</h2>
            <p class="brand-hero__lede">
              Il gestionale per le aziende che producono, trasportano e recuperano rifiuti.
            </p>
          </div>

          <ul class="brand-list">
            <li class="brand-list__item">FIR digitali e trasmissione a RENTRI</li>
            <li class="brand-list__item">Registro di carico e scarico sempre allineato</li>
            <li class="brand-list__item">MUD preparato dai dati dell'anno</li>
          </ul>

          <p class="brand-foot">WasteFlow · IgniCraft</p>
        </div>
      </aside>

      <!-- ===== Pannello form (destra) ===== -->
      <main class="auth__main" id="contenuto-login">
        <div class="auth__panel">
          <!-- Logo mobile (visibile solo dove il pannello brand è nascosto) -->
          <div class="auth__logo-mobile">
            <app-segno-marchio [dimensione]="32" />
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
              [loading]="loading"
              styleClass="w-full idp-button idp-button--spid wf-primario"
              (onClick)="onSPIDLogin()"
              ariaLabel="Accedi a WasteFlow"
            />
          </div>

          <p class="auth__help">
            Non hai ancora un account?
            <a routerLink="/richiedi-accesso" class="auth__help-link">Richiedi accesso</a>
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
        grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
        background: var(--surface-ground);
      }

      /* ============ Pannello brand ============ */
      /* Pannello piatto «Libro mastro»: inchiostro pieno, nessuna sfumatura; ≤ 40% sopra i 992 px. */
      .auth__brand {
        position: relative;
        overflow: hidden;
        color: var(--on-brand-panel);
        background: var(--brand-panel);
        border-inline-end: 1px solid var(--surface-border);
      }
      .auth__brand-inner {
        position: sticky;
        top: 0;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2xl);
        padding: clamp(2rem, 4vw, 3.5rem);
        max-width: 560px;
        margin-left: auto;
      }

      .brand-mark {
        --text-primary: var(--on-brand-panel);
        display: flex;
        align-items: center;
        gap: 0.65rem;
      }
      .brand-mark__name {
        font-family: var(--font-display);
        font-weight: var(--font-weight-bold);
        font-size: var(--font-size-xl);
        letter-spacing: -0.01em;
        color: var(--on-brand-panel);
      }

      .brand-hero {
        margin-top: auto;
      }
      .brand-hero__eyebrow {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-medium);
        color: var(--brand-mark);
        margin: 0 0 var(--spacing-sm);
      }
      .brand-hero__title {
        font-family: var(--font-display);
        font-size: clamp(1.75rem, 2.6vw, 2.25rem);
        line-height: 1.15;
        font-weight: var(--font-weight-bold);
        color: var(--on-brand-panel);
        margin: 0 0 var(--spacing-base);
        letter-spacing: -0.02em;
      }
      .brand-hero__lede {
        font-size: var(--font-size-base);
        line-height: var(--line-height-relaxed);
        color: var(--on-brand-panel);
        opacity: 0.82;
        margin: 0;
        max-width: 42ch;
      }

      /* Elenco a righe sottili, senza icone in riquadri */
      .brand-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .brand-list__item {
        padding: var(--spacing-md) 0;
        border-top: 1px solid color-mix(in srgb, var(--on-brand-panel) 16%, transparent);
        font-size: var(--font-size-base);
        color: var(--on-brand-panel);
      }

      .brand-foot {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--on-brand-panel);
        opacity: 0.7;
      }

      /* ============ Pannello form ============ */
      .auth__main {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        gap: var(--spacing-xl);
        padding: clamp(1.5rem, 6vh, 4rem) clamp(1.5rem, 4vw, 3rem) clamp(1.5rem, 4vw, 3rem);
      }
      .auth__panel {
        width: 100%;
        max-width: 420px;
      }

      .auth__logo-mobile {
        display: none;
        align-items: center;
        gap: 0.6rem;
        justify-content: center;
        margin-bottom: var(--spacing-xl);
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
        margin-top: auto;
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
      :host ::ng-deep .p-button.idp-button,
      :host ::ng-deep .p-button.submit-button {
        min-height: 44px;
        justify-content: center;
        font-size: var(--font-size-base) !important;
      }
      /* CIE in stile outlined ma con bordo più marcato */
      :host ::ng-deep .p-button.idp-button--cie {
        border-width: 1.5px;
      }

      /* ============ Responsive ============ */
      @media (max-width: 767.98px) {
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
