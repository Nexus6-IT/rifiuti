import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TagModule } from 'primeng/tag';
import { PermissionStore } from '../../../../core/state/permission.store';

/**
 * PermissionDeniedComponent
 * Full-page error component shown when user lacks required permissions
 * Per plan.md FR-009: Contextual error messages for permission denials
 *
 * Features:
 * - Clear explanation of why access was denied
 * - Display required permission vs user's current role
 * - Visual feedback with icons and colors
 * - Actionable next steps (contact admin, go back)
 * - Support email and help documentation links
 * - Show user's current permissions for transparency
 *
 * T094: Styled permission denied error page
 */
@Component({
  selector: 'app-permission-denied',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    MessageModule,
    TagModule,
  ],
  template: `
    <div class="denied-page">
      <main class="denied-container" role="main">
        <!-- Intestazione -->
        <div class="denied-header">
          <div class="denied-icon-wrapper" aria-hidden="true">
            <i class="pi pi-lock denied-icon"></i>
          </div>
          <h1 class="denied-title">Accesso non consentito</h1>
          <p class="denied-subtitle">
            Non hai i permessi necessari per visualizzare questa pagina. Nessun problema: qui sotto trovi cosa puoi fare.
          </p>
        </div>

        <!-- Dettaglio in card -->
        <section class="surface-card denied-card" aria-label="Dettagli del permesso richiesto">
          <p-message
            severity="warn"
            [text]="getErrorMessage()"
            styleClass="denied-message"
            role="status">
          </p-message>

          <!-- Permesso richiesto -->
          <div class="info-section" *ngIf="requiredPermission">
            <h2 class="section-title">
              <i class="pi pi-shield" aria-hidden="true"></i>
              Permesso richiesto
            </h2>
            <div class="permission-code">
              <code>{{ requiredPermission }}</code>
            </div>
            <div class="permission-breakdown">
              <div class="breakdown-item">
                <span class="label">Risorsa</span>
                <span class="value">{{ getResource() }}</span>
              </div>
              <div class="breakdown-item">
                <span class="label">Azione</span>
                <span class="value">{{ getAction() }}</span>
              </div>
              <div class="breakdown-item">
                <span class="label">Ambito</span>
                <span class="value">{{ getScope() }}</span>
              </div>
            </div>
          </div>

          <!-- Ruolo attuale -->
          <div class="info-section" *ngIf="currentRole">
            <h2 class="section-title">
              <i class="pi pi-user" aria-hidden="true"></i>
              Il tuo ruolo attuale
            </h2>
            <p-tag [value]="currentRole" severity="info"></p-tag>
          </div>

          <!-- Permessi dell'utente -->
          <div class="info-section" *ngIf="showUserPermissions">
            <h2 class="section-title">
              <i class="pi pi-list" aria-hidden="true"></i>
              I tuoi permessi attuali
            </h2>
            <div class="permissions-list">
              <div
                *ngFor="let permission of getUserPermissions()"
                class="permission-item">
                <i class="pi pi-check-circle" aria-hidden="true"></i>
                <code>{{ permission }}</code>
              </div>
              <div
                *ngIf="getUserPermissions().length === 0"
                class="no-permissions">
                <i class="pi pi-info-circle" aria-hidden="true"></i>
                <span>Nessun permesso assegnato</span>
              </div>
            </div>
          </div>

          <!-- Cosa posso fare -->
          <div class="info-section next-steps">
            <h2 class="section-title">
              <i class="pi pi-compass" aria-hidden="true"></i>
              Cosa puoi fare
            </h2>
            <ul class="steps-list">
              <li>
                <i class="pi pi-envelope" aria-hidden="true"></i>
                <span>
                  Contatta l'amministratore all'indirizzo
                  <a [href]="'mailto:' + supportEmail">{{ supportEmail }}</a>
                  per richiedere l'accesso.
                </span>
              </li>
              <li>
                <i class="pi pi-book" aria-hidden="true"></i>
                <span>
                  Consulta la
                  <a href="/docs/permissions" target="_blank" rel="noopener">
                    documentazione sui permessi</a>
                  per capire i requisiti di accesso.
                </span>
              </li>
              <li>
                <i class="pi pi-arrow-left" aria-hidden="true"></i>
                <span>Torna a una pagina a cui hai accesso.</span>
              </li>
            </ul>
          </div>
        </section>

        <!-- Azioni -->
        <div class="denied-actions">
          <button
            pButton
            label="Torna indietro"
            icon="pi pi-arrow-left"
            (click)="goBack()"
            data-testid="go-back-button">
          </button>
          <button
            pButton
            label="Richiedi accesso"
            icon="pi pi-user-plus"
            class="p-button-success"
            (click)="requestAccess()"
            data-testid="request-access-button">
          </button>
          <button
            pButton
            label="Vai alla dashboard"
            icon="pi pi-home"
            class="p-button-outlined"
            (click)="goToDashboard()">
          </button>
        </div>

        <!-- Aiuto aggiuntivo -->
        <div class="surface-card additional-help">
          <p class="help-text">
            <i class="pi pi-question-circle" aria-hidden="true"></i>
            Hai bisogno di assistenza immediata? Chiama il supporto al
            <strong>{{ supportPhone }}</strong>
          </p>
        </div>
      </main>
    </div>
  `,
  styles: [`
    .denied-page {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--surface-ground);
      padding: clamp(1rem, 3vw, var(--spacing-xl));
    }

    .denied-container {
      max-width: 760px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-lg);
    }

    .denied-header { text-align: center; }

    .denied-icon-wrapper {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 96px;
      height: 96px;
      background: var(--brand-primary-50);
      border: 1px solid var(--brand-primary-100);
      border-radius: var(--radius-full);
      margin-bottom: var(--spacing-base);
    }

    .denied-icon { font-size: 2.75rem; color: var(--brand-primary-dark); }

    .denied-title {
      font-family: var(--font-display);
      font-size: var(--font-size-3xl);
      margin: 0 0 var(--spacing-sm);
    }

    .denied-subtitle {
      font-size: var(--font-size-base);
      color: var(--text-secondary);
      margin: 0 auto;
      max-width: 52ch;
    }

    .denied-card { display: flex; flex-direction: column; gap: var(--spacing-lg); }

    :host ::ng-deep .denied-message { width: 100%; }

    .info-section {
      padding: var(--spacing-lg);
      background: var(--color-gray-50);
      border-radius: var(--radius-md);
      border-left: 4px solid var(--brand-primary);
    }
    .info-section.next-steps { border-left-color: var(--color-success); }

    .section-title {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      font-size: var(--font-size-lg);
      font-family: var(--font-display);
      color: var(--text-primary);
      margin: 0 0 var(--spacing-base);
    }
    .section-title i { color: var(--brand-primary-dark); }

    .permission-code {
      background: var(--color-gray-900);
      color: var(--brand-primary-light);
      padding: var(--spacing-base);
      border-radius: var(--radius-base);
      margin-bottom: var(--spacing-base);
      font-family: var(--font-family-mono);
      overflow-x: auto;
    }
    .permission-code code { font-size: var(--font-size-base); font-weight: var(--font-weight-semibold); }

    .permission-breakdown {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: var(--spacing-base);
    }
    .breakdown-item { display: flex; flex-direction: column; gap: var(--spacing-xs); }
    .breakdown-item .label {
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-tertiary);
      font-weight: var(--font-weight-semibold);
    }
    .breakdown-item .value {
      font-size: var(--font-size-sm);
      color: var(--text-primary);
      font-weight: var(--font-weight-semibold);
      background: var(--surface-card);
      padding: var(--spacing-sm);
      border-radius: var(--radius-base);
      border: 1px solid var(--surface-border);
    }

    .permissions-list {
      max-height: 280px;
      overflow-y: auto;
      background: var(--surface-card);
      padding: var(--spacing-sm);
      border-radius: var(--radius-base);
      border: 1px solid var(--surface-border);
    }
    .permission-item {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      padding: var(--spacing-sm);
      border-bottom: 1px solid var(--surface-border);
      font-family: var(--font-family-mono);
      font-size: var(--font-size-sm);
    }
    .permission-item:last-child { border-bottom: none; }
    .permission-item i { color: var(--color-success); }

    .no-permissions {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      color: var(--text-tertiary);
      padding: var(--spacing-base);
    }

    .steps-list { list-style: none; padding: 0; margin: 0; }
    .steps-list li {
      display: flex;
      align-items: flex-start;
      gap: var(--spacing-md);
      padding: var(--spacing-base);
      background: var(--surface-card);
      margin-bottom: var(--spacing-md);
      border-radius: var(--radius-base);
      border: 1px solid var(--surface-border);
      line-height: var(--line-height-normal);
      color: var(--text-secondary);
    }
    .steps-list li:last-child { margin-bottom: 0; }
    .steps-list i {
      color: var(--brand-primary-dark);
      font-size: var(--font-size-xl);
      margin-top: 0.1rem;
      flex-shrink: 0;
    }

    .denied-actions {
      display: flex;
      justify-content: center;
      flex-wrap: wrap;
      gap: var(--spacing-base);
    }

    .additional-help { text-align: center; }
    .help-text {
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: var(--spacing-sm);
      color: var(--text-secondary);
    }
    .help-text i { color: var(--brand-primary-dark); }

    @media (max-width: 576px) {
      .denied-actions { flex-direction: column; }
      .denied-actions button { width: 100%; }
      .permission-breakdown { grid-template-columns: 1fr; }
    }
  `]
})
export class PermissionDeniedComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly permissionStore = inject(PermissionStore);

  // Error details from query params
  requiredPermission: string = '';
  currentRole: string = '';
  resourceName: string = '';
  showUserPermissions: boolean = true;

  // Support contact info
  supportEmail: string = 'support@wasteflow.it';
  supportPhone: string = '+39 02 1234 5678';

  ngOnInit(): void {
    // Read error details from route query params
    this.route.queryParams.subscribe((params) => {
      this.requiredPermission = params['permission'] || '';
      this.currentRole = params['role'] || 'Sconosciuto';
      this.resourceName = params['resource'] || 'questa risorsa';
      this.showUserPermissions = params['showPermissions'] !== 'false';
    });

    // Trigger haptic feedback on page load (mobile devices only)
    // T130: Haptic feedback for permission denied
    this.triggerHapticFeedback();
  }

  /**
   * Trigger haptic feedback on mobile devices
   * T130: Mobile-first UX with haptic feedback
   */
  private triggerHapticFeedback(): void {
    // Check if vibration API is supported
    if ('vibrate' in navigator) {
      // Pattern: short vibration for error (200ms)
      navigator.vibrate(200);
    }
  }

  /**
   * Get contextual error message
   */
  getErrorMessage(): string {
    if (this.requiredPermission) {
      return `Per accedere a ${this.resourceName} ti serve il permesso "${this.requiredPermission}". Il tuo ruolo attuale "${this.currentRole}" non lo include.`;
    }
    return 'Non disponi dei permessi sufficienti per accedere a questa risorsa.';
  }

  /**
   * Extract resource from permission string
   */
  getResource(): string {
    const parts = this.requiredPermission.split(':');
    return parts[0] || 'unknown';
  }

  /**
   * Extract action from permission string
   */
  getAction(): string {
    const parts = this.requiredPermission.split(':');
    return parts[1] || 'unknown';
  }

  /**
   * Extract scope from permission string
   */
  getScope(): string {
    const parts = this.requiredPermission.split(':');
    return parts[2] || 'unknown';
  }

  /**
   * Get user's current permissions
   */
  getUserPermissions(): string[] {
    return this.permissionStore.permissions();
  }

  /**
   * Navigate back to previous page
   */
  goBack(): void {
    window.history.back();
  }

  /**
   * Navigate to dashboard
   */
  goToDashboard(): void {
    this.router.navigate(['/dashboard']);
  }

  /**
   * Navigate to permission request form (T131: US7 integration point)
   * This connects to User Story 7: Self-service permission request workflow
   */
  requestAccess(): void {
    this.router.navigate(['/permissions/request'], {
      queryParams: {
        permission: this.requiredPermission,
        reason: 'Access denied - requesting permission',
        returnUrl: this.router.url,
      },
    });
  }

  /**
   * Open email to contact support
   */
  contactSupport(): void {
    const subject = encodeURIComponent('Access Request - Permission Denied');
    const body = encodeURIComponent(
      `Hello,\n\nI am requesting access to the following resource:\n\nRequired Permission: ${this.requiredPermission}\nCurrent Role: ${this.currentRole}\n\nPlease grant me access or provide guidance.\n\nThank you.`
    );
    window.location.href = `mailto:${this.supportEmail}?subject=${subject}&body=${body}`;
  }
}

/**
 * Usage in routing:
 *
 * {
 *   path: 'permission-denied',
 *   component: PermissionDeniedComponent,
 * }
 *
 * Redirect with error details:
 *
 * this.router.navigate(['/permission-denied'], {
 *   queryParams: {
 *     permission: 'fir:delete:facility',
 *     role: 'OPERATOR',
 *     resource: 'FIR document deletion',
 *   }
 * });
 *
 * Usage in PermissionGuard:
 *
 * if (!hasPermission) {
 *   this.router.navigate(['/permission-denied'], {
 *     queryParams: {
 *       permission: requiredPermission,
 *       role: user.primaryRole,
 *       resource: route.data['resource'] || 'this resource',
 *     }
 *   });
 *   return false;
 * }
 */
