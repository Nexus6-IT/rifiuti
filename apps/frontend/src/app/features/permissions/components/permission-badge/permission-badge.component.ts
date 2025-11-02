import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TooltipModule } from 'primeng/tooltip';
import { PermissionStore } from '../../../../core/state/permission.store';

/**
 * Permission state for visual indicators
 */
export type PermissionState = 'allowed' | 'view-only' | 'denied' | 'unknown';

/**
 * PermissionBadgeComponent
 * Visual indicator component for permission status
 * Per plan.md: Shows permission state with icons and colors
 *
 * Features:
 * - Visual indicators: ✓ allowed, ○ view-only, ✗ denied
 * - Color coding: green (allowed), blue (view-only), red (denied), gray (unknown)
 * - Tooltip with permission details
 * - Automatic permission checking via PermissionStore
 * - Configurable size and style
 *
 * T088: Permission badge with visual indicators
 */
@Component({
  selector: 'app-permission-badge',
  standalone: true,
  imports: [CommonModule, TooltipModule],
  template: `
    <span
      class="permission-badge"
      [class.allowed]="currentState === 'allowed'"
      [class.view-only]="currentState === 'view-only'"
      [class.denied]="currentState === 'denied'"
      [class.unknown]="currentState === 'unknown'"
      [class.small]="size === 'small'"
      [class.large]="size === 'large'"
      [pTooltip]="getTooltipText()"
      [tooltipPosition]="tooltipPosition">

      <!-- Symbol icons for mobile UX -->
      <span *ngIf="useSymbols" class="symbol-icon">{{ getIconClass() }}</span>

      <!-- PrimeNG icons (default) -->
      <i *ngIf="!useSymbols" [class]="getIconClass()"></i>

      <span class="badge-label" *ngIf="showLabel">
        {{ getLabelText() }}
      </span>
    </span>
  `,
  styles: [`
    .permission-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.75rem;
      border-radius: 4px;
      font-size: 0.875rem;
      font-weight: 500;
      transition: all 0.2s ease;
      cursor: default;
    }

    /* Size variations */
    .permission-badge.small {
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      gap: 0.25rem;
    }

    .permission-badge.small i {
      font-size: 0.75rem;
    }

    .permission-badge.large {
      padding: 0.5rem 1rem;
      font-size: 1rem;
      gap: 0.5rem;
    }

    .permission-badge.large i {
      font-size: 1.125rem;
    }

    /* State: Allowed (green) */
    .permission-badge.allowed {
      background-color: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }

    .permission-badge.allowed:hover {
      background-color: #c3e6cb;
    }

    .permission-badge.allowed i {
      color: #28a745;
    }

    /* State: View-Only (blue) */
    .permission-badge.view-only {
      background-color: #d1ecf1;
      color: #0c5460;
      border: 1px solid #bee5eb;
    }

    .permission-badge.view-only:hover {
      background-color: #bee5eb;
    }

    .permission-badge.view-only i {
      color: #17a2b8;
    }

    /* State: Denied (red) */
    .permission-badge.denied {
      background-color: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }

    .permission-badge.denied:hover {
      background-color: #f5c6cb;
    }

    .permission-badge.denied i {
      color: #dc3545;
    }

    /* State: Unknown (gray) */
    .permission-badge.unknown {
      background-color: #e9ecef;
      color: #6c757d;
      border: 1px solid #dee2e6;
    }

    .permission-badge.unknown:hover {
      background-color: #dee2e6;
    }

    .permission-badge.unknown i {
      color: #6c757d;
    }

    /* Icon styles */
    .permission-badge i {
      font-size: 0.875rem;
      font-weight: 700;
      line-height: 1;
    }

    /* Symbol icon styles (T128: ✓, ○, ✗) */
    .permission-badge .symbol-icon {
      font-size: 1.125rem;
      font-weight: 700;
      line-height: 1;
      font-family: Arial, sans-serif;
    }

    .permission-badge.small .symbol-icon {
      font-size: 0.875rem;
    }

    .permission-badge.large .symbol-icon {
      font-size: 1.5rem;
    }

    /* Label text */
    .badge-label {
      line-height: 1;
    }

    /* Animation */
    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.7;
      }
    }

    .permission-badge.checking {
      animation: pulse 1.5s ease-in-out infinite;
    }
  `]
})
export class PermissionBadgeComponent {
  private readonly permissionStore = inject(PermissionStore);

