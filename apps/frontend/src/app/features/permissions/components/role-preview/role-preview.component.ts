import { Component, Input, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DividerModule } from 'primeng/divider';
import { TooltipModule } from 'primeng/tooltip';
import { AccordionModule } from 'primeng/accordion';

/**
 * RolePreviewComponent
 * Preview component showing which actions will be granted before role assignment
 * T177: Role preview component per User Story 5
 *
 * Purpose: Show granted actions before assignment per spec.md FR-028
 *
 * Requirements from spec.md FR-028:
 * - "Preview which actions will be granted before assignment"
 * - Show human-readable permission descriptions
 * - Group by resource type
 * - Highlight sensitive permissions
 *
 * Requirements from plan.md:
 * - Clear visual presentation of permissions
 * - Real-time preview as permissions change
 * - Responsive layout
 */
@Component({
  selector: 'app-role-preview',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ButtonModule,
    TagModule,
    DividerModule,
    TooltipModule,
    AccordionModule,
  ],
  template: `
    <div class="role-preview">
      <p-card [header]="previewTitle()">
        <!-- Summary -->
        <div class="preview-summary">
          <div class="summary-item">
            <i class="pi pi-shield"></i>
            <div class="summary-content">
              <span class="summary-label">Total Permissions</span>
              <span class="summary-value">{{ permissions().length }}</span>
            </div>
          </div>

          <div class="summary-item">
            <i class="pi pi-exclamation-triangle"></i>
            <div class="summary-content">
              <span class="summary-label">Sensitive Actions</span>
              <span class="summary-value">{{ sensitiveCount() }}</span>
            </div>
          </div>

          <div class="summary-item">
            <i class="pi pi-sitemap"></i>
            <div class="summary-content">
              <span class="summary-label">Resource Types</span>
              <span class="summary-value">{{ groupedPermissions().length }}</span>
            </div>
          </div>
        </div>

        <p-divider></p-divider>

        <!-- Grouped Permissions -->
        @if (permissions().length === 0) {
          <div class="empty-state">
            <i class="pi pi-info-circle"></i>
            <p>No permissions selected. Add permissions to see what actions will be granted.</p>
          </div>
        } @else {
          <p-accordion [multiple]="true" [activeIndex]="[0]">
            @for (group of groupedPermissions(); track group.resource) {
              <p-accordionTab [header]="getGroupHeader(group)">
                <div class="permission-list">
                  @for (perm of group.permissions; track perm.permission) {
                    <div class="permission-item" [class.sensitive]="perm.isSensitive">
                      <div class="permission-icon">
                        @if (perm.isSensitive) {
                          <i class="pi pi-exclamation-triangle" style="color: var(--orange-500)"></i>
                        } @else {
                          <i class="pi pi-check" style="color: var(--green-500)"></i>
                        }
                      </div>

                      <div class="permission-details">
                        <div class="permission-action">
                          {{ formatAction(perm.action, perm.scope) }}
                          @if (perm.isSensitive) {
                            <p-tag severity="warning" value="Sensitive" styleClass="ml-2"></p-tag>
                          }
                        </div>
                        <div class="permission-description">
                          {{ perm.description }}
                        </div>
                        <div class="permission-code">
                          <code>{{ perm.permission }}</code>
                        </div>
                      </div>
                    </div>
                  }
                </div>
              </p-accordionTab>
            }
          </p-accordion>
        }

        <!-- Warning for sensitive permissions -->
        @if (sensitiveCount() > 0) {
          <div class="sensitive-warning">
            <i class="pi pi-exclamation-triangle"></i>
            <span>
              This role includes {{ sensitiveCount() }} sensitive permission(s).
              Ensure you trust the user before assigning this role.
            </span>
          </div>
        }
      </p-card>
    </div>
  `,
  styles: [`
    .role-preview {
      width: 100%;
    }

    .preview-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }

    .summary-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--surface-50);
      border-radius: 8px;
      border: 1px solid var(--surface-200);
    }

    .summary-item i {
      font-size: 1.5rem;
      color: var(--primary-500);
    }

    .summary-content {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .summary-label {
      font-size: 0.875rem;
      color: var(--text-color-secondary);
    }

    .summary-value {
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--text-color);
    }

    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--text-color-secondary);
    }

    .empty-state i {
      font-size: 3rem;
      margin-bottom: 1rem;
      display: block;
      color: var(--surface-400);
    }

    .permission-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .permission-item {
      display: flex;
      gap: 0.75rem;
      padding: 0.75rem;
      border: 1px solid var(--surface-200);
      border-radius: 6px;
      background: var(--surface-0);
      transition: all 0.2s ease;
    }

    .permission-item:hover {
      background: var(--surface-50);
      border-color: var(--primary-200);
    }

    .permission-item.sensitive {
      border-color: var(--orange-200);
      background: var(--orange-50);
    }

    .permission-icon {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .permission-details {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .permission-action {
      font-weight: 600;
      color: var(--text-color);
      display: flex;
      align-items: center;
    }

    .permission-description {
      font-size: 0.875rem;
      color: var(--text-color-secondary);
    }

    .permission-code {
      margin-top: 0.25rem;
    }

    .permission-code code {
      font-size: 0.75rem;
      padding: 0.25rem 0.5rem;
      background: var(--surface-100);
      border-radius: 4px;
      color: var(--primary-700);
      font-family: 'Courier New', monospace;
    }

    .sensitive-warning {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
      margin-top: 1rem;
      background: var(--orange-50);
      border: 1px solid var(--orange-200);
      border-radius: 6px;
      color: var(--orange-900);
    }

    .sensitive-warning i {
      font-size: 1.25rem;
      color: var(--orange-500);
    }

    /* Mobile responsive */
    @media (max-width: 768px) {
      .preview-summary {
        grid-template-columns: 1fr;
      }

      .permission-item {
        flex-direction: column;
        align-items: flex-start;
      }
    }
  `],
})
export class RolePreviewComponent {
  @Input() set permissions(value: string[]) {
    this._permissions.set(value || []);
  }

