import {
  Directive,
  Input,
  ElementRef,
  OnInit,
  OnDestroy,
  inject,
  effect,
  Renderer2,
} from '@angular/core';
import { PermissionStore } from '../../../core/state/permission.store';
import { TempPermissionStore } from '../../../core/state/temp-permission.store';
import { RoleStore } from '../../../core/state/role.store';

/**
 * permissionTooltip Directive
 * Adds informative tooltip showing why user lacks permission
 * Shows current role and required permission in user-friendly format
 *
 * Usage:
 * <button
 *   [requirePermission]="'fir:delete:facility'"
 *   [permissionTooltip]="'fir:delete:facility'">
 *   Delete FIR
 * </button>
 *
 * Custom tooltip message:
 * <button
 *   [requirePermission]="'fir:delete:facility'"
 *   [permissionTooltip]="'fir:delete:facility'"
 *   [ptCustomMessage]="'Contact your administrator to request deletion rights'">
 *   Delete FIR
 * </button>
 *
 * Multiple permissions:
 * <button
 *   [requirePermission]="['fir:create:facility', 'fir:read:facility']"
 *   [permissionTooltip]="['fir:create:facility', 'fir:read:facility']"
 *   [ptRequireAll]="true">
 *   Create & Read FIR
 * </button>
 */
@Directive({
  selector: '[permissionTooltip]',
  standalone: true,
})
export class PermissionTooltipDirective implements OnInit, OnDestroy {
  private readonly permissionStore = inject(PermissionStore);
  private readonly tempPermissionStore = inject(TempPermissionStore);
  private readonly roleStore = inject(RoleStore);
  private readonly el = inject(ElementRef);
  private readonly renderer = inject(Renderer2);

  @Input('permissionTooltip') requiredPermission!: string | string[];
  @Input('ptRequireAll') requireAll = false;
  @Input('ptIncludeTemp') includeTemp = false;
  @Input('ptCustomMessage') customMessage = '';

  private tooltipElement: HTMLElement | null = null;

  constructor() {
    // React to permission changes using effect
    effect(() => {
      this.updateTooltip();
    });
  }

  ngOnInit(): void {
    // Ensure all stores are loaded
    this.permissionStore.ensurePermissionsLoaded();
    this.roleStore.ensureRolesLoaded();

    if (this.includeTemp) {
      this.tempPermissionStore.loadGrants();
    }

    this.updateTooltip();
  }

  ngOnDestroy(): void {
    this.removeTooltip();
  }

  private updateTooltip(): void {
    const hasPermission = this.checkPermission();

    if (!hasPermission) {
      // User lacks permission - add tooltip
      this.addTooltip();
    } else {
      // User has permission - remove tooltip
      this.removeTooltip();
    }
  }

  private addTooltip(): void {
    const tooltipText = this.buildTooltipText();

    // Set title attribute for native browser tooltip
    this.renderer.setAttribute(this.el.nativeElement, 'title', tooltipText);

    // Set ARIA label for accessibility
    this.renderer.setAttribute(this.el.nativeElement, 'aria-label', tooltipText);

    // Add data attribute for custom tooltip styling
    this.renderer.setAttribute(
      this.el.nativeElement,
      'data-permission-tooltip',
      tooltipText,
    );
  }

  private removeTooltip(): void {
    this.renderer.removeAttribute(this.el.nativeElement, 'title');
    this.renderer.removeAttribute(this.el.nativeElement, 'data-permission-tooltip');
  }

  private buildTooltipText(): string {
    if (this.customMessage) {
      return this.customMessage;
    }

    const permissions = Array.isArray(this.requiredPermission)
      ? this.requiredPermission
      : [this.requiredPermission];

    const currentRole = this.roleStore.primaryRole() || 'No role assigned';

    // Format permissions in user-friendly way
    const formattedPermissions = permissions
      .map((perm) => this.formatPermission(perm))
      .join(this.requireAll ? ' AND ' : ' OR ');

    let message = `Insufficient permissions.\n`;
    message += `Your current role: ${currentRole}\n`;
    message += `Required: ${formattedPermissions}\n`;
    message += `Contact your administrator to request access.`;

    return message;
  }

  /**
   * Format permission string into user-friendly text
   * Example: "fir:delete:facility" -> "Delete FIRs (Facility scope)"
   */
  private formatPermission(permission: string): string {
    const parts = permission.split(':');
    if (parts.length !== 3) {
      return permission;
    }

    const [resource, action, scope] = parts;

    // Capitalize and pluralize resource
    const resourceDisplay = this.capitalizeResource(resource);

    // Format action
    const actionDisplay = this.capitalizeAction(action);

    // Format scope
    const scopeDisplay = this.formatScope(scope);

    return `${actionDisplay} ${resourceDisplay} (${scopeDisplay})`;
  }

  private capitalizeResource(resource: string): string {
    const resourceMap: Record<string, string> = {
      fir: 'FIRs',
      facility: 'Facilities',
      user: 'Users',
      report: 'Reports',
      analytics: 'Analytics',
      notification: 'Notifications',
      admin: 'Admin functions',
      system: 'System',
    };

    return resourceMap[resource] || resource.toUpperCase();
  }

  private capitalizeAction(action: string): string {
    const actionMap: Record<string, string> = {
      create: 'Create',
      read: 'View',
      update: 'Edit',
      delete: 'Delete',
      manage: 'Manage',
      assign: 'Assign',
      approve: 'Approve',
      export: 'Export',
      configure: 'Configure',
    };

    return actionMap[action] || action.charAt(0).toUpperCase() + action.slice(1);
  }

  private formatScope(scope: string): string {
    const scopeMap: Record<string, string> = {
      own: 'Own resources only',
      facility: 'Facility scope',
      all: 'All resources',
    };

    return scopeMap[scope] || scope;
  }

  private checkPermission(): boolean {
    const permissions = Array.isArray(this.requiredPermission)
      ? this.requiredPermission
      : [this.requiredPermission];

    const hasPermissionFn = this.permissionStore.hasPermission();

    if (this.requireAll) {
      const hasPermanentPermissions = permissions.every((perm) =>
        hasPermissionFn(perm),
      );

      if (!this.includeTemp) {
        return hasPermanentPermissions;
      }

      const hasTempPermissionFn = this.tempPermissionStore.hasTempPermission();
      return (
        hasPermanentPermissions ||
        permissions.every((perm) => hasTempPermissionFn(perm))
      );
    } else {
      const hasPermanentPermission = permissions.some((perm) =>
        hasPermissionFn(perm),
      );

      if (!this.includeTemp) {
        return hasPermanentPermission;
      }

      const hasTempPermissionFn = this.tempPermissionStore.hasTempPermission();
      return (
        hasPermanentPermission || permissions.some((perm) => hasTempPermissionFn(perm))
      );
    }
  }
}
