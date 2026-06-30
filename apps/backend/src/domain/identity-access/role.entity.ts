import { randomUUID } from 'crypto'

/**
 * Role Domain Entity
 * Represents a role in the system with business rules enforcement
 * Per plan.md FR-004: Five system roles (ADMIN, OPERATOR, VIEWER, CONSULTANT, COMPLIANCE_OFFICER)
 *
 * Business Rules:
 * - System roles cannot be deleted or modified
 * - Role names must be unique per tenant
 * - Role names must be uppercase alphanumeric with underscores
 * - Cannot delete role if it's the last ADMIN in tenant
 */
export class Role {
  private constructor(
    public readonly id: string,
    public readonly tenantId: string,
    public readonly name: string,
    public description: string | null,
    public readonly isSystemRole: boolean,
    public readonly createdBy: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public isDeleted: boolean = false
  ) {}

  /**
   * Create new role
   */
  static create(data: {
    tenantId: string
    name: string
    description: string | null
    isSystemRole: boolean
    createdBy: string
  }): Role {
    // Validate tenant ID
    if (!data.tenantId || data.tenantId.trim() === '') {
      throw new Error('Tenant ID is required')
    }

    // Validate name
    if (!data.name || data.name.trim() === '') {
      throw new Error('Role name cannot be empty')
    }

    if (data.name.length > 100) {
      throw new Error('Role name cannot exceed 100 characters')
    }

    // Normalize name to uppercase
    const normalizedName = data.name.toUpperCase()

    // Validate name format (only letters, numbers, underscores)
    const nameRegex = /^[A-Z0-9_]+$/
    if (!nameRegex.test(normalizedName)) {
      throw new Error('Role name can only contain letters, numbers, and underscores')
    }

    // Validate createdBy
    if (!data.createdBy || data.createdBy.trim() === '') {
      throw new Error('Creator user ID is required')
    }

    const now = new Date()

    return new Role(
      randomUUID(),
      data.tenantId,
      normalizedName,
      data.description,
      data.isSystemRole,
      data.createdBy,
      now,
      now,
      false
    )
  }

  /**
   * Reconstruct role from persistence
   */
  static fromPersistence(data: {
    id: string
    tenantId: string
    name: string
    description: string | null
    isSystemRole: boolean
    createdBy: string
    createdAt: Date
    updatedAt: Date
    isDeleted?: boolean
  }): Role {
    return new Role(
      data.id,
      data.tenantId,
      data.name,
      data.description,
      data.isSystemRole,
      data.createdBy,
      data.createdAt,
      data.updatedAt,
      data.isDeleted || false
    )
  }

  /**
   * Update role description
   * Only allowed for custom roles (not system roles)
   */
  updateDescription(newDescription: string): void {
    if (this.isSystemRole) {
      throw new Error('System roles cannot be modified')
    }

    this.description = newDescription
    this.updatedAt = new Date()
  }

  /**
   * Mark role as deleted
   * Only allowed for custom roles (not system roles)
   */
  markAsDeleted(): void {
    if (this.isSystemRole) {
      throw new Error('System roles cannot be deleted')
    }

    if (this.isDeleted) {
      throw new Error('Role is already deleted')
    }

    this.isDeleted = true
    this.updatedAt = new Date()
  }

  /**
   * Check if role is active (not deleted)
   */
  isActive(): boolean {
    return !this.isDeleted
  }

  /**
   * Convert to persistence format
   */
  toPersistence(): {
    id: string
    tenantId: string
    name: string
    description: string | null
    isSystemRole: boolean
    createdBy: string
    createdAt: Date
    updatedAt: Date
  } {
    return {
      id: this.id,
      tenantId: this.tenantId,
      name: this.name,
      description: this.description,
      isSystemRole: this.isSystemRole,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    }
  }
}