  @Input() roleName: string = '';
  @Input() roleDescription: string = '';

  private _permissions = signal<string[]>([]);

  permissions = computed(() => this._permissions());

  previewTitle = computed(() => {
    if (this.roleName) {
      return `Preview: ${this.roleName}`;
    }
    return 'Role Preview';
  });

  /**
   * Parse permissions and enrich with metadata
   */
  enrichedPermissions = computed(() => {
    return this.permissions().map((perm) => {
      const parts = perm.split(':');
      const [resource, action, scope] = parts;

      return {
        permission: perm,
        resource: resource || 'unknown',
        action: action || 'unknown',
        scope: scope || 'unknown',
        isSensitive: this.isSensitivePermission(perm),
        description: this.getPermissionDescription(resource, action, scope),
      };
    });
  });

  /**
   * Group permissions by resource
   */
  groupedPermissions = computed(() => {
    const grouped = new Map<string, typeof this.enrichedPermissions extends () => infer R ? R[number][] : never>();

    for (const perm of this.enrichedPermissions()) {
      const existing = grouped.get(perm.resource) || [];
      existing.push(perm);
      grouped.set(perm.resource, existing);
    }

    return Array.from(grouped.entries()).map(([resource, permissions]) => ({
      resource,
      permissions,
      count: permissions.length,
    }));
  });

  /**
   * Count sensitive permissions
   */
  sensitiveCount = computed(() => {
    return this.enrichedPermissions().filter((p) => p.isSensitive).length;
  });

  /**
   * Check if permission is sensitive
   */
  private isSensitivePermission(permission: string): boolean {
    const sensitivePatterns = [
      'delete',
      'approve',
      'reject',
      'sign',
      'admin',
      'all',
    ];

    return sensitivePatterns.some((pattern) =>
      permission.toLowerCase().includes(pattern)
    );
  }

  /**
   * Get human-readable description
   */
  private getPermissionDescription(
    resource: string,
    action: string,
    scope: string
  ): string {
    const resourceName = this.formatResourceName(resource);
    const actionName = this.formatActionName(action);
    const scopeName = this.formatScopeName(scope);

    return `${actionName} ${resourceName} ${scopeName}`;
  }

  /**
   * Format resource name
   */
  private formatResourceName(resource: string): string {
    const names: Record<string, string> = {
      fir: 'FIRs',
      user: 'users',
      role: 'roles',
      facility: 'facilities',
      vehicle: 'vehicles',
      report: 'reports',
      audit: 'audit logs',
    };

    return names[resource] || resource;
  }

  /**
   * Format action name
   */
  private formatActionName(action: string): string {
    const names: Record<string, string> = {
      create: 'Create',
      read: 'View',
      update: 'Edit',
      delete: 'Delete',
      approve: 'Approve',
      reject: 'Reject',
      sign: 'Sign',
      export: 'Export',
      manage: 'Manage',
    };

    return names[action] || action;
  }

  /**
   * Format scope name
   */
  private formatScopeName(scope: string): string {
    const names: Record<string, string> = {
      own: 'for own records only',
      facility: 'within assigned facilities',
      all: 'across entire organization',
    };

    return names[scope] || scope;
  }

  /**
   * Format action with scope
   */
  formatAction(action: string, scope: string): string {
    return `${this.formatActionName(action)} (${scope})`;
  }

  /**
   * Get group header
   */
  getGroupHeader(group: { resource: string; count: number }): string {
    return `${this.formatResourceName(group.resource)} (${group.count} permission${group.count !== 1 ? 's' : ''})`;
  }
}
