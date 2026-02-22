import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputTextareaModule } from 'primeng/inputtextarea';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmationService, MessageService } from 'primeng/api';
import { PermissionMatrixComponent } from '../../components/permission-matrix/permission-matrix.component';
import { RoleApiService } from '../../services/role-api.service';

/**
 * CustomRoleBuilderComponent
 * Page for creating and editing custom roles
 * T175: Custom role builder page per User Story 5
 *
 * Purpose: Provide UI for enterprise clients to create custom roles
 *
 * Requirements from spec.md FR-011:
 * - Create/edit custom roles with name, description, permissions
 * - Visual permission matrix for selection
 * - Preview permissions before saving
 * - Validate role before creation
 *
 * Requirements from plan.md:
 * - Support creating roles with up to 100 permissions
 * - Real-time validation feedback
 * - Prevent using system role names
 */
@Component({
  selector: 'app-custom-role-builder',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    InputTextareaModule,
    MessageModule,
    ProgressSpinnerModule,
    DialogModule,
    ConfirmDialogModule,
    PermissionMatrixComponent,
  ],
  providers: [ConfirmationService, MessageService],
  template: `
    <div class="custom-role-builder">
      <!-- Header -->
      <div class="page-header">
        <button
          pButton
          type="button"
          icon="pi pi-arrow-left"
          class="p-button-text"
          (click)="goBack()"
        ></button>

        <div class="header-content">
          <h1>{{ isEditMode() ? 'Edit Custom Role' : 'Create Custom Role' }}</h1>
          <p class="header-subtitle">
            {{ isEditMode() ? 'Modify role properties and permissions' : 'Design a custom role with specific permissions for your organization' }}
          </p>
        </div>
      </div>

      <!-- Loading State -->
      @if (isLoading()) {
        <div class="loading-container">
          <p-progressSpinner></p-progressSpinner>
          <p>Loading role...</p>
        </div>
      }

      <!-- Error State -->
      @if (error()) {
        <p-message severity="error" [text]="error()!"></p-message>
      }

      <!-- Form -->
      @if (!isLoading()) {
        <form [formGroup]="roleForm" (ngSubmit)="onSubmit()">
          <!-- Basic Information -->
          <p-card header="Basic Information" styleClass="form-section">
            <div class="form-grid">
              <div class="form-field">
                <label for="name">Role Name *</label>
                <input
                  pInputText
                  id="name"
                  formControlName="name"
                  placeholder="e.g., Regional Manager"
                  [class.ng-invalid]="roleForm.get('name')?.invalid && roleForm.get('name')?.touched"
                />
                @if (roleForm.get('name')?.hasError('required') && roleForm.get('name')?.touched) {
                  <small class="p-error">Role name is required</small>
                }
                @if (roleForm.get('name')?.hasError('maxlength')) {
                  <small class="p-error">Role name must be 100 characters or less</small>
                }
                @if (roleForm.get('name')?.hasError('systemRole')) {
                  <small class="p-error">Cannot use system role names (ADMIN, OPERATOR, etc.)</small>
                }
              </div>

              <div class="form-field full-width">
                <label for="description">Description</label>
                <textarea
                  pInputTextarea
                  id="description"
                  formControlName="description"
                  rows="3"
                  placeholder="Describe the purpose and responsibilities of this role..."
                  [class.ng-invalid]="roleForm.get('description')?.invalid && roleForm.get('description')?.touched"
                ></textarea>
                @if (roleForm.get('description')?.hasError('maxlength')) {
                  <small class="p-error">Description must be 500 characters or less</small>
                }
              </div>
            </div>
          </p-card>

          <!-- Permission Selection -->
          <p-card header="Permissions" styleClass="form-section">
            <div class="permissions-header">
              <p>Select the permissions for this role. At least 1 permission is required, maximum 100.</p>
              <div class="permission-count">
                <span [class.error]="selectedPermissions().length === 0 || selectedPermissions().length > 100">
                  {{ selectedPermissions().length }} / 100 selected
                </span>
              </div>
            </div>

            @if (selectedPermissions().length === 0) {
              <p-message severity="warn" text="At least 1 permission is required"></p-message>
            }

            @if (selectedPermissions().length > 100) {
              <p-message severity="error" text="Maximum 100 permissions allowed"></p-message>
            }

            <app-permission-matrix
              [availablePermissions]="availablePermissions()"
              [selectedPermissions]="selectedPermissions()"
              (permissionsChanged)="onPermissionsChanged($event)"
            ></app-permission-matrix>
          </p-card>

          <!-- Preview -->
          @if (showPreview()) {
            <p-card header="Preview" styleClass="form-section">
              <div class="preview-content">
                <div class="preview-row">
                  <strong>Role Name:</strong>
                  <span>{{ roleForm.get('name')?.value || '(not set)' }}</span>
                </div>

                <div class="preview-row">
                  <strong>Description:</strong>
                  <span>{{ roleForm.get('description')?.value || '(not set)' }}</span>
                </div>

                <div class="preview-row">
                  <strong>Permissions:</strong>
                  <span>{{ selectedPermissions().length }} selected</span>
                </div>

                <div class="preview-permissions">
                  @for (permission of selectedPermissions(); track permission) {
                    <code class="permission-tag">{{ permission }}</code>
                  }
                </div>
              </div>
            </p-card>
          }

          <!-- Actions -->
          <div class="form-actions">
            <button
              pButton
              type="button"
              label="Cancel"
              icon="pi pi-times"
              class="p-button-outlined"
              (click)="onCancel()"
            ></button>

            <button
              pButton
              type="button"
              label="{{ showPreview() ? 'Hide Preview' : 'Preview' }}"
              icon="pi pi-eye"
              class="p-button-outlined"
              (click)="togglePreview()"
              [disabled]="!isFormValid()"
            ></button>

            <button
              pButton
              type="submit"
              [label]="isEditMode() ? 'Update Role' : 'Create Role'"
              icon="pi pi-check"
              [loading]="isSaving()"
              [disabled]="!isFormValid() || isSaving()"
            ></button>
          </div>
        </form>
      }
    </div>

    <!-- Confirmation Dialog -->
    <p-confirmDialog></p-confirmDialog>
  `,
  styles: [`
    .custom-role-builder {
      padding: 2rem;
      max-width: 1400px;
      margin: 0 auto;
    }

    .page-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .header-content h1 {
      margin: 0 0 0.5rem 0;
      font-size: 2rem;
      font-weight: 700;
    }

    .header-subtitle {
      margin: 0;
      color: var(--text-color-secondary);
    }

    .loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem;
      gap: 1rem;
    }

    .form-section {
      margin-bottom: 1.5rem;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }

    .form-field {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .form-field.full-width {
      grid-column: 1 / -1;
    }

    .form-field label {
      font-weight: 600;
      color: var(--text-color);
    }

    .permissions-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .permission-count {
      font-weight: 600;
      font-size: 1.125rem;
    }

    .permission-count .error {
      color: var(--red-500);
    }

    .preview-content {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .preview-row {
      display: grid;
      grid-template-columns: 200px 1fr;
      gap: 1rem;
    }

    .preview-permissions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .permission-tag {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      background: var(--primary-50);
      color: var(--primary-700);
      border-radius: 12px;
      font-size: 0.875rem;
      font-family: 'Courier New', monospace;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--surface-border);
    }

    /* Mobile responsive */
    @media (max-width: 768px) {
      .custom-role-builder {
        padding: 1rem;
      }

      .form-grid {
        grid-template-columns: 1fr;
      }

      .preview-row {
        grid-template-columns: 1fr;
      }

      .form-actions {
        flex-direction: column;
      }

      .form-actions button {
        width: 100%;
      }
    }
  `],
})
export class CustomRoleBuilderComponent implements OnInit {
  roleForm: FormGroup;

