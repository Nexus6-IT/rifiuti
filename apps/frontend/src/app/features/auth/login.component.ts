import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { MessageService } from 'primeng/api';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    DividerModule
  ],
  template: `
    <div class="login-container">
      <div class="login-content">
        <!-- Brand Section -->
        <div class="brand-section">
          <div class="brand-logo">
            <div class="logo-icon">
              <i class="pi pi-trash" aria-hidden="true"></i>
            </div>
            <div class="logo-text">
              <h1 class="brand-name">WasteFlow</h1>
              <p class="brand-tagline">Sistema di Gestione Digitale Rifiuti</p>
            </div>
          </div>

          <!-- Feature List -->
          <div class="features-list">
            <div class="feature-item">
              <i class="pi pi-check-circle" aria-hidden="true"></i>
              <span>Gestione completa dei FIR</span>
            </div>
            <div class="feature-item">
              <i class="pi pi-check-circle" aria-hidden="true"></i>
              <span>Integrazione RENTRI</span>
            </div>
            <div class="feature-item">
              <i class="pi pi-check-circle" aria-hidden="true"></i>
              <span>Tracciabilità in tempo reale</span>
            </div>
            <div class="feature-item">
              <i class="pi pi-check-circle" aria-hidden="true"></i>
              <span>Conformità normativa garantita</span>
            </div>
          </div>
        </div>

        <!-- Login Form Section -->
        <div class="form-section">
          <div class="form-container">
            <!-- Form Header -->
            <div class="form-header">
              <h2 class="form-title">Benvenuto</h2>
              <p class="form-subtitle">Accedi al tuo account WasteFlow</p>
            </div>

            <!-- Login Card -->
            <p-card styleClass="login-card">
              <form class="login-form" (ngSubmit)="onLogin()">
                <!-- Email Input -->
                <div class="form-field">
                  <label for="email" class="field-label">
                    Email <span class="required">*</span>
                  </label>
                  <input
                    pInputText
                    id="email"
                    [(ngModel)]="email"
                    name="email"
                    type="email"
                    placeholder="tua-email@esempio.com"
                    class="w-full"
                    (keyup.enter)="onLogin()"
                    [attr.aria-required]="true"
                    [attr.aria-invalid]="!email && !loading ? 'true' : 'false'"
                    autofocus
                  />
                </div>

                <!-- Dev Mode Info -->
                <div class="dev-notice" role="note">
                  <i class="pi pi-info-circle" aria-hidden="true"></i>
                  <span>Modalità sviluppo: inserisci qualsiasi indirizzo email valido</span>
                </div>

                <!-- Action Buttons -->
                <div class="form-actions">
                  <p-button
                    label="Avanti"
                    [loading]="loading"
                    type="submit"
                    styleClass="w-full login-button"
                    [disabled]="!email"
                    aria-label="Effettua il login"
                  />

                  <div class="divider">
                    <span>oppure</span>
                  </div>

                  <p-button
                    label="Accedi con SPID"
                    icon="pi pi-shield"
                    [outlined]="true"
                    severity="secondary"
                    (onClick)="onSPIDLogin()"
                    styleClass="w-full spid-button"
                    aria-label="Accedi tramite SPID"
                  />
                </div>
              </form>
            </p-card>

            <!-- Footer Links -->
            <div class="form-footer">
              <p class="help-text">
                Hai bisogno di aiuto? <a href="#" class="help-link">Contatta il supporto</a>
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Page Footer -->
      <footer class="page-footer">
        <p class="footer-text">
          &copy; 2025 WasteFlow. Tutti i diritti riservati. |
          <a href="#" class="footer-link">Privacy Policy</a> |
          <a href="#" class="footer-link">Termini di Servizio</a>
        </p>
      </footer>
    </div>
  `,
  styles: [`
    .login-container {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: linear-gradient(135deg, var(--brand-primary, #2e7d32) 0%, var(--brand-accent, #0277bd) 100%);
      position: relative;
      overflow: hidden;
    }

    .login-container::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-image:
        radial-gradient(circle at 20% 50%, rgba(255, 255, 255, 0.1) 0%, transparent 50%),
        radial-gradient(circle at 80% 80%, rgba(255, 255, 255, 0.1) 0%, transparent 50%);
      pointer-events: none;
    }

    .login-content {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr 1fr;
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
      padding: var(--spacing-2xl, 2rem);
      gap: var(--spacing-3xl, 3rem);
      align-items: center;
      position: relative;
      z-index: 1;
    }

    /* Brand Section */
    .brand-section {
      color: white;
      padding: var(--spacing-2xl, 2rem);
    }

    .brand-logo {
      margin-bottom: var(--spacing-3xl, 3rem);
    }

    .logo-icon {
      width: 80px;
      height: 80px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: var(--spacing-lg, 1.5rem);
      animation: float 3s ease-in-out infinite;
    }

    .logo-icon i {
      font-size: 2.5rem;
      color: white;
    }

    .brand-name {
      margin: 0 0 var(--spacing-xs, 0.5rem) 0;
      font-size: var(--font-size-3xl, 2.25rem);
      font-weight: var(--font-weight-bold, 700);
      color: white;
      letter-spacing: -0.5px;
    }

    .brand-tagline {
      margin: 0;
      font-size: var(--font-size-lg, 1.125rem);
      color: rgba(255, 255, 255, 0.9);
      font-weight: var(--font-weight-normal, 400);
    }

    .features-list {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-lg, 1.5rem);
    }

    .feature-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-md, 1rem);
      padding: var(--spacing-md, 1rem);
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: var(--border-radius-md, 8px);
      border: 1px solid rgba(255, 255, 255, 0.2);
      transition: all 0.3s ease;
    }

    .feature-item:hover {
      background: rgba(255, 255, 255, 0.15);
      transform: translateX(5px);
    }

    .feature-item i {
      font-size: 1.5rem;
      color: rgba(255, 255, 255, 0.9);
      flex-shrink: 0;
    }

    .feature-item span {
      font-size: var(--font-size-base, 1rem);
      color: white;
      font-weight: var(--font-weight-medium, 500);
    }

    /* Form Section */
    .form-section {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .form-container {
      width: 100%;
      max-width: 440px;
    }

    .form-header {
      margin-bottom: var(--spacing-xl, 1.75rem);
      text-align: center;
    }

    .form-title {
      margin: 0 0 var(--spacing-xs, 0.5rem) 0;
      font-size: var(--font-size-2xl, 1.875rem);
      font-weight: var(--font-weight-bold, 700);
      color: white;
    }

    .form-subtitle {
      margin: 0;
      font-size: var(--font-size-base, 1rem);
      color: rgba(255, 255, 255, 0.9);
    }

    :host ::ng-deep .login-card {
      background: white;
      border: none;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      border-radius: var(--border-radius-lg, 12px);
    }

    .login-form {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-lg, 1.5rem);
    }

    .form-field {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-xs, 0.5rem);
    }

    .field-label {
      font-size: var(--font-size-sm, 0.875rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--text-primary, #1f2937);
    }

    .required {
      color: var(--error-color, #dc2626);
    }

    .dev-notice {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-sm, 0.75rem);
      padding: var(--spacing-sm, 0.75rem);
      background: var(--info-bg, #eff6ff);
      border-radius: var(--border-radius-sm, 4px);
      border-left: 3px solid var(--info-color, #3b82f6);
    }

    .dev-notice i {
      color: var(--info-color, #3b82f6);
      font-size: 1.25rem;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .dev-notice span {
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--text-secondary, #6b7280);
      line-height: 1.5;
    }

    .form-actions {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md, 1rem);
      margin-top: var(--spacing-sm, 0.75rem);
    }

    :host ::ng-deep .login-button {
      height: 48px;
      font-weight: var(--font-weight-semibold, 600);
    }

    :host ::ng-deep .spid-button {
      height: 44px;
    }

    .divider {
      position: relative;
      text-align: center;
      margin: var(--spacing-xs, 0.5rem) 0;
    }

    .divider::before,
    .divider::after {
      content: '';
      position: absolute;
      top: 50%;
      width: 45%;
      height: 1px;
      background: var(--gray-300, #d1d5db);
    }

    .divider::before {
      left: 0;
    }

    .divider::after {
      right: 0;
    }

    .divider span {
      display: inline-block;
      padding: 0 var(--spacing-sm, 0.75rem);
      font-size: var(--font-size-sm, 0.875rem);
      color: var(--text-secondary, #6b7280);
      background: white;
      position: relative;
    }

    .form-footer {
      margin-top: var(--spacing-lg, 1.5rem);
      text-align: center;
    }

    .help-text {
      margin: 0;
      font-size: var(--font-size-sm, 0.875rem);
      color: rgba(255, 255, 255, 0.9);
    }

    .help-link {
      color: white;
      font-weight: var(--font-weight-semibold, 600);
      text-decoration: none;
      border-bottom: 1px solid rgba(255, 255, 255, 0.5);
      transition: border-color 0.2s ease;
    }

    .help-link:hover {
      border-bottom-color: white;
    }

    /* Page Footer */
    .page-footer {
      padding: var(--spacing-lg, 1.5rem);
      text-align: center;
      position: relative;
      z-index: 1;
    }

    .footer-text {
      margin: 0;
      font-size: var(--font-size-xs, 0.75rem);
      color: rgba(255, 255, 255, 0.8);
    }

    .footer-link {
      color: rgba(255, 255, 255, 0.9);
      text-decoration: none;
      margin: 0 var(--spacing-xs, 0.5rem);
      transition: color 0.2s ease;
    }

    .footer-link:hover {
      color: white;
      text-decoration: underline;
    }

    /* Animations */
    @keyframes float {
      0%, 100% {
        transform: translateY(0);
      }
      50% {
        transform: translateY(-10px);
      }
    }

    /* Responsive Design */
    @media (max-width: 1024px) {
      .login-content {
        grid-template-columns: 1fr;
        gap: var(--spacing-2xl, 2rem);
        padding: var(--spacing-xl, 1.75rem);
      }

      .brand-section {
        display: none;
      }

      .form-section {
        order: 1;
      }
    }

    @media (max-width: 576px) {
      .login-content {
        padding: var(--spacing-lg, 1.5rem);
      }

      .form-container {
        max-width: 100%;
      }

      .form-title {
        font-size: var(--font-size-xl, 1.25rem);
      }

      .brand-name {
        font-size: var(--font-size-2xl, 1.875rem);
      }
    }

    /* Accessibility */
    @media (prefers-reduced-motion: reduce) {
      .logo-icon,
      .feature-item {
        animation: none;
        transition: none;
      }
    }
  `]
})
export class LoginComponent {
  email = '';
  password = '';
  loading = false;
  returnUrl = '/dashboard';

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute,
    private messageService: MessageService
  ) {
    this.returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard';
  }

  onLogin(): void {
    if (!this.email) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Attenzione',
        detail: 'Inserisci un\'email'
      });
      return;
    }

    this.loading = true;
    this.authService.login(this.email).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Successo',
          detail: 'Login effettuato con successo'
        });
        this.router.navigate([this.returnUrl]);
      },
      error: (error: any) => {
        this.loading = false;
        this.messageService.add({
          severity: 'error',
          summary: 'Errore',
          detail: error.error?.message || 'Credenziali non valide'
        });
      }
    });
  }

  onSPIDLogin(): void {
    this.authService.loginWithSPID();
  }
}
