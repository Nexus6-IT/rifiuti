import { Component, Input, Output, EventEmitter, signal, computed } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { TableModule } from 'primeng/table'
import { CheckboxModule } from 'primeng/checkbox'
import { InputTextModule } from 'primeng/inputtext'
import { ButtonModule } from 'primeng/button'
import { TagModule } from 'primeng/tag'
import { TooltipModule } from 'primeng/tooltip'

/**
 * PermissionMatrixComponent
 * Interactive permission matrix with virtual scrolling
 * T176: Permission matrix component per User Story 5
 *
 * Purpose: Provide visual matrix for selecting permissions
 *
 * Requirements from spec.md FR-011:
 * - Display all available permissions in organized matrix
 * - Allow selection/deselection of permissions
 * - Show permission format (resource:action:scope)
 * - Group by resource type
 *
 * Requirements from plan.md:
 * - Virtual scrolling for performance (100+ permissions)
 * - Search/filter functionality
 * - Clear visual indicators for selected permissions
 */
@Component({
  selector: 'app-permission-matrix',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    CheckboxModule,
    InputTextModule,
    ButtonModule,
    TagModule,
    TooltipModule,
  ],
  template: `
    <div class="permission-matrix">
      <!-- Header with search -->
      <div class="matrix-header">
        <div class="header-info">
          <h3>Permission Matrix</h3>
          <p class="selected-count">
            {{ selectedPermissions.length }} of {{ availablePermissions.length }} selected
          </p>
        </div>

        <div class="header-actions">
          <span class="p-input-icon-left">
            <i class="pi pi-search"></i>
            <input
              pInputText
              type="text"
              [(ngModel)]="searchTerm"
              (ngModelChange)="onSearchChange()"
              placeholder="Search permissions..."
            />
          </span>

          <button
            pButton
            type="button"
            label="Select All"
            icon="pi pi-check"
            class="p-button-sm p-button-outlined"
            (click)="selectAll()"
            [disabled]="filteredPermissions().length === 0"
          ></button>

          <button
            pButton
            type="button"
            label="Clear All"
            icon="pi pi-times"
            class="p-button-sm p-button-outlined p-button-danger"
            (click)="clearAll()"
            [disabled]="selectedPermissions.length === 0"
          ></button>
        </div>
      </div>

      <!-- Permission Table with Virtual Scrolling -->
      <p-table
        [value]="filteredPermissions()"
        [scrollable]="true"
        scrollHeight="500px"
        [virtualScroll]="true"
        [virtualScrollItemSize]="50"
        [rows]="50"
        styleClass="p-datatable-sm"
      >
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 50px">
              <p-checkbox
                [(ngModel)]="allSelected"
                (onChange)="toggleAll()"
                binary="true"
              ></p-checkbox>
            </th>
            <th>Permission</th>
            <th>Resource</th>
            <th>Action</th>
            <th>Scope</th>
            <th style="width: 120px">Actions</th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-permission>
          <tr
            [class.selected-row]="isSelected(permission.fullPermission)"
            (click)="togglePermission(permission.fullPermission)"
            style="cursor: pointer;"
          >
            <td>
              <p-checkbox
                [(ngModel)]="permission.selected"
                (onChange)="onCheckboxChange(permission)"
                binary="true"
                (click)="$event.stopPropagation()"
              ></p-checkbox>
            </td>

            <td>
              <div class="permission-cell">
                <code class="permission-code">{{ permission.fullPermission }}</code>
                @if (permission.description) {
                  <small class="permission-description">{{ permission.description }}</small>
                }
              </div>
            </td>

            <td>
              <p-tag [value]="permission.resource" severity="info"></p-tag>
            </td>

            <td>
              <p-tag
                [value]="permission.action"
                [severity]="getActionSeverity(permission.action)"
              ></p-tag>
            </td>

            <td>
              <p-tag
                [value]="permission.scope"
                [severity]="getScopeSeverity(permission.scope)"
              ></p-tag>
            </td>

            <td>
              <button
                pButton
                type="button"
                icon="pi pi-info-circle"
                class="p-button-sm p-button-text p-button-rounded"
                pTooltip="View permission details"
                (click)="showPermissionDetails(permission); $event.stopPropagation()"
              ></button>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="6" class="empty-message">
              @if (searchTerm) {
                <div class="empty-state">
                  <i class="pi pi-search"></i>
                  <p>No permissions found matching "{{ searchTerm }}"</p>
                </div>
              } @else {
                <div class="empty-state">
                  <i class="pi pi-info-circle"></i>
                  <p>No permissions available</p>
                </div>
              }
            </td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Summary Footer -->
      <div class="matrix-footer">
        <div class="footer-stats">
          <div class="stat">
            <i class="pi pi-shield"></i>
            <span>{{ getSelectedByScope('all') }} All Scope</span>
          </div>
          <div class="stat">
            <i class="pi pi-building"></i>
            <span>{{ getSelectedByScope('facility') }} Facility Scope</span>
          </div>
          <div class="stat">
            <i class="pi pi-user"></i>
            <span>{{ getSelectedByScope('own') }} Own Scope</span>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .permission-matrix {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        background: var(--surface-card);
        border: 1px solid var(--surface-border);
        border-radius: 8px;
        padding: 1.5rem;
      }

      .matrix-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 1rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--surface-border);
      }

      .header-info h3 {
        margin: 0 0 0.25rem 0;
        font-size: var(--font-size-xl);
        font-weight: var(--font-weight-semibold);
        color: var(--text-primary);
      }

      .selected-count {
        margin: 0;
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }

      .header-actions {
        display: flex;
        gap: var(--spacing-md);
        align-items: center;
      }

      .selected-row {
        background: var(--brand-primary-50) !important;
      }

      .permission-cell {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .permission-code {
        font-family: var(--font-family-mono);
        font-size: var(--font-size-sm);
        background: var(--color-gray-50);
        padding: 0.25rem 0.5rem;
        border-radius: var(--radius-sm);
        color: var(--brand-primary-dark);
      }

      .permission-description {
        color: var(--text-secondary);
        font-size: var(--font-size-xs);
      }

      .matrix-footer {
        padding-top: var(--spacing-base);
        border-top: 1px solid var(--surface-border);
      }

      .footer-stats {
        display: flex;
        gap: var(--spacing-xl);
        align-items: center;
        flex-wrap: wrap;
      }

      .stat {
        display: flex;
        align-items: center;
        gap: var(--spacing-sm);
        font-size: var(--font-size-sm);
        color: var(--text-secondary);
      }

      .stat i {
        color: var(--brand-primary);
      }

      .empty-message {
        text-align: center;
        padding: var(--spacing-3xl);
      }

      .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--spacing-base);
      }

      .empty-state i {
        font-size: 3rem;
        color: var(--text-tertiary);
        opacity: 0.5;
      }

      .empty-state p {
        margin: 0;
        color: var(--text-secondary);
      }

      /* Mobile responsive */
      @media (max-width: 768px) {
        .matrix-header {
          flex-direction: column;
          align-items: flex-start;
        }

        .header-actions {
          width: 100%;
          flex-direction: column;
        }

        .header-actions input {
          width: 100%;
        }

        .footer-stats {
          flex-direction: column;
          align-items: flex-start;
          gap: 0.5rem;
        }
      }
    `,
  ],
})
export class PermissionMatrixComponent {
  @Input() set availablePermissions(permissions: string[]) {
    this._availablePermissions = permissions
    this.parsePermissions()
  }

