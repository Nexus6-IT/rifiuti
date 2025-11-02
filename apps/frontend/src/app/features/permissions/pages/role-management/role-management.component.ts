import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RoleStore, Role, UserRoleAssignment } from '../../../../core/state/role.store';
import { RoleApiService } from '../../services/role-api.service';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { DropdownModule } from 'primeng/dropdown';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { InputTextModule } from 'primeng/inputtext';
import { CalendarModule } from 'primeng/calendar';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmationService, MessageService } from 'primeng/api';

/**
 * RoleManagementComponent
 * Full-featured page component for managing roles and role assignments
 * Per plan.md User Story 1: Admin assigns roles to team members
 *
 * Features:
 * - PrimeNG DataTable with expandable rows for role permissions
 * - Role assignment dialog with user selection and expiration
 * - View active role assignments by user
 * - Revoke role assignments with confirmation
 * - Visual distinction between system and custom roles
 *
 * T085: Full PrimeNG implementation with CRUD operations
 */
@Component({
  selector: 'app-role-management',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    DialogModule,
    DropdownModule,
    CardModule,
    TagModule,
    TooltipModule,
    ConfirmDialogModule,
    ToastModule,
    InputTextModule,
    CalendarModule,
    CheckboxModule,
  ],
  providers: [ConfirmationService, MessageService],
  template: `
    <div class="role-management-page">
      <div class="page-header">
        <h1>Role Management</h1>
        <p class="subtitle">Assign roles to users and manage permissions</p>
      </div>

      <!-- Roles Table -->
      <p-card header="Available Roles" styleClass="mb-4">
        <p-table
          #dt
          [value]="roleStore.roles()"
          [loading]="roleStore.isLoading()"
          [paginator]="true"
          [rows]="10"
          [rowsPerPageOptions]="[10, 25, 50]"
          [globalFilterFields]="['name', 'description']"
          dataKey="id"
          styleClass="p-datatable-sm">

          <ng-template pTemplate="caption">
            <div class="flex justify-content-between align-items-center">
              <span class="p-input-icon-left">
                <i class="pi pi-search"></i>
                <input
                  pInputText
                  type="text"
                  #searchInput
                  (input)="dt.filterGlobal($any($event.target).value, 'contains')"
                  placeholder="Search roles..." />
              </span>
              <button
                pButton
                icon="pi pi-refresh"
                class="p-button-outlined"
                (click)="refreshRoles()"
                label="Refresh"></button>
            </div>
          </ng-template>

          <ng-template pTemplate="header">
            <tr>
              <th style="width: 3rem"></th>
              <th pSortableColumn="name">
                Role Name <p-sortIcon field="name"></p-sortIcon>
              </th>
              <th>Description</th>
              <th style="width: 8rem">Type</th>
              <th style="width: 8rem">Users</th>
              <th style="width: 12rem">Actions</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-role let-expanded="expanded">
            <tr>
              <td>
                <button
                  type="button"
                  pButton
                  pRipple
                  [pRowToggler]="role"
                  class="p-button-text p-button-rounded p-button-plain"
                  [icon]="expanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"></button>
              </td>
              <td>
                <strong>{{ role.name }}</strong>
              </td>
              <td>{{ role.description || 'No description' }}</td>
              <td>
                <p-tag
                  [value]="role.isSystemRole ? 'System' : 'Custom'"
                  [severity]="role.isSystemRole ? 'info' : 'success'"></p-tag>
              </td>
              <td>
                <span class="user-count">{{ getUserCount(role.id) }}</span>
              </td>
              <td>
                <button
                  pButton
                  icon="pi pi-user-plus"
                  class="p-button-sm p-button-success mr-2"
                  (click)="openAssignDialog(role)"
                  label="Assign"
                  pTooltip="Assign this role to a user"></button>
                <button
                  pButton
                  icon="pi pi-users"
                  class="p-button-sm p-button-outlined mr-2"
                  (click)="viewUserAssignments(role)"
                  pTooltip="View users with this role"></button>

                <!-- T179: Delete custom role with validation -->
                @if (!role.isSystemRole) {
                  <button
                    pButton
                    icon="pi pi-trash"
                    class="p-button-sm p-button-danger p-button-outlined"
                    (click)="confirmDeleteRole(role)"
                    [disabled]="getUserCount(role.id) > 0"
                    [pTooltip]="getUserCount(role.id) > 0 ? 'Cannot delete: ' + getUserCount(role.id) + ' user(s) assigned' : 'Delete custom role'"></button>
                }
            </tr>
          </ng-template>

          <ng-template pTemplate="rowexpansion" let-role>
            <tr>
              <td colspan="6">
                <div class="p-3">
                  <h3>Permissions for {{ role.name }}</h3>
                  <div class="permissions-grid">
                    <p-tag
                      *ngFor="let permission of role.permissions"
                      [value]="permission"
                      severity="secondary"
                      styleClass="mr-2 mb-2"></p-tag>
                  </div>
                  <div *ngIf="role.permissions.length === 0" class="text-muted">
                    No permissions assigned to this role
                  </div>
                </div>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="6">No roles found</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- User Role Assignments Section -->
      <p-card header="Active Role Assignments" *ngIf="selectedRole()" styleClass="mb-4">
        <p-table
          [value]="currentUserAssignments()"
          [loading]="isLoadingAssignments()"
          styleClass="p-datatable-sm">

          <ng-template pTemplate="header">
            <tr>
              <th>User ID</th>
              <th>Role</th>
              <th>Assigned By</th>
              <th>Assigned At</th>
              <th>Expires At</th>
              <th>Facility Scoped</th>
              <th style="width: 8rem">Actions</th>
            </tr>
          </ng-template>

          <ng-template pTemplate="body" let-assignment>
            <tr>
              <td>{{ assignment.userId }}</td>
              <td>
                <p-tag [value]="assignment.roleName" severity="info"></p-tag>
              </td>
              <td>{{ assignment.assignedBy }}</td>
              <td>{{ assignment.assignedAt | date: 'short' }}</td>
              <td>
                <span *ngIf="assignment.expiresAt">
                  {{ assignment.expiresAt | date: 'short' }}
                </span>
                <span *ngIf="!assignment.expiresAt" class="text-muted">
                  Never
                </span>
              </td>
              <td>
                <i
                  [class]="assignment.facilityIds ? 'pi pi-check text-success' : 'pi pi-times text-muted'"
                  pTooltip="{{ assignment.facilityIds ? 'Scoped to specific facilities' : 'All facilities' }}"></i>
              </td>
              <td>
                <button
                  pButton
                  icon="pi pi-trash"
                  class="p-button-sm p-button-danger p-button-outlined"
                  (click)="confirmRevokeRole(assignment)"
                  label="Revoke"></button>
              </td>
            </tr>
          </ng-template>

          <ng-template pTemplate="emptymessage">
            <tr>
              <td colspan="7">No active assignments for this role</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>

      <!-- Assign Role Dialog -->
      <p-dialog
        [(visible)]="showAssignDialog"
        [header]="'Assign Role: ' + selectedRoleForAssignment()?.name"
        [modal]="true"
        [style]="{ width: '600px' }"
        [draggable]="false">

        <div class="field">
          <label for="userId">User ID *</label>
          <input
            id="userId"
            type="text"
            pInputText
            [(ngModel)]="assignmentForm.userId"
            class="w-full"
            placeholder="Enter user ID" />
        </div>

        <div class="field">
          <label for="expiresAt">Expiration Date (Optional)</label>
          <p-calendar
            id="expiresAt"
            [(ngModel)]="assignmentForm.expiresAt"
            [showTime]="true"
            [showIcon]="true"
            dateFormat="yy-mm-dd"
            class="w-full"
            placeholder="No expiration"></p-calendar>
        </div>

        <div class="field">
          <label for="facilityIds">Facility IDs (Optional, comma-separated)</label>
          <input
            id="facilityIds"
            type="text"
            pInputText
            [(ngModel)]="assignmentForm.facilityIdsInput"
            class="w-full"
            placeholder="e.g., fac-1, fac-2" />
          <small class="text-muted">
            Leave empty to grant access to all facilities
          </small>
        </div>

        <div class="field-checkbox">
          <p-checkbox
            [(ngModel)]="assignmentForm.replaceExisting"
            [binary]="true"
            inputId="replaceExisting"></p-checkbox>
          <label for="replaceExisting">
            Replace user's existing role assignments
          </label>
        </div>

        <ng-template pTemplate="footer">
          <button
            pButton
            label="Cancel"
            icon="pi pi-times"
            class="p-button-text"
            (click)="showAssignDialog = false"></button>
          <button
            pButton
            label="Assign Role"
            icon="pi pi-check"
            class="p-button-success"
            (click)="assignRole()"
            [loading]="isAssigning()"></button>
        </ng-template>
      </p-dialog>

      <!-- Toast for notifications -->
      <p-toast></p-toast>

      <!-- Confirmation Dialog -->
      <p-confirmDialog></p-confirmDialog>
    </div>
  `,
  styles: [`
    .role-management-page {
      padding: 2rem;
    }

    .page-header {
      margin-bottom: 2rem;
    }

    .subtitle {
      color: #6c757d;
      margin-top: 0.5rem;
    }

    .permissions-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 1rem;
    }

    .user-count {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 2rem;
      height: 2rem;
      padding: 0 0.5rem;
      background: #e3f2fd;
      color: #1976d2;
      border-radius: 1rem;
      font-weight: 600;
      font-size: 0.875rem;
    }

    .field {
      margin-bottom: 1.5rem;
    }

    .field label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 500;
    }

    .field-checkbox {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }

    .text-muted {
      color: #6c757d;
    }

    .text-success {
      color: #28a745;
    }

    :host ::ng-deep .p-datatable .p-datatable-tbody > tr > td {
      padding: 0.75rem;
    }

    :host ::ng-deep .p-card {
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    :host ::ng-deep .p-card .p-card-header {
      font-size: 1.25rem;
      font-weight: 600;
    }
  `]
})
export class RoleManagementComponent implements OnInit {
  protected readonly roleStore = inject(RoleStore);
  private readonly roleApiService = inject(RoleApiService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  // Dialog state
  showAssignDialog = false;
  selectedRole = signal<Role | null>(null);
  selectedRoleForAssignment = signal<Role | null>(null);
  currentUserAssignments = signal<UserRoleAssignment[]>([]);
  isLoadingAssignments = signal(false);
  isAssigning = signal(false);

  // Assignment form
  assignmentForm = {
    userId: '',
    expiresAt: null as Date | null,
    facilityIdsInput: '',
    replaceExisting: false,
  };

  ngOnInit(): void {
    // Load roles on component init
    this.roleStore.loadRoles();
  }

  /**
   * Refresh roles from backend
   */
  refreshRoles(): void {
    this.roleStore.loadRoles();
    this.messageService.add({
      severity: 'info',
      summary: 'Refreshing',
      detail: 'Loading latest roles...',
    });
  }

  /**
   * Get count of users assigned to a role
   */
  getUserCount(roleId: string): number {
    return this.roleStore
      .userRoles()
      .filter((ur) => ur.roleId === roleId).length;
  }

  /**
   * Open assignment dialog for a role
   */
  openAssignDialog(role: Role): void {
    this.selectedRoleForAssignment.set(role);
    this.resetAssignmentForm();
    this.showAssignDialog = true;
  }

  /**
   * View users with this role
   */
  viewUserAssignments(role: Role): void {
    this.selectedRole.set(role);
    this.isLoadingAssignments.set(true);

    // Filter current role assignments
    const assignments = this.roleStore
      .userRoles()
      .filter((ur) => ur.roleId === role.id);

    this.currentUserAssignments.set(assignments);
    this.isLoadingAssignments.set(false);

    this.messageService.add({
      severity: 'info',
      summary: 'Viewing Assignments',
      detail: `Found ${assignments.length} user(s) with ${role.name} role`,
    });
  }

  /**
   * Assign role to user
   */
  assignRole(): void {
    if (!this.assignmentForm.userId.trim()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Validation Error',
        detail: 'User ID is required',
      });
      return;
    }

