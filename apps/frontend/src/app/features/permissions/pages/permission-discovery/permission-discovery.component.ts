import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { AccordionModule } from 'primeng/accordion';
import { CardModule } from 'primeng/card';
import { BadgeModule } from 'primeng/badge';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonModule } from 'primeng/button';
import { PermissionStore } from '../../../../core/state/permission.store';
import { RoleStore } from '../../../../core/state/role.store';
import { PermissionFormatPipe } from '../../pipes/permission-format.pipe';
import { RoleDescriptionPipe } from '../../pipes/role-description.pipe';

/**
 * PermissionDiscoveryComponent
 * Mobile-first "My Permissions" page for User Story 3
 * Per spec.md: Help field operators discover permission boundaries on mobile
 *
 * Features:
 * - Mobile: Accordion layout (collapsible categories)
 * - Desktop: Grid layout (cards)
 * - Visual indicators: ✓ allowed (green), ○ view-only (blue), ✗ denied (gray)
 * - 56px touch targets per plan.md mobile-first requirements
 * - Permission grouping by module (FIR, User, Role, Analytics, etc.)
 * - Human-readable descriptions using PermissionFormatPipe
 * - Role badge showing current user role
 *
 * T127: Enhanced permission discovery with mobile-responsive layout
 */
@Component({
  selector: 'app-permission-discovery',
  standalone: true,
  imports: [
    CommonModule,
    AccordionModule,
    CardModule,
    BadgeModule,
    TooltipModule,
    ButtonModule,
    PermissionFormatPipe,
    RoleDescriptionPipe,
  ],
  template: `
    <div class="permission-discovery-page">
      <!-- Header with role badge -->
      <div class="page-header">
        <h1>My Permissions</h1>
        <p class="subtitle">{{ currentRole() | roleDescription:'short' }}</p>

        <div class="role-badge-container">
          <span class="role-badge" data-testid="role-badge">
            {{ currentRole() | roleDescription:'name' }}
          </span>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="permissionStore.isLoading()" class="loading-state">
        <i class="pi pi-spin pi-spinner" style="font-size: 2rem"></i>
        <p>Loading your permissions...</p>
      </div>

      <!-- Error State -->
      <div *ngIf="permissionStore.error()" class="error-state">
        <i class="pi pi-exclamation-triangle"></i>
        <p>{{ permissionStore.error() }}</p>
        <button pButton label="Retry" (click)="retryLoad()"></button>
      </div>

      <!-- Mobile Layout: Accordion -->
      <div
        *ngIf="isMobile() && !permissionStore.isLoading() && !permissionStore.error()"
        class="mobile-layout"
        data-testid="permission-accordion">
        <p-accordion [multiple]="true" [activeIndex]="[0]">
          <p-accordionTab
            *ngFor="let category of permissionCategories()"
            [header]="category.name"
            data-testid="category-header">
            <div class="category-content" [attr.data-testid]="'category-content-' + category.key">
              <div
                *ngFor="let permission of category.permissions"
                class="permission-row"
                [attr.data-testid]="'permission-item-' + permission.raw">
                <div class="permission-icon" [class]="getPermissionState(permission.raw)" data-testid="permission-icon">
                  {{ getPermissionIcon(permission.raw) }}
                </div>
                <div class="permission-details">
                  <span class="permission-name" data-testid="permission-status">
                    {{ permission.raw | permissionFormat }}
                  </span>
                  <span class="permission-scope">{{ permission.scope }}</span>
                </div>
                <button
                  pButton
                  icon="pi pi-question-circle"
                  class="p-button-text p-button-rounded help-button"
                  [pTooltip]="getPermissionHelp(permission.raw)"
                  tooltipPosition="left"
                  data-testid="help-icon"></button>
              </div>
            </div>
          </p-accordionTab>
        </p-accordion>
      </div>

      <!-- Desktop Layout: Grid -->
      <div
        *ngIf="!isMobile() && !permissionStore.isLoading() && !permissionStore.error()"
        class="desktop-layout"
        data-testid="permission-grid">
        <p-card
          *ngFor="let category of permissionCategories()"
          [header]="category.name"
          styleClass="category-card">
          <div class="permissions-grid">
            <div
              *ngFor="let permission of category.permissions"
              class="permission-card"
              [attr.data-testid]="'permission-item-' + permission.raw">
              <div class="permission-icon" [class]="getPermissionState(permission.raw)">
                {{ getPermissionIcon(permission.raw) }}
              </div>
              <div class="permission-info">
                <span class="permission-name">
                  {{ permission.raw | permissionFormat }}
                </span>
                <span class="permission-scope">{{ permission.scope }}</span>
              </div>
              <i
                class="pi pi-question-circle help-icon"
                [pTooltip]="getPermissionHelp(permission.raw)"
                tooltipPosition="top"></i>
            </div>
          </div>
        </p-card>
      </div>
    </div>
  `,
  styles: [`
    .permission-discovery-page {
      padding: 1rem;
      min-height: 100vh;
    }

    .page-header {
      margin-bottom: 2rem;
      text-align: center;
    }

    .page-header h1 {
      margin: 0;
      color: #2c3e50;
      font-size: 1.75rem;
    }

    .subtitle {
      color: #6c757d;
      margin: 0.5rem 0 1rem;
    }

    .role-badge-container {
      display: flex;
      justify-content: center;
      margin-top: 1rem;
    }

    .role-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 56px;
      padding: 0.75rem 1.5rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 28px;
      font-weight: 600;
      font-size: 1rem;
      text-transform: uppercase;
      letter-spacing: 1px;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }

    .loading-state,
    .error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem;
      text-align: center;
      gap: 1rem;
    }

    .error-state {
      color: #d32f2f;
    }

    /* Mobile Layout: Accordion */
    .mobile-layout {
      margin-top: 1rem;
    }

    :host ::ng-deep .p-accordion .p-accordion-header .p-accordion-header-link {
      min-height: 56px;
      padding: 1rem;
      font-weight: 600;
      font-size: 1rem;
      transition: all 0.3s ease;
    }

    :host ::ng-deep .p-accordion .p-accordion-header .p-accordion-header-link:hover {
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
    }

    :host ::ng-deep .p-accordion .p-accordion-content {
      padding: 0;
    }

    .category-content {
      display: flex;
      flex-direction: column;
    }

    .permission-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 1rem;
      min-height: 56px;
      border-bottom: 1px solid #e9ecef;
      transition: background 0.2s ease;
    }

    .permission-row:hover {
      background: #f8f9fa;
    }

    .permission-row:last-child {
      border-bottom: none;
    }

    .permission-icon {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.25rem;
      font-weight: bold;
      flex-shrink: 0;
    }

    .permission-icon.allowed {
      background: #c8e6c9;
      color: #2e7d32;
    }

    .permission-icon.view-only {
      background: #bbdefb;
      color: #1565c0;
    }

    .permission-icon.denied {
      background: #e0e0e0;
      color: #757575;
    }

    .permission-details {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .permission-name {
      font-weight: 500;
      color: #2c3e50;
      font-size: 0.9375rem;
    }

    .permission-scope {
      font-size: 0.75rem;
      color: #6c757d;
      text-transform: uppercase;
    }

    .help-button {
      flex-shrink: 0;
    }

    /* Desktop Layout: Grid */
    .desktop-layout {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 1.5rem;
      margin-top: 1rem;
    }

    .category-card {
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      transition: box-shadow 0.3s ease;
    }

    .category-card:hover {
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    }

    .permissions-grid {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .permission-card {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem;
      background: #f8f9fa;
      border-radius: 4px;
      transition: background 0.2s ease;
    }

    .permission-card:hover {
      background: #e9ecef;
    }

    .permission-info {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .help-icon {
      color: #6c757d;
      cursor: pointer;
      font-size: 1.125rem;
    }

    .help-icon:hover {
      color: #1976d2;
    }

    /* Responsive adjustments */
    @media (min-width: 768px) {
      .permission-discovery-page {
        padding: 2rem;
      }

      .page-header h1 {
        font-size: 2.5rem;
      }
    }
  `]
})
export class PermissionDiscoveryComponent implements OnInit {
  protected readonly permissionStore = inject(PermissionStore);
  protected readonly roleStore = inject(RoleStore);
  private readonly breakpointObserver = inject(BreakpointObserver);

