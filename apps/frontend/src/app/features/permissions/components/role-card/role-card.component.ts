import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { Role } from '../../../../core/state/role.store';

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
  imports: [
    CommonModule,
    CardModule,
    ButtonModule,
    TagModule,
    TooltipModule,
  ],
  template: `
    <p-card [styleClass]="'role-card ' + (role.isSystemRole ? 'system-role' : 'custom-role')">
      <ng-template pTemplate="header">
        <div class="card-header">
          <div class="role-name-section">
            <h3 class="role-name">{{ role.name }}</h3>
            <p-tag
              [value]="role.isSystemRole ? 'System' : 'Custom'"
              [severity]="role.isSystemRole ? 'info' : 'success'"
              styleClass="role-type-tag"></p-tag>
          </div>
          <i
            *ngIf="role.isSystemRole"
            class="pi pi-lock system-icon"
            pTooltip="System role - cannot be modified or deleted"></i>
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
              styleClass="permission-tag"></p-tag>
            <p-tag
              *ngIf="role.permissions.length > 3"
              [value]="'+' + (role.permissions.length - 3) + ' more'"
              severity="secondary"
              styleClass="permission-tag more-tag"></p-tag>
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
            pTooltip="Assign this role to a user"></button>
          <button
            pButton
            icon="pi pi-eye"
            label="View Details"
            class="p-button-sm p-button-outlined"
            (click)="onViewDetails.emit(role)"
            pTooltip="View role details and permissions"></button>
          <button
            pButton
            icon="pi pi-users"
            label="Users"
            class="p-button-sm p-button-outlined"
            (click)="onViewUsers.emit(role)"
            pTooltip="View users with this role"></button>
        </div>
      </ng-template>
    </p-card>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }

    .role-card {
      height: 100%;
      display: flex;
      flex-direction: column;
      transition: box-shadow 0.3s ease, transform 0.2s ease;
    }

    .role-card:hover {
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transform: translateY(-2px);
    }

    .role-card.system-role {
      border-left: 4px solid #1976d2;
    }

    .role-card.custom-role {
      border-left: 4px solid #4caf50;
    }

    .card-header {
      padding: 1.5rem 1.5rem 0;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .role-name-section {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex: 1;
    }

    .role-name {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: #2c3e50;
    }

    .role-type-tag {
      font-size: 0.75rem;
      font-weight: 600;
    }

    .system-icon {
      color: #1976d2;
      font-size: 1.25rem;
    }

    .card-content {
      padding: 0 1.5rem 1rem;
      flex: 1;
    }

    .role-description {
      color: #6c757d;
      margin: 0.75rem 0 1.25rem;
      font-size: 0.95rem;
      line-height: 1.5;
      min-height: 2.85rem;
    }

    .role-stats {
      display: flex;
      gap: 1.5rem;
      padding: 1rem 0;
      border-top: 1px solid #e9ecef;
      border-bottom: 1px solid #e9ecef;
      margin-bottom: 1rem;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
    }

    .stat-icon {
      color: #1976d2;
      font-size: 1rem;
    }

    .stat-label {
      color: #6c757d;
      font-weight: 500;
    }

    .stat-value {
      color: #2c3e50;
      font-weight: 600;
      background: #e3f2fd;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
    }

    .permissions-preview {
      margin-top: 1rem;
    }

    .preview-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: #6c757d;
      margin-bottom: 0.5rem;
    }

    .permissions-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .permission-tag {
      font-size: 0.75rem;
      font-family: 'Courier New', monospace;
    }

    .more-tag {
      font-style: italic;
    }

    .no-permissions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #6c757d;
      font-style: italic;
      padding: 1rem;
      background: #f8f9fa;
      border-radius: 4px;
      margin-top: 1rem;
    }

    .card-actions {
      padding: 1rem 1.5rem;
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      border-top: 1px solid #e9ecef;
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
  `]
})
export class RoleCardComponent {
  /**
   * Role to display
   */
  @Input({ required: true }) role!: Role;

  /**
   * Number of users with this role
   */
  @Input() userCount: number = 0;

  /**
   * Emitted when user clicks "Assign" button
   */
  @Output() onAssign = new EventEmitter<Role>();

  /**
   * Emitted when user clicks "View Details" button
   */
  @Output() onViewDetails = new EventEmitter<Role>();

  /**
   * Emitted when user clicks "View Users" button
   */
  @Output() onViewUsers = new EventEmitter<Role>();

  /**
   * Get first 3 permissions for preview
   */
  getPreviewPermissions(): string[] {
    return this.role.permissions.slice(0, 3);
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