  // Signals
  isLoading = signal(false);
  isSaving = signal(false);
  error = signal<string | null>(null);
  isEditMode = signal(false);
  showPreview = signal(false);
  availablePermissions = signal<string[]>([]);
  selectedPermissions = signal<string[]>([]);

  // System role names (cannot be used)
  private readonly SYSTEM_ROLE_NAMES = [
    'ADMIN',
    'OPERATOR',
    'DRIVER',
    'COMPLIANCE_OFFICER',
    'CONSULTANT',
    'FLEET_MANAGER',
  ];

  constructor(
    private fb: FormBuilder,
    private router: Router,
    private route: ActivatedRoute,
    private roleApiService: RoleApiService,
    private confirmationService: ConfirmationService,
    private messageService: MessageService,
  ) {
    this.roleForm = this.fb.group({
      name: ['', [Validators.required, Validators.maxLength(100), this.systemRoleValidator.bind(this)]],
      description: ['', [Validators.maxLength(500)]],
    });
  }

  ngOnInit(): void {
    // Load available permissions
    this.loadAvailablePermissions();

    // Check if editing existing role
    const roleId = this.route.snapshot.paramMap.get('id');
    if (roleId) {
      this.isEditMode.set(true);
      this.loadRole(roleId);
    }
  }

  loadAvailablePermissions(): void {
    // TODO: Fetch from API
    // For now, generate common permissions
    const resources = ['fir', 'company', 'user', 'vehicle', 'mud', 'audit', 'role'];
    const actions = ['create', 'read', 'update', 'delete', 'export'];
    const scopes = ['own', 'facility', 'all'];

    const permissions: string[] = [];
    for (const resource of resources) {
      for (const action of actions) {
        for (const scope of scopes) {
          permissions.push(`${resource}:${action}:${scope}`);
        }
      }
    }

    this.availablePermissions.set(permissions);
  }

