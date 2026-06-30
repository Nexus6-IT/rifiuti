import { Pipe, PipeTransform } from '@angular/core'

/**
 * PermissionFormatPipe
 * Transforms technical permission strings into human-readable descriptions
 * T125: Permission format pipe for User Story 3
 *
 * Purpose: Make permissions understandable for field operators on mobile devices
 *
 * Usage:
 * ```
 * {{ 'fir:create:facility' | permissionFormat }}
 * // Output: "Create FIRs for assigned facilities"
 *
 * {{ 'fir:create:facility' | permissionFormat:'short' }}
 * // Output: "Create FIRs"
 * ```
 *
 * Requirements from spec.md:
 * - Transform technical permissions into clear, action-oriented descriptions
 * - Use concise language suitable for mobile screens (<50 characters)
 * - Avoid technical jargon (no "CRUD", "RBAC", etc.)
 * - Start with action verbs (Create, View, Edit, Delete, etc.)
 *
 * Permission Format: resource:action:scope
 * - resource: fir, user, role, permission, tenant, analytics, mud, backup
 * - action: create, read, update, delete, assign, revoke, export
 * - scope: own, facility, all
 */
@Pipe({
  name: 'permissionFormat',
  standalone: true,
})
export class PermissionFormatPipe implements PipeTransform {
  /**
   * Resource display names
   */
  private readonly resourceNames: Record<string, string> = {
    fir: 'FIR',
    user: 'user',
    role: 'role',
    permission: 'permission',
    tenant: 'tenant',
    analytics: 'analytics',
    mud: 'MUD report',
    backup: 'backup',
  }

  /**
   * Action display names (verbs)
   */
  private readonly actionNames: Record<string, string> = {
    create: 'Create',
    read: 'View',
    update: 'Edit',
    delete: 'Delete',
    assign: 'Assign',
    revoke: 'Revoke',
    export: 'Export',
  }

  /**
   * Scope display descriptions
   */
  private readonly scopeDescriptions: Record<string, string> = {
    own: 'own',
    facility: 'for assigned facilities',
    all: '',
  }

  /**
   * Special plural forms for resources
   */
  private readonly resourcePlurals: Record<string, string> = {
    fir: 'FIRs',
    user: 'users',
    role: 'roles',
    permission: 'permissions',
    tenant: 'tenants',
    analytics: 'analytics data',
    mud: 'MUD reports',
    backup: 'system backups',
  }

  /**
   * Transform permission string to human-readable format
   *
   * @param permission Permission string (e.g., "fir:create:facility")
   * @param mode Format mode: "long" (default) or "short"
   * @returns Human-readable permission description
   */
  transform(permission: string, mode: 'long' | 'short' = 'long'): string {
    // Validation
    if (!permission || typeof permission !== 'string') {
      return 'Invalid permission format'
    }

    // Parse permission parts
    const parts = permission.split(':')
    if (parts.length !== 3) {
      return 'Invalid permission format'
    }

    const [resource, action, scope] = parts

    // Get display names
    const actionName = this.actionNames[action] || this.capitalizeFirst(action)
    const resourceName = this.getResourceName(resource, action)
    const scopeDesc = mode === 'long' ? this.scopeDescriptions[scope] || '' : ''

    // Build description
    let description = `${actionName} ${resourceName}`

    // Add scope description if in long mode and scope has description
    if (mode === 'long' && scopeDesc) {
      description += ` ${scopeDesc}`
    }

    return description.trim()
  }

  /**
   * Get appropriate resource name (singular or plural) based on action
   */
  private getResourceName(resource: string, action: string): string {
    // Read and export actions typically use plural
    // Create, update, delete use singular or context-dependent
    const usePlural = ['read', 'export', 'assign', 'revoke'].includes(action)

    if (usePlural && this.resourcePlurals[resource]) {
      return this.resourcePlurals[resource]
    }

    if (action === 'create' && this.resourcePlurals[resource]) {
      return this.resourcePlurals[resource]
    }

    return this.resourceNames[resource] || resource
  }

  /**
   * Capitalize first letter of string
   */
  private capitalizeFirst(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1)
  }
}
