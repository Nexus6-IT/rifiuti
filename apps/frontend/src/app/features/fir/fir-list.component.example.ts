import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HasPermissionDirective } from '../permissions/directives/has-permission.directive';
import { RequirePermissionDirective } from '../permissions/directives/require-permission.directive';

/**
 * FIR List Component Example
 * Demonstrates integration of permission directives with existing FIR components
 * Per plan.md FR-001: UI elements show/hide based on user permissions
 *
 * T093: Integration example showing *hasPermission usage
 */
@Component({
  selector: 'app-fir-list-example',
  standalone: true,
  imports: [CommonModule, HasPermissionDirective, RequirePermissionDirective],
  template: `
    <div class="fir-list-page">
      <h1>FIR Documents</h1>

      <!-- Create button - only show if user has create permission -->
      <div *hasPermission="'fir:create:facility'">
        <button class="btn-primary">Create New FIR</button>
      </div>

      <!-- Bulk actions - require manage permission -->
      <div *hasPermission="'fir:manage:all'">
        <h2>Bulk Actions</h2>
        <button>Export Selected</button>
        <button>Delete Selected</button>
      </div>

      <!-- FIR table -->
      <table class="fir-table">
        <thead>
          <tr>
            <th>FIR ID</th>
            <th>Status</th>
            <th>Created Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let fir of firs">
            <td>{{ fir.id }}</td>
            <td>{{ fir.status }}</td>
            <td>{{ fir.createdAt | date }}</td>
            <td>
              <!-- View button - always visible with read permission -->
              <button
                *hasPermission="'fir:read:facility'"
                class="btn-view">
                View
              </button>

              <!-- Edit button - only if user has update permission -->
              <button
                *hasPermission="'fir:update:facility'"
                class="btn-edit">
                Edit
              </button>

              <!-- Delete button - requires delete permission -->
              <!-- This will be disabled if user lacks permission -->
              <button
                [requirePermission]="'fir:delete:facility'"
                class="btn-delete">
                Delete
              </button>

              <!-- Approve button - high-risk operation -->
              <!-- Requires approve permission + SPID step-up -->
              <button
                *hasPermission="'fir:approve:facility'"
                class="btn-approve">
                Approve
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Admin section - only visible to admins -->
      <div *hasPermission="'fir:manage:all'">
        <h2>Admin Actions</h2>
        <button>Configure Workflow</button>
        <button>Manage Templates</button>
      </div>

      <!-- Multi-permission example - show if user has ANY permission -->
      <div *hasPermission="['fir:update:facility', 'fir:delete:facility']">
        <p>You can modify FIR documents</p>
      </div>

      <!-- Multi-permission example - show if user has ALL permissions -->
      <div *hasPermission="['fir:create:facility', 'fir:approve:facility']; requireAll: true">
        <p>You can both create and approve FIR documents</p>
      </div>

      <!-- Include temporary permissions -->
      <div *hasPermission="'fir:delete:facility'; includeTemp: true">
        <p class="temp-permission-notice">
          You have temporary delete permission
        </p>
      </div>
    </div>
  `,
  styles: [`
    .fir-list-page {
      padding: var(--spacing-xl);
    }

    .btn-primary {
      background: var(--brand-primary);
      color: var(--text-inverse);
      padding: 0 1rem;
      height: var(--control-md);
      border: none;
      border-radius: var(--radius-md);
      cursor: pointer;
      margin-bottom: var(--spacing-base);
      font-weight: var(--font-weight-semibold);
    }

    .fir-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: var(--spacing-base);
    }

    .fir-table th,
    .fir-table td {
      padding: var(--spacing-md);
      text-align: left;
      border-bottom: 1px solid var(--surface-border);
    }

    .btn-view,
    .btn-edit,
    .btn-delete,
    .btn-approve {
      margin-right: var(--spacing-sm);
      padding: 0 0.75rem;
      height: var(--control-sm);
      border: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-weight: var(--font-weight-medium);
    }

    .btn-view { background: var(--color-info-bg); color: var(--color-info); }
    .btn-edit { background: var(--color-warning-bg); color: var(--color-warning); }
    .btn-delete { background: var(--color-danger-bg); color: var(--color-danger); }
    .btn-approve { background: var(--color-success-bg); color: var(--color-success); }

    .btn-view:disabled,
    .btn-edit:disabled,
    .btn-delete:disabled,
    .btn-approve:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .temp-permission-notice {
      background: var(--color-warning-bg);
      color: var(--color-warning);
      padding: var(--spacing-sm) var(--spacing-base);
      border-left: 3px solid var(--color-warning);
      margin-top: var(--spacing-base);
      border-radius: var(--radius-sm);
    }
  `]
})
export class FirListComponentExample {
  // Mock data for demonstration
  firs = [
    { id: 'FIR-001', status: 'Draft', createdAt: new Date() },
    { id: 'FIR-002', status: 'Submitted', createdAt: new Date() },
    { id: 'FIR-003', status: 'Approved', createdAt: new Date() },
  ];
}

/**
 * Integration Patterns:
 *
 * 1. Structural Directive (*hasPermission):
 *    - Completely removes element from DOM if user lacks permission
 *    - Best for: navigation items, entire sections, action buttons
 *    - Syntax: *hasPermission="'permission:string'"
 *
 * 2. Attribute Directive ([requirePermission]):
 *    - Disables element but keeps it visible
 *    - Best for: buttons, form fields, links
 *    - Adds visual feedback (grayed out) and tooltip explaining why disabled
 *    - Syntax: [requirePermission]="'permission:string'"
 *
 * 3. Permission Tooltip:
 *    - Automatically shows helpful message when user hovers disabled element
 *    - Format: "Insufficient permissions. Your role: X. Required: Y. Contact admin."
 *
 * 4. Scope Hierarchy:
 *    - User with "fir:read:all" can see *hasPermission="'fir:read:facility'"
 *    - User with "fir:read:facility" CANNOT see *hasPermission="'fir:read:all'"
 *
 * 5. Best Practices:
 *    - Always use *hasPermission for create/delete actions
 *    - Use [requirePermission] for edit actions (show disabled state)
 *    - Combine directives with backend PermissionGuard for security
 *    - Never rely solely on frontend permission checks for security
 */