  /**
   * Permission string to check (e.g., 'fir:read:facility')
   */
  @Input({ required: true }) permission!: string;

  /**
   * Explicit state override (if not provided, auto-checks via PermissionStore)
   */
  @Input() state?: PermissionState;

  /**
   * Show text label alongside icon
   */
  @Input() showLabel: boolean = true;

  /**
   * Badge size
   */
  @Input() size: 'small' | 'normal' | 'large' = 'normal';

  /**
   * Tooltip position
   */
  @Input() tooltipPosition: 'top' | 'bottom' | 'left' | 'right' = 'top';

  /**
   * Custom label text (overrides default)
   */
  @Input() customLabel?: string;

  /**
   * Get current permission state
   */
  get currentState(): PermissionState {
    if (this.state) {
      return this.state;
    }

    // Auto-check permission via store
    const hasPermission = this.permissionStore.hasPermission()(this.permission);

    if (hasPermission) {
      // Check if it's a view-only permission (read action)
      const [, action] = this.permission.split(':');
      return action === 'read' ? 'view-only' : 'allowed';
    }

    return 'denied';
  }

  /**
   * Use symbol icons (✓, ○, ✗) instead of PrimeNG icons
   */
  @Input() useSymbols: boolean = false;

  /**
   * Get icon class or symbol based on state
   * T128: Support both PrimeNG icons and UX requirement symbols
   */
  getIconClass(): string {
    if (this.useSymbols) {
      // Return symbol directly (will be rendered as text)
      return this.getSymbolIcon();
    }

    // PrimeNG icons (default)
    switch (this.currentState) {
      case 'allowed':
        return 'pi pi-check-circle';
      case 'view-only':
        return 'pi pi-eye';
      case 'denied':
        return 'pi pi-times-circle';
      case 'unknown':
      default:
        return 'pi pi-question-circle';
    }
  }

  /**
   * Get symbol icon for mobile UX (per T128 requirements)
   */
  private getSymbolIcon(): string {
    switch (this.currentState) {
      case 'allowed':
        return '✓'; // Check mark (green)
      case 'view-only':
        return '○'; // Circle (blue)
      case 'denied':
        return '✗'; // Cross (gray)
      case 'unknown':
      default:
        return '?'; // Question mark
    }
  }

  /**
   * Get label text based on state
   */
  getLabelText(): string {
    if (this.customLabel) {
      return this.customLabel;
    }

    switch (this.currentState) {
      case 'allowed':
        return 'Allowed';
      case 'view-only':
        return 'View Only';
      case 'denied':
        return 'Denied';
      case 'unknown':
      default:
        return 'Unknown';
    }
  }

  /**
   * Get tooltip text with permission details
   */
  getTooltipText(): string {
    const [resource, action, scope] = this.permission.split(':');

    const stateDescription = {
      allowed: 'You have permission to perform this action',
      'view-only': 'You can view this resource but cannot modify it',
      denied: 'You do not have permission to perform this action',
      unknown: 'Permission status is unknown',
    }[this.currentState];

    return `
      ${stateDescription}

      Permission: ${this.permission}
      Resource: ${resource}
      Action: ${action}
      Scope: ${scope}
    `.trim();
  }
}

/**
 * Usage Examples:
 *
 * 1. Auto-check permission (recommended):
 * <app-permission-badge permission="fir:create:facility"></app-permission-badge>
 *
 * 2. Explicit state:
 * <app-permission-badge
 *   permission="fir:update:facility"
 *   [state]="'allowed'"
 *   [showLabel]="true">
 * </app-permission-badge>
 *
 * 3. Icon only (no label):
 * <app-permission-badge
 *   permission="fir:delete:facility"
 *   [showLabel]="false"
 *   size="small">
 * </app-permission-badge>
 *
 * 4. Custom label:
 * <app-permission-badge
 *   permission="fir:approve:facility"
 *   [customLabel]="'Can Approve'">
 * </app-permission-badge>
 *
 * 5. In a table:
 * <td>
 *   <app-permission-badge
 *     [permission]="action.requiredPermission"
 *     size="small">
 *   </app-permission-badge>
 * </td>
 *
 * 6. Permission list:
 * <div class="permissions-list">
 *   <app-permission-badge
 *     *ngFor="let perm of permissions"
 *     [permission]="perm"
 *     size="small">
 *   </app-permission-badge>
 * </div>
 */