    const role = this.selectedRoleForAssignment();
    if (!role) return;

    this.isAssigning.set(true);

    // Parse facility IDs
    const facilityIds = this.assignmentForm.facilityIdsInput
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    const payload = {
      userId: this.assignmentForm.userId,
      roleId: role.id,
      expiresAt: this.assignmentForm.expiresAt?.toISOString() || undefined,
      facilityIds: facilityIds.length > 0 ? facilityIds : undefined,
      replaceExisting: this.assignmentForm.replaceExisting,
    };

    this.roleApiService.assignRole(payload).subscribe({
      next: (response) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Role Assigned',
          detail: `Successfully assigned ${role.name} to user ${this.assignmentForm.userId}`,
        });

        // Optimistically add to store - enrich with roleName
        const enrichedAssignment: UserRoleAssignment = {
          ...response,
          roleName: role.name,
        };
        this.roleStore.addUserRole(enrichedAssignment);

        this.showAssignDialog = false;
        this.isAssigning.set(false);
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Assignment Failed',
          detail: error.error?.message || 'Failed to assign role',
        });
        this.isAssigning.set(false);
      },
    });
  }

  /**
   * Confirm revoke role with user
   */
  confirmRevokeRole(assignment: UserRoleAssignment): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to revoke ${assignment.roleName} from user ${assignment.userId}?`,
      header: 'Confirm Revocation',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.revokeRole(assignment);
      },
    });
  }

  /**
   * Revoke role assignment
   */
  revokeRole(assignment: UserRoleAssignment): void {
    this.roleApiService.revokeRole(assignment.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Role Revoked',
          detail: `Successfully revoked ${assignment.roleName} from user ${assignment.userId}`,
        });

        // Optimistically remove from store
        this.roleStore.removeUserRole(assignment.id);

        // Refresh assignments view
        const currentRole = this.selectedRole();
        if (currentRole) {
          this.viewUserAssignments(currentRole);
        }
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Revocation Failed',
          detail: error.error?.message || 'Failed to revoke role',
        });
      },
    });
  }

  /**
   * Reset assignment form
   */
  private resetAssignmentForm(): void {
    this.assignmentForm = {
      userId: '',
      expiresAt: null,
      facilityIdsInput: '',
      replaceExisting: false,
    };
  }

  /**
   * T179: Confirm delete custom role with validation
   * Per spec.md FR-011 acceptance scenario 5:
   * "Attempts to delete role assigned to users, prevented with error message"
   */
  confirmDeleteRole(role: Role): void {
    // Check if role has users assigned
    const userCount = this.getUserCount(role.id);

    if (userCount > 0) {
      this.messageService.add({
        severity: 'error',
        summary: 'Cannot Delete Role',
        detail: `Cannot delete role "${role.name}" because it is assigned to ${userCount} user(s). Remove all user assignments before deleting this role.`,
        life: 5000,
      });
      return;
    }

    // Prevent deleting system roles
    if (role.isSystemRole) {
      this.messageService.add({
        severity: 'error',
        summary: 'Cannot Delete Role',
        detail: 'System roles cannot be deleted.',
        life: 3000,
      });
      return;
    }

    // Confirm deletion
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the custom role "${role.name}"? This action cannot be undone.`,
      header: 'Confirm Deletion',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      accept: () => {
        this.deleteRole(role);
      },
    });
  }

  /**
   * Delete custom role
   */
  private deleteRole(role: Role): void {
    this.roleApiService.deleteRole(role.id).subscribe({
      next: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Role Deleted',
          detail: `Successfully deleted role "${role.name}"`,
        });

        // Refresh roles list
        this.roleStore.loadRoles();
      },
      error: (error) => {
        // Backend might return error if role has users (additional safety check)
        const errorMessage = error.error?.message || error.message || 'Failed to delete role';

        if (errorMessage.includes('assigned to') || errorMessage.includes('user')) {
          this.messageService.add({
            severity: 'error',
            summary: 'Cannot Delete Role',
            detail: errorMessage,
            life: 5000,
          });
        } else {
          this.messageService.add({
            severity: 'error',
            summary: 'Deletion Failed',
            detail: errorMessage,
          });
        }
      },
    });
  }
}