  loadRole(roleId: string): void {
    this.isLoading.set(true);
    this.error.set(null);

    this.roleApiService.getRole(roleId).subscribe({
      next: (response) => {
        this.roleForm.patchValue({
          name: response.name,
          description: response.description,
        });

        this.selectedPermissions.set((response.permissions || []).map(p => p.permission));
        this.isLoading.set(false);
      },
      error: (error) => {
        this.error.set(`Failed to load role: ${error.message}`);
        this.isLoading.set(false);
      },
    });
  }

  onPermissionsChanged(permissions: string[]): void {
    this.selectedPermissions.set(permissions);
  }

  togglePreview(): void {
    this.showPreview.set(!this.showPreview());
  }

  isFormValid(): boolean {
    return (
      this.roleForm.valid &&
      this.selectedPermissions().length > 0 &&
      this.selectedPermissions().length <= 100
    );
  }

  systemRoleValidator(control: any): { [key: string]: any } | null {
    if (control.value && this.SYSTEM_ROLE_NAMES.includes(control.value.toUpperCase())) {
      return { systemRole: true };
    }
    return null;
  }

  onSubmit(): void {
    if (!this.isFormValid()) {
      return;
    }

    this.isSaving.set(true);

    const roleData = {
      name: this.roleForm.get('name')?.value,
      description: this.roleForm.get('description')?.value,
      permissions: this.selectedPermissions(),
    };

    const apiCall = this.isEditMode()
      ? this.roleApiService.updateRole(this.route.snapshot.paramMap.get('id')!, roleData)
      : this.roleApiService.createRole(roleData);

    apiCall.subscribe({
      next: (response) => {
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: `Role ${this.isEditMode() ? 'updated' : 'created'} successfully`,
        });

        this.isSaving.set(false);
        this.router.navigate(['/permissions/roles']);
      },
      error: (error) => {
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: `Failed to ${this.isEditMode() ? 'update' : 'create'} role: ${error.message}`,
        });

        this.isSaving.set(false);
      },
    });
  }

  onCancel(): void {
    if (this.roleForm.dirty || this.selectedPermissions().length > 0) {
      this.confirmationService.confirm({
        message: 'You have unsaved changes. Are you sure you want to cancel?',
        header: 'Confirm Cancel',
        icon: 'pi pi-exclamation-triangle',
        accept: () => {
          this.goBack();
        },
      });
    } else {
      this.goBack();
    }
  }

  goBack(): void {
    this.router.navigate(['/permissions/roles']);
  }
}
