import { Component, Input, Output, EventEmitter } from '@angular/core'
import { CommonModule } from '@angular/common'
import { CardModule } from 'primeng/card'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { TooltipModule } from 'primeng/tooltip'
import { Role } from '../../../../core/state/role.store'

/**
 * RoleCardComponent
 * Reusable presentational component for displaying role information
 * Per plan.md: Visual component for role details with PrimeNG Card
 *
 * Features:
 * - Display role name, description, and type
 * - Show permission count and user count
 * - Visual distinction between system and custom roles
 * - Action buttons for assign/view operations
 * - Responsive card layout with PrimeNG
 *
 * T087: Presentational component with PrimeNG Card
 */
@Component({
  selector: 'app-role-card',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, TagModule, TooltipModule],
  template: `
    <p-card [styleClass]="'role-card ' + (role.isSystemRole ? 'system-role' : 'custom-role')">
      <ng-template pTemplate="header">
        <div class="card-header">
          <div class="role-name-section">
            <h3 class="role-name">{{ role.name }}</h3>
            <p-tag
              [value]="role.isSystemRole ? 'System' : 'Custom'"
              [severity]="role.isSystemRole ? 'info' : 'success'"
              styleClass="role-type-tag"
            ></p-tag>
          </div>
          <i
            *ngIf="role.isSystemRole"
            class="pi pi-lock system-icon"
            pTooltip="System role - cannot be modified or deleted"
          ></i>
        </div>
      </ng-template>

      <div class="card-content">
        <p class="role-description">
          {{ role.description || 'No description provided' }}
        </p>

        <div class="role-stats">
          <div class="stat-item">
            <i class="pi pi-shield stat-icon"></i>
            <span class="stat-label">Permissions:</span>
            <span class="stat-value">{{ role.permissions.length }}</span>
          </div>
          <div class="stat-item">
            <i class="pi pi-users stat-icon"></i>
            <span class="stat-label">Users:</span>
            <span class="stat-value">{{ userCount }}</span>
          </div>
        </div>

        <!-- Permission preview (first 3 permissions) -->
        <div class="permissions-preview" *ngIf="role.permissions.length > 0">
          <p class="preview-label">Key Permissions:</p>
          <div class="permissions-list">
            <p-tag
              *ngFor="let permission of getPreviewPermissions()"
              [value]="permission"
              severity="secondary"
              styleClass="permission-tag"
            ></p-tag>
            <p-tag
              *ngIf="role.permissions.length > 3"
              [value]="'+' + (role.permissions.length - 3) + ' more'"
              severity="secondary"
              styleClass="permission-tag more-tag"
            ></p-tag>
          </div>
        </div>

        <div class="no-permissions" *ngIf="role.permissions.length === 0">
          <i class="pi pi-info-circle"></i>
          <span>No permissions assigned</span>
        </div>
      </div>

      <ng-template pTemplate="footer">
        <div class="card-actions">
          <button
            pButton
            icon="pi pi-user-plus"
            label="Assign"
            class="p-button-sm p-button-success"
            (click)="onAssign.emit(role)"
            pTooltip="Assign this role to a user"
          ></button>
          <button
            pButton
            icon="pi pi-eye"
            label="View Details"
            class="p-button-sm p-button-outlined"
            (click)="onViewDetails.emit(role)"
            pTooltip="View role details and permissions"
          ></button>
          <button
            pButton
            icon="pi pi-users"
            label="Users"
            class="p-button-sm p-button-outlined"
            (click)="onViewUsers.emit(role)"
            pTooltip="View users with this role"
          ></button>
        </div>
      </ng-template>
    </p-card>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .role-card {
        height: 100%;
        display: flex;
        flex-direction: column;
        transition:
          box-shadow var(--transition-slow),
          transform var(--transition-base);
      }

      .role-card:hover {
        box-shadow: var(--shadow-md);
        transform: translateY(-2px);
      }

      .role-card.system-role {
        border-left: 4px solid var(--brand-accent);
      }

      .role-card.custom-role {
        border-left: 4px solid var(--color-success);
      }

      .card-header {
        padding: var(--spacing-lg) var(--spacing-lg) 0;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }

      .role-name-section {
        display: flex;
        align-items: center;
        gap: var(--spacing-md);
        flex: 1;
      }

      .role-name {
        margin: 0;
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }

      .role-type-tag {
        font-size: var(--font-size-xs);
        font-weight: var(--font-weight-semibold);
      }

      .system-icon {
        color: var(--brand-accent);
        font-size: var(--font-size-xl);
      }

      .card-content {
        padding: 0 var(--spacing-lg) var(--spacing-base);
        flex: 1;
      }

      .role-description {
        color: var(--text-secondary);
        margin: var(--spacing-md) 0 var(--spacing-lg);
        font-size: var(--font-size-sm);
        line-height: var(--line-height-normal);
        min-height: 2.85rem;
      }

      .role-stats {
        display: flex;
        gap: var(--spacing-lg);
        padding: var(--spacing-base) 0;
        border-top: 1px solid var(--surface-border);
        border-bottom: 1px solid var(--surface-border);
        margin-bottom: var(--spacing-base);
      }

      .stat-item {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: var(--font-size-sm);
      }

      .stat-icon {
        color: var(--brand-accent);
        font-size: var(--font-size-base);
      }

      .stat-label {
        color: var(--text-secondary);
        font-weight: var(--font-weight-medium);
      }

      .stat-value {
        color: var(--brand-accent-dark);
        font-weight: var(--font-weight-semibold);
        background: var(--color-info-bg);
        padding: 0.25rem 0.5rem;
        border-radius: var(--radius-sm);
      }

      .permissions-preview {
        margin-top: var(--spacing-base);
      }

      .preview-label {
        font-size: var(--font-size-sm);
        font-weight: var(--font-weight-semibold);
        color: var(--text-secondary);
        margin-bottom: var(--spacing-sm);
      }

      .permissions-list {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-sm);
      }

      .permission-tag {
        font-size: var(--font-size-xs);
        font-family: var(--font-family-mono);
      }

      .more-tag {
        font-style: italic;
      }

      .no-permissions {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        color: var(--text-secondary);
        font-style: italic;
        padding: var(--spacing-base);
        background: var(--color-gray-50);
        border-radius: var(--radius-sm);
        margin-top: var(--spacing-base);
      }

      .card-actions {
        padding: var(--spacing-base) var(--spacing-lg);
        display: flex;
        gap: var(--spacing-sm);
        flex-wrap: wrap;
        border-top: 1px solid var(--surface-border);
      }

      /* Responsive design */
      @media (max-width: 768px) {
        .card-actions {
          flex-direction: column;
        }

        .card-actions button {
          width: 100%;
        }

        .role-stats {
          flex-direction: column;
          gap: 0.75rem;
        }
      }

      /* PrimeNG overrides */
      :host ::ng-deep .p-card {
        height: 100%;
      }

      :host ::ng-deep .p-card-body {
        display: flex;
        flex-direction: column;
        height: 100%;
        padding: 0;
      }

      :host ::ng-deep .p-card-content {
        flex: 1;
        padding: 0;
      }

      :host ::ng-deep .p-card-footer {
        padding: 0;
      }
    `,
  ],
})
export class RoleCardComponent {
  /**
   * Role to display
   */
  @Input({ required: true }) role!: Role

  /**
   * Number of users with this role
   */
  @Input() userCount: number = 0

  /**
   * Emitted when user clicks "Assign" button
   */
  @Output() onAssign = new EventEmitter<Role>()

  /**
   * Emitted when user clicks "View Details" button
   */
  @Output() onViewDetails = new EventEmitter<Role>()

  /**
   * Emitted when user clicks "View Users" button
   */
  @Output() onViewUsers = new EventEmitter<Role>()

  /**
   * Get first 3 permissions for preview
   */
  getPreviewPermissions(): string[] {
    return this.role.permissions.slice(0, 3)
  }
}

/**
 * Usage Example:
 *
 * <div class="role-grid">
 *   <app-role-card
 *     *ngFor="let role of roles"
 *     [role]="role"
 *     [userCount]="getUserCount(role.id)"
 *     (onAssign)="openAssignDialog($event)"
 *     (onViewDetails)="showRoleDetails($event)"
 *     (onViewUsers)="viewUserAssignments($event)">
 *   </app-role-card>
 * </div>
 *
 * CSS for grid layout:
 * .role-grid {
 *   display: grid;
 *   grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
 *   gap: 1.5rem;
 *   padding: 1rem;
 * }
 */