  get availablePermissions(): string[] {
    return this._availablePermissions
  }

  @Input() set selectedPermissions(permissions: string[]) {
    this._selectedPermissions = permissions
    this.updateSelectionState()
  }

  get selectedPermissions(): string[] {
    return this._selectedPermissions
  }

  @Output() permissionsChanged = new EventEmitter<string[]>()
  @Output() permissionDetailsRequested = new EventEmitter<any>()

  private _availablePermissions: string[] = []
  private _selectedPermissions: string[] = []

  searchTerm = ''
  allSelected = false

  // Signals for reactive state
  parsedPermissions = signal<
    Array<{
      fullPermission: string
      resource: string
      action: string
      scope: string
      selected: boolean
      description?: string
    }>
  >([])

  filteredPermissions = computed(() => {
    const search = this.searchTerm.toLowerCase()
    if (!search) return this.parsedPermissions()

    return this.parsedPermissions().filter(
      p =>
        p.fullPermission.toLowerCase().includes(search) ||
        p.resource.toLowerCase().includes(search) ||
        p.action.toLowerCase().includes(search) ||
        p.scope.toLowerCase().includes(search)
    )
  })

  parsePermissions(): void {
    const parsed = this._availablePermissions.map(permission => {
      const [resource, action, scope] = permission.split(':')
      return {
        fullPermission: permission,
        resource: resource || '',
        action: action || '',
        scope: scope || '',
        selected: this._selectedPermissions.includes(permission),
        description: this.getPermissionDescription(permission),
      }
    })

    this.parsedPermissions.set(parsed)
  }

