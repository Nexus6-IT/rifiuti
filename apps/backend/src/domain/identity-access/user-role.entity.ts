import { randomUUID } from 'crypto'

/**
 * UserRole Domain Entity
 * Represents assignment of a role to a user
 * Per plan.md FR-006, FR-007
 *
 * Business Rules:
 * - UserRole must have userId, roleId, and tenantId
 * - Can have expiration date (for temporary assignments)
 * - Can be facility-scoped (limited to specific facilities)
 * - Can be delegated with business justification
 * - Must track who assigned the role and when
 */
export class UserRole {
  private constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly roleId: string,
    public readonly tenantId: string,
    public readonly assignedBy: string,
    public readonly assignedAt: Date,
    public readonly expiresAt: Date | null,
    public readonly facilityIds: string[] | null,
    public readonly isDelegated: boolean,
    public readonly delegationReason: string | null,
    private _isRevoked: boolean = false
  ) {}

  /**
   * Create new user role assignment
   */
  static create(data: {
    userId: string
    roleId: string
    tenantId: string
    assignedBy: string
    expiresAt?: Date | null
    facilityIds?: string[] | null
    isDelegated?: boolean
    delegationReason?: string | null
  }): UserRole {
    // Validate userId
    if (!data.userId || data.userId.trim() === '') {
      throw new Error('User ID is required')
    }

    // Validate roleId
    if (!data.roleId || data.roleId.trim() === '') {
      throw new Error('Role ID is required')
    }

    // Validate tenantId
    if (!data.tenantId || data.tenantId.trim() === '') {
      throw new Error('Tenant ID is required')
    }

    // Validate assignedBy
    if (!data.assignedBy || data.assignedBy.trim() === '') {
      throw new Error('Assigned by user ID is required')
    }

    // Validate expiration date is in future
    if (data.expiresAt && data.expiresAt.getTime() <= Date.now()) {
      throw new Error('Expiration date must be in the future')
    }

    // Validate delegation reason if delegated
    const isDelegated = data.isDelegated || false
    const delegationReason = data.delegationReason || null

    if (isDelegated && (!delegationReason || delegationReason.trim() === '')) {
      throw new Error('Delegation reason is required for delegated roles')
    }

    return new UserRole(
      randomUUID(),
      data.userId,
      data.roleId,
      data.tenantId,
      data.assignedBy,
      new Date(),
      data.expiresAt || null,
      data.facilityIds || null,
      isDelegated,
      delegationReason,
      false
    )
  }

  /**
   * Reconstruct user role from persistence
   */
  static fromPersistence(data: {
    id: string
    userId: string
    roleId: string
    tenantId: string
    assignedBy: string
    assignedAt: Date
    expiresAt: Date | null
    facilityIds: string[] | null
    isDelegated: boolean
    delegationReason: string | null
  }): UserRole {
    return new UserRole(
      data.id,
      data.userId,
      data.roleId,
      data.tenantId,
      data.assignedBy,
      data.assignedAt,
      data.expiresAt,
      data.facilityIds,
      data.isDelegated,
      data.delegationReason,
      false
    )
  }

  /**
   * Check if user role is expired
   */
  isExpired(): boolean {
    if (!this.expiresAt) {
      return false // No expiration date = never expires
    }

    return this.expiresAt.getTime() <= Date.now()
  }

  /**
   * Check if user role is permanent (no expiration)
   */
  isPermanent(): boolean {
    return this.expiresAt === null
  }

  /**
   * Check if user role is facility-scoped
   */
  isFacilityScoped(): boolean {
    return this.facilityIds !== null && this.facilityIds.length > 0
  }

  /**
   * Check if role applies to specific facility
   * Returns true if:
   * - Role is not facility-scoped (applies to all facilities)
   * - Role is facility-scoped and includes the specified facility
   */
  appliesToFacility(facilityId: string): boolean {
    if (!this.isFacilityScoped()) {
      return true // Not facility-scoped = applies to all facilities
    }

    return this.facilityIds!.includes(facilityId)
  }

  /**
   * Check if user role is revoked
   */
  isRevoked(): boolean {
    return this._isRevoked
  }

  /**
   * Revoke user role
   */
  revoke(): void {
    if (this._isRevoked) {
      throw new Error('User role is already revoked')
    }

    this._isRevoked = true
  }

  /**
   * Check if user role is active
   * Active = not expired AND not revoked
   */
  isActive(): boolean {
    return !this.isExpired() && !this.isRevoked()
  }

  /**
   * Convert to persistence format
   */
  toPersistence(): {
    id: string
    userId: string
    roleId: string
    tenantId: string
    assignedBy: string
    assignedAt: Date
    expiresAt: Date | null
    facilityIds: string[] | null
    isDelegated: boolean
    delegationReason: string | null
  } {
    return {
      id: this.id,
      userId: this.userId,
      roleId: this.roleId,
      tenantId: this.tenantId,
      assignedBy: this.assignedBy,
      assignedAt: this.assignedAt,
      expiresAt: this.expiresAt,
      facilityIds: this.facilityIds,
      isDelegated: this.isDelegated,
      delegationReason: this.delegationReason,
    }
  }
}