  // Responsive state
  isMobile = signal(false);

  // Current user role
  currentRole = computed(() => {
    const roles = this.roleStore.roles();
    return roles.length > 0 ? roles[0].name : 'UNKNOWN';
  });

  // Permission categories
  permissionCategories = computed(() => {
    const permissions = this.permissionStore.permissions();
    return this.groupPermissionsByCategory(permissions);
  });

  ngOnInit(): void {
    // Ensure permissions and roles are loaded
    this.permissionStore.ensurePermissionsLoaded();
    this.roleStore.loadRoles();

    // Observe breakpoint changes
    this.breakpointObserver
      .observe([Breakpoints.Handset, Breakpoints.Tablet])
      .subscribe((result) => {
        this.isMobile.set(result.matches);
      });
  }

  /**
   * Group permissions by category (resource type)
   */
  private groupPermissionsByCategory(permissions: string[]): Array<{
    key: string;
    name: string;
    permissions: Array<{ raw: string; scope: string }>;
  }> {
    const categoryMap = new Map<string, Array<{ raw: string; scope: string }>>();

    permissions.forEach((permission) => {
      const parts = permission.split(':');
      if (parts.length !== 3) return;

      const [resource, , scope] = parts;

      // Category names
      const categoryNames: Record<string, string> = {
        fir: 'FIR Management',
        user: 'User Management',
        role: 'Role Management',
        permission: 'Permission Management',
        tenant: 'Tenant Management',
        analytics: 'Analytics & Reports',
        mud: 'MUD Reporting',
        backup: 'System Backups',
      };

      const categoryName = categoryNames[resource] || `${resource} Management`;

      if (!categoryMap.has(resource)) {
        categoryMap.set(resource, []);
      }

      categoryMap.get(resource)!.push({
        raw: permission,
        scope: scope.toUpperCase(),
      });
    });

    // Convert to array and sort
    return Array.from(categoryMap.entries())
      .map(([key, perms]) => ({
        key,
        name: this.getCategoryName(key),
        permissions: perms,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Get category display name
   */
  private getCategoryName(resource: string): string {
    const categoryNames: Record<string, string> = {
      fir: 'FIR Management',
      user: 'User Management',
      role: 'Role Management',
      permission: 'Permission Management',
      tenant: 'Tenant Management',
      analytics: 'Analytics & Reports',
      mud: 'MUD Reporting',
      backup: 'System Backups',
    };

    return categoryNames[resource] || `${resource} Management`;
  }

  /**
   * Get permission state for styling
   */
  getPermissionState(permission: string): 'allowed' | 'view-only' | 'denied' {
    const hasPermission = this.permissionStore.hasPermission()(permission);

    if (!hasPermission) {
      return 'denied';
    }

    // Check if it's a read-only permission
    if (permission.includes(':read:')) {
      return 'view-only';
    }

    return 'allowed';
  }

  /**
   * Get permission icon
   */
  getPermissionIcon(permission: string): string {
    const state = this.getPermissionState(permission);

    switch (state) {
      case 'allowed':
        return '✓';
      case 'view-only':
        return '○';
      case 'denied':
        return '✗';
    }
  }

  /**
   * Get contextual help for permission
   */
  getPermissionHelp(permission: string): string {
    const hasPermission = this.permissionStore.hasPermission()(permission);

    if (hasPermission) {
      return `You have this permission. ${this.getPermissionDescription(permission)}`;
    }

    return `You don't have this permission. Contact your administrator to request access.`;
  }

  /**
   * Get detailed permission description
   */
  private getPermissionDescription(permission: string): string {
    const parts = permission.split(':');
    if (parts.length !== 3) return '';

    const [resource, action] = parts;

    const descriptions: Record<string, Record<string, string>> = {
      fir: {
        create: 'You can create new FIRs for waste management.',
        read: 'You can view existing FIRs.',
        update: 'You can edit existing FIRs.',
        delete: 'You can delete FIRs.',
      },
      user: {
        create: 'You can create new user accounts.',
        read: 'You can view user information.',
        update: 'You can edit user profiles.',
        delete: 'You can deactivate user accounts.',
      },
    };

    return descriptions[resource]?.[action] || '';
  }

  /**
   * Retry loading permissions
   */
  retryLoad(): void {
    this.permissionStore.refreshPermissions();
    this.roleStore.loadRoles();
  }
}
