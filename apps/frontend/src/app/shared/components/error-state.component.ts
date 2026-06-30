import { Component, Input, Output, EventEmitter } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ButtonModule } from 'primeng/button'

/**
 * Error State Component
 *
 * A reusable component for displaying error states with helpful messages and retry actions.
 * Provides visual feedback when operations fail or errors occur.
 *
 * @example
 * <!-- API Error with retry -->
 * <app-error-state
 *   title="Errore di caricamento"
 *   message="Impossibile caricare i dati. Controlla la connessione e riprova."
 *   (retry)="loadData()"
 * />
 *
 * <!-- Network Error -->
 * <app-error-state
 *   variant="network"
 *   (retry)="reloadPage()"
 * />
 *
 * <!-- Permission Error -->
 * <app-error-state
 *   variant="permission"
 *   message="Non hai i permessi per accedere a questa risorsa."
 * />
 */
@Component({
  selector: 'app-error-state',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <div
      class="error-state"
      [ngClass]="'error-state--' + variant"
      role="alert"
      aria-live="assertive"
    >
      <div class="error-state__content">
        <!-- Icon -->
        <div class="error-state__icon" [ngClass]="iconClass">
          <i [class]="'pi ' + icon" aria-hidden="true"></i>
        </div>

        <!-- Title -->
        <h3 class="error-state__title">{{ title }}</h3>

        <!-- Message -->
        <p class="error-state__message" *ngIf="message">{{ message }}</p>

        <!-- Error Details (collapsible for technical errors) -->
        <div class="error-state__details" *ngIf="errorDetails && showDetails">
          <details>
            <summary class="error-state__details-toggle">Dettagli tecnici</summary>
            <pre class="error-state__details-content">{{ errorDetails }}</pre>
          </details>
        </div>

        <!-- Action Buttons -->
        <div class="error-state__actions">
          <p-button
            *ngIf="showRetry"
            [label]="retryLabel"
            icon="pi pi-refresh"
            (onClick)="onRetry()"
            severity="danger"
            [outlined]="true"
            [loading]="isRetrying"
          />
          <p-button
            *ngIf="showHome"
            label="Torna alla Home"
            icon="pi pi-home"
            (onClick)="onGoHome()"
            [text]="true"
            severity="secondary"
          />
          <p-button
            *ngIf="showSupport"
            label="Contatta il Supporto"
            icon="pi pi-question-circle"
            (onClick)="onContactSupport()"
            [text]="true"
            severity="secondary"
          />
        </div>

        <!-- Custom Content -->
        <div class="error-state__custom" *ngIf="customContent">
          <ng-content></ng-content>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .error-state {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 300px;
        padding: var(--spacing-2xl);
        text-align: center;
      }

      .error-state__content {
        max-width: 540px;
        width: 100%;
      }

      .error-state__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 80px;
        height: 80px;
        margin: 0 auto var(--spacing-lg);
        border-radius: var(--radius-full);
        background: var(--color-danger-bg);
        color: var(--color-danger);
      }

      .error-state__icon i {
        font-size: 2.5rem;
      }

      /* Variant-specific icon styles */
      .error-state--network .error-state__icon {
        background: var(--color-warning-bg);
        color: var(--color-warning);
      }

      .error-state--permission .error-state__icon {
        background: var(--color-info-bg);
        color: var(--color-info);
      }

      .error-state--404 .error-state__icon {
        background: var(--color-gray-100);
        color: var(--color-gray-500);
      }

      .error-state--500 .error-state__icon {
        background: var(--color-danger-bg);
        color: var(--color-danger);
      }

      .error-state__title {
        margin: 0 0 var(--spacing-sm) 0;
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
        line-height: var(--line-height-tight);
      }

      .error-state__message {
        margin: 0 0 var(--spacing-lg) 0;
        font-size: var(--font-size-base);
        color: var(--text-secondary);
        line-height: var(--line-height-relaxed);
      }

      .error-state__details {
        margin: 0 0 var(--spacing-lg) 0;
        text-align: left;
      }

      .error-state__details-toggle {
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
        cursor: pointer;
        padding: var(--spacing-sm);
        background: var(--color-gray-50);
        border-radius: var(--radius-sm);
        border: 1px solid var(--surface-border);
        user-select: none;
        transition: background var(--transition-fast);
      }

      .error-state__details-toggle:hover {
        background: var(--color-gray-100);
      }

      .error-state__details-toggle:focus-visible {
        outline: var(--focus-ring-width) solid var(--focus-ring-color);
        outline-offset: var(--focus-ring-offset);
      }

      .error-state__details-content {
        margin: var(--spacing-sm) 0 0 0;
        padding: var(--spacing-md);
        background: var(--color-gray-50);
        border-radius: var(--radius-sm);
        border: 1px solid var(--surface-border);
        font-size: var(--font-size-xs);
        font-family: var(--font-family-mono);
        color: var(--color-danger);
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .error-state__actions {
        display: flex;
        gap: var(--spacing-md);
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
      }

      .error-state__custom {
        margin-top: var(--spacing-lg);
      }

      /* Responsive Design */
      @media (max-width: 576px) {
        .error-state {
          min-height: 250px;
          padding: var(--spacing-xl) var(--spacing-md);
        }

        .error-state__icon {
          width: 64px;
          height: 64px;
          margin-bottom: var(--spacing-md);
        }

        .error-state__icon i {
          font-size: 2rem;
        }

        .error-state__title {
          font-size: var(--font-size-lg);
        }

        .error-state__message {
          font-size: var(--font-size-sm);
        }

        .error-state__actions {
          flex-direction: column;
          width: 100%;
        }

        .error-state__actions ::ng-deep .p-button {
          width: 100%;
          justify-content: center;
        }
      }

      /* Accessibility */
      @media (prefers-reduced-motion: reduce) {
        .error-state__icon,
        .error-state__details-toggle {
          transition: none;
        }
      }
    `,
  ],
})
export class ErrorStateComponent {
  /** Icon class (PrimeNG icon) - e.g., 'pi-exclamation-triangle', 'pi-times-circle' */
  @Input() icon = 'pi-exclamation-triangle'

  /** Custom icon CSS class for additional styling */
  @Input() iconClass = ''

  /** Error title */
  @Input() title = 'Si è verificato un errore'

  /** Error description message */
  @Input() message = 'Riprova più tardi o contatta il supporto se il problema persiste.'

  /**
   * Visual variant for different error types
   * - default: Generic error (red)
   * - network: Network/connection error (orange)
   * - permission: Permission/access error (blue)
   * - 404: Not found error (gray)
   * - 500: Server error (red)
   */
  @Input() variant: 'default' | 'network' | 'permission' | '404' | '500' = 'default'

  /** Show retry button */
  @Input() showRetry = true

  /** Retry button label */
  @Input() retryLabel = 'Riprova'

  /** Show retry loading state */
  @Input() isRetrying = false

  /** Show "Go to Home" button */
  @Input() showHome = false

  /** Show "Contact Support" button */
  @Input() showSupport = false

  /** Show technical error details (for debugging) */
  @Input() errorDetails = ''

  /** Show details section */
  @Input() showDetails = false

  /** Enable custom content projection */
  @Input() customContent = false

  /** Retry action event */
  @Output() retry = new EventEmitter<void>()

  /** Go home action event */
  @Output() goHome = new EventEmitter<void>()

  /** Contact support action event */
  @Output() contactSupport = new EventEmitter<void>()

  ngOnInit(): void {
    // Auto-configure based on variant
    if (this.variant === 'network') {
      this.icon = 'pi-wifi'
      this.title = 'Connessione non disponibile'
      this.message = 'Controlla la tua connessione internet e riprova.'
    } else if (this.variant === 'permission') {
      this.icon = 'pi-lock'
      this.title = 'Accesso negato'
      this.message = 'Non hai i permessi necessari per accedere a questa risorsa.'
      this.showRetry = false
      this.showHome = true
    } else if (this.variant === '404') {
      this.icon = 'pi-search'
      this.title = 'Pagina non trovata'
      this.message = 'La risorsa che stai cercando non esiste o è stata spostata.'
      this.showRetry = false
      this.showHome = true
    } else if (this.variant === '500') {
      this.icon = 'pi-server'
      this.title = 'Errore del server'
      this.message = 'Si è verificato un errore interno. Riprova più tardi.'
      this.showSupport = true
    }
  }

  onRetry(): void {
    this.retry.emit()
  }

  onGoHome(): void {
    this.goHome.emit()
  }

  onContactSupport(): void {
    this.contactSupport.emit()
  }
}