  updateSelectionState(): void {
    const updated = this.parsedPermissions().map(p => ({
      ...p,
      selected: this._selectedPermissions.includes(p.fullPermission),
    }))

    this.parsedPermissions.set(updated)
    this.allSelected = this._selectedPermissions.length === this._availablePermissions.length
  }

  togglePermission(permission: string): void {
    const isSelected = this._selectedPermissions.includes(permission)

    if (isSelected) {
      this._selectedPermissions = this._selectedPermissions.filter(p => p !== permission)
    } else {
      this._selectedPermissions = [...this._selectedPermissions, permission]
    }

    this.updateSelectionState()
    this.permissionsChanged.emit(this._selectedPermissions)
  }

  onCheckboxChange(permission: any): void {
    this.togglePermission(permission.fullPermission)
  }

  toggleAll(): void {
    if (this.allSelected) {
      this.selectAll()
    } else {
      this.clearAll()
    }
  }

  selectAll(): void {
    this._selectedPermissions = this.filteredPermissions().map(p => p.fullPermission)
    this.updateSelectionState()
    this.permissionsChanged.emit(this._selectedPermissions)
  }

  clearAll(): void {
    this._selectedPermissions = []
    this.updateSelectionState()
    this.permissionsChanged.emit(this._selectedPermissions)
  }

  isSelected(permission: string): boolean {
    return this._selectedPermissions.includes(permission)
  }

  onSearchChange(): void {
    // Trigger filtered computation
  }

  getActionSeverity(action: string): 'success' | 'info' | 'warning' | 'danger' {
    const lowerAction = action.toLowerCase()

    if (lowerAction.includes('delete') || lowerAction.includes('remove')) {
      return 'danger'
    }

    if (lowerAction.includes('create') || lowerAction.includes('write')) {
      return 'warning'
    }

    if (lowerAction.includes('read') || lowerAction.includes('view')) {
      return 'info'
    }

    return 'success'
  }

  getScopeSeverity(scope: string): 'success' | 'info' | 'warning' {
    switch (scope) {
      case 'all':
        return 'danger' as any
      case 'facility':
        return 'warning'
      case 'own':
        return 'info'
      default:
        return 'info'
    }
  }

  getSelectedByScope(scope: string): number {
    return this._selectedPermissions.filter(p => p.endsWith(`:${scope}`)).length
  }

  showPermissionDetails(permission: any): void {
    this.permissionDetailsRequested.emit(permission)
  }

  getPermissionDescription(permission: string): string {
    const [resource, action, scope] = permission.split(':')

    const resourceNames: Record<string, string> = {
      fir: 'Formulario Identificazione Rifiuti',
      company: 'Company',
      user: 'User',
      vehicle: 'Vehicle',
      mud: 'Modello Unico Dichiarazione',
      audit: 'Audit Logs',
      role: 'Roles',
    }

    const actionNames: Record<string, string> = {
      create: 'Create',
      read: 'View',
      update: 'Edit',
      delete: 'Delete',
      export: 'Export',
      approve: 'Approve',
    }

    const scopeDescriptions: Record<string, string> = {
      own: 'only own records',
      facility: 'within assigned facilities',
      all: 'all records',
    }

    const resourceName = resourceNames[resource] || resource
    const actionName = actionNames[action] || action
    const scopeDesc = scopeDescriptions[scope] || scope

    return `${actionName} ${resourceName} ${scopeDesc}`
  }
}
