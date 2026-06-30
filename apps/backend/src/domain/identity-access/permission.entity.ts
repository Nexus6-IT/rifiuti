import { randomUUID } from 'crypto'

/**
 * Permission Domain Entity
 * Represents an atomic permission in resource:action:scope format
 * Per plan.md FR-001, FR-002
 *
 * Business Rules:
 * - Format must be "resource:action:scope"
 * - Scope must be one of: own, facility, all
 * - Resource and action cannot be empty
 * - Sensitive permissions must be flagged
 */
export class Permission {
  private static readonly VALID_SCOPES = ['own', 'facility', 'all']
  private static readonly SCOPE_LEVELS = { own: 0, facility: 1, all: 2 }

  private constructor(
    public readonly id: string,
    public readonly resource: string,
    public readonly action: string,
    public readonly scope: string,
    public description: string,
    public readonly isSensitive: boolean,
    public readonly module: string,
    public readonly createdAt: Date,
    public updatedAt: Date
  ) {}

  /**
   * Create new permission
   */
  static create(data: {
    resource: string
    action: string
    scope: string
    description: string
    isSensitive: boolean
    module: string
  }): Permission {
    // Validate resource
    if (!data.resource || data.resource.trim() === '') {
      throw new Error('Resource cannot be empty')
    }

    // Validate action
    if (!data.action || data.action.trim() === '') {
      throw new Error('Action cannot be empty')
    }

    // Validate scope
    if (!Permission.VALID_SCOPES.includes(data.scope)) {
      throw new Error(`Scope must be one of: ${Permission.VALID_SCOPES.join(', ')}`)
    }

    const now = new Date()

    return new Permission(
      randomUUID(),
      data.resource.toLowerCase(),
      data.action.toLowerCase(),
      data.scope,
      data.description,
      data.isSensitive,
      data.module,
      now,
      now
    )
  }

  /**
   * Create permission from string format "resource:action:scope"
   */
  static fromString(permissionString: string, description: string, module: string): Permission {
    const parts = permissionString.split(':')

    if (parts.length !== 3) {
      throw new Error('Invalid permission format. Expected: resource:action:scope')
    }

    const [resource, action, scope] = parts

    if (!resource || !action || !scope) {
      throw new Error('Invalid permission format. Expected: resource:action:scope')
    }

    // Auto-detect sensitive permissions
    const sensitiveActions = ['delete', 'approve', 'configure']
    const isSensitive = sensitiveActions.includes(action.toLowerCase())

    return Permission.create({
      resource,
      action,
      scope,
      description,
      isSensitive,
      module,
    })
  }

  /**
   * Reconstruct permission from persistence
   */
  static fromPersistence(data: {
    id: string
    resource: string
    action: string
    scope: string
    description: string
    isSensitive: boolean
    module: string
    createdAt: Date
    updatedAt: Date
  }): Permission {
    return new Permission(
      data.id,
      data.resource,
      data.action,
      data.scope,
      data.description,
      data.isSensitive,
      data.module,
      data.createdAt,
      data.updatedAt
    )
  }

  /**
   * Convert permission to string format "resource:action:scope"
   */
  toString(): string {
    return `${this.resource}:${this.action}:${this.scope}`
  }

  /**
   * Check if this permission equals another
   * Equality is based on resource, action, and scope
   */
  equals(other: Permission): boolean {
    return (
      this.resource === other.resource && this.action === other.action && this.scope === other.scope
    )
  }

  /**
   * Get scope level (0=own, 1=facility, 2=all)
   */
  getScopeLevel(): number {
    return Permission.SCOPE_LEVELS[this.scope as keyof typeof Permission.SCOPE_LEVELS] || 0
  }

  /**
   * Check if this permission implies another permission
   * Based on scope hierarchy: own < facility < all
   *
   * Example: fir:read:all implies fir:read:facility and fir:read:own
   */
  implies(other: Permission): boolean {
    // Must match resource and action
    if (this.resource !== other.resource || this.action !== other.action) {
      return false
    }

    // Check scope hierarchy
    const thisScopeLevel = this.getScopeLevel()
    const otherScopeLevel = other.getScopeLevel()

    return thisScopeLevel >= otherScopeLevel
  }

  /**
   * Convert to persistence format
   */
  toPersistence(): {
    id: string
    resource: string
    action: string
    scope: string
    description: string
    isSensitive: boolean
    module: string
    createdAt: Date
    updatedAt: Date
  } {
    return {
      id: this.id,
      resource: this.resource,
      action: this.action,
      scope: this.scope,
      description: this.description,
      isSensitive: this.isSensitive,
      module: this.module,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    }
  }
}
