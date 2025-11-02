import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';

/**
 * Empty State Component
 *
 * A reusable component for displaying empty states with icons, messages, and actions.
 * Provides visual feedback when there's no data to display.
 *
 * @example
 * <!-- Basic empty state -->
 * <app-empty-state
 *   icon="pi-inbox"
 *   title="Nessun FIR trovato"
 *   message="Non ci sono FIR da visualizzare. Crea il tuo primo FIR per iniziare."
 *   actionLabel="Crea FIR"
 *   (action)="createFIR()"
 * />
 *
 * <!-- Empty search results -->
 * <app-empty-state
 *   icon="pi-search"
 *   title="Nessun risultato"
 *   message="Prova a modificare i filtri di ricerca."
 *   variant="search"
 * />
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  template: `
    <div class="empty-state" [ngClass]="'empty-state--' + variant" role="status" aria-live="polite">
      <div class="empty-state__content">
        <!-- Icon -->
        <div class="empty-state__icon" [ngClass]="iconClass">
          <i [class]="'pi ' + icon" aria-hidden="true"></i>
        </div>

        <!-- Title -->
        <h3 class="empty-state__title">{{ title }}</h3>

        <!-- Message -->
        <p class="empty-state__message" *ngIf="message">{{ message }}</p>

        <!-- Action Buttons -->
        <div class="empty-state__actions" *ngIf="actionLabel || secondaryActionLabel">
          <p-button
            *ngIf="actionLabel"
            [label]="actionLabel"
            [icon]="actionIcon"
            (onClick)="onAction()"
            [severity]="variant === 'error' ? 'danger' : 'primary'"
            [outlined]="actionOutlined"
          />
          <p-button
            *ngIf="secondaryActionLabel"
            [label]="secondaryActionLabel"
            [icon]="secondaryActionIcon"
            (onClick)="onSecondaryAction()"
            [text]="true"
            severity="secondary"
          />
        </div>

        <!-- Custom Content -->
        <div class="empty-state__custom" *ngIf="customContent">
          <ng-content></ng-content>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 300px;
      padding: var(--spacing-2xl, 2rem);
      text-align: center;
    }

    .empty-state__content {
      max-width: 480px;
      width: 100%;
    }

    .empty-state__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 80px;
      height: 80px;
      margin: 0 auto var(--spacing-lg, 1.5rem);
      border-radius: 50%;
      background: var(--gray-100, #f3f4f6);
      color: var(--gray-500, #6b7280);
    }

    .empty-state__icon i {
      font-size: 2.5rem;
    }

    /* Variant-specific icon styles */
    .empty-state--error .empty-state__icon {
      background: var(--error-bg, #fef2f2);
      color: var(--error-color, #dc2626);
    }

    .empty-state--success .empty-state__icon {
      background: var(--success-bg, #f0fdf4);
      color: var(--success-color, #16a34a);
    }

    .empty-state--warning .empty-state__icon {
      background: var(--warning-bg, #fffbeb);
      color: var(--warning-color, #f59e0b);
    }

    .empty-state--info .empty-state__icon {
      background: var(--info-bg, #eff6ff);
      color: var(--info-color, #3b82f6);
    }

    .empty-state--search .empty-state__icon {
      background: var(--brand-primary-light, #e8f5e9);
      color: var(--brand-primary, #2e7d32);
    }

    .empty-state__title {
      margin: 0 0 var(--spacing-sm, 0.75rem) 0;
      font-size: var(--font-size-xl, 1.25rem);
      font-weight: var(--font-weight-semibold, 600);
      color: var(--text-primary, #1f2937);
      line-height: 1.4;
    }

    .empty-state__message {
      margin: 0 0 var(--spacing-xl, 1.75rem) 0;
      font-size: var(--font-size-base, 1rem);
      color: var(--text-secondary, #6b7280);
      line-height: 1.6;
    }

    .empty-state__actions {
      display: flex;
      gap: var(--spacing-md, 1rem);
      justify-content: center;
      align-items: center;
      flex-wrap: wrap;
    }

    .empty-state__custom {
      margin-top: var(--spacing-lg, 1.5rem);
    }

    /* Responsive Design */
    @media (max-width: 576px) {
      .empty-state {
        min-height: 250px;
        padding: var(--spacing-xl, 1.75rem) var(--spacing-md, 1rem);
      }

      .empty-state__icon {
        width: 64px;
        height: 64px;
        margin-bottom: var(--spacing-md, 1rem);
      }

      .empty-state__icon i {
        font-size: 2rem;
      }

      .empty-state__title {
        font-size: var(--font-size-lg, 1.125rem);
      }

      .empty-state__message {
        font-size: var(--font-size-sm, 0.875rem);
      }

      .empty-state__actions {
        flex-direction: column;
        width: 100%;
      }

      .empty-state__actions ::ng-deep .p-button {
        width: 100%;
        justify-content: center;
      }
    }

    /* Accessibility */
    @media (prefers-reduced-motion: reduce) {
      .empty-state__icon {
        transition: none;
      }
    }
  `]
})
export class EmptyStateComponent {
  /** Icon class (PrimeNG icon) - e.g., 'pi-inbox', 'pi-search', 'pi-exclamation-triangle' */
  @Input() icon = 'pi-inbox';

  /** Custom icon CSS class for additional styling */
  @Input() iconClass = '';

  /** Title text */
  @Input() title = 'Nessun dato disponibile';

  /** Description message */
  @Input() message = '';

  /**
   * Visual variant for different contexts
   * - default: Standard empty state (gray)
   * - error: Error state (red)
   * - success: Success state (green)
   * - warning: Warning state (yellow)
   * - info: Informational state (blue)
   * - search: Search-specific state (brand color)
   */
  @Input() variant: 'default' | 'error' | 'success' | 'warning' | 'info' | 'search' = 'default';

  /** Primary action button label */
  @Input() actionLabel = '';

  /** Primary action button icon */
  @Input() actionIcon = '';

  /** Make primary action button outlined */
  @Input() actionOutlined = false;

  /** Secondary action button label */
  @Input() secondaryActionLabel = '';

  /** Secondary action button icon */
  @Input() secondaryActionIcon = '';

  /** Enable custom content projection */
  @Input() customContent = false;

  /** Primary action event */
  @Output() action = new EventEmitter<void>();

  /** Secondary action event */
  @Output() secondaryAction = new EventEmitter<void>();

  onAction(): void {
    this.action.emit();
  }

  onSecondaryAction(): void {
    this.secondaryAction.emit();
  }
}
