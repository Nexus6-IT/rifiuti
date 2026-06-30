import { randomUUID } from 'crypto'

/**
 * ConsultantTenantAssociation Domain Entity
 * Represents the relationship between an environmental consultant and a client tenant
 * Per plan.md: Consultants can manage 50+ client tenants with seamless context switching
 *
 * Business Rules (from T095 tests):
 * - Consultant can be associated with multiple tenants
 * - Association can expire (optional expiration date)
 * - Association can be deactivated without deletion
 * - Cannot create duplicate active associations (enforced at DB level)
 * - Expired associations are automatically considered inactive
 * - Can extend expiration date, but not shorten it
 * - Cannot reactivate expired associations
 *
 * Aggregate Root: ConsultantTenantAssociation
 */
export class ConsultantTenantAssociation {
  constructor(
    public readonly id: string,
    public readonly consultantUserId: string,
    public readonly tenantId: string,
    public readonly roleId: string,
    public readonly addedBy: string,
    public readonly addedAt: Date,
    public expiresAt: Date | null,
    public isActive: boolean
  ) {}

  /**
   * Factory method to create new consultant-tenant association
   * Enforces business rules at creation time
   */
  static create(data: {
    consultantUserId: string
    tenantId: string
    roleId: string
    addedBy: string
    expiresAt: Date | null
  }): ConsultantTenantAssociation {
    // Validation: Consultant user ID is required
    if (!data.consultantUserId || data.consultantUserId.trim() === '') {
      throw new Error('Consultant user ID is required')
    }

    // Validation: Tenant ID is required
    if (!data.tenantId || data.tenantId.trim() === '') {
      throw new Error('Tenant ID is required')
    }

    // Validation: Role ID is required
    if (!data.roleId || data.roleId.trim() === '') {
      throw new Error('Role ID is required')
    }

    // Validation: Added by is required
    if (!data.addedBy || data.addedBy.trim() === '') {
      throw new Error('Added by user ID is required')
    }

    // Validation: Expiration date cannot be in the past
    if (data.expiresAt && data.expiresAt.getTime() < Date.now()) {
      throw new Error('Expiration date cannot be in the past')
    }

    return new ConsultantTenantAssociation(
      randomUUID(),
      data.consultantUserId,
      data.tenantId,
      data.roleId,
      data.addedBy,
      new Date(),
      data.expiresAt,
      true // Associations are active by default
    )
  }

  /**
   * Factory method to reconstitute entity from persistence
   */
  static fromPersistence(data: {
    id: string
    consultantUserId: string
    tenantId: string
    roleId: string
    addedBy: string
    addedAt: Date
    expiresAt: Date | null
    isActive: boolean
  }): ConsultantTenantAssociation {
    return new ConsultantTenantAssociation(
      data.id,
      data.consultantUserId,
      data.tenantId,
      data.roleId,
      data.addedBy,
      data.addedAt,
      data.expiresAt,
      data.isActive
    )
  }

  /**
   * Check if association is expired
   * Per plan.md: Expired associations are automatically inactive
   */
  isExpired(): boolean {
    if (!this.expiresAt) {
      return false // No expiration date means never expires
    }

    return this.expiresAt.getTime() < Date.now()
  }

  /**
   * Deactivate association
   * Per spec.md: Admin can deactivate consultant access without deletion
   */
  deactivate(): void {
    if (!this.isActive) {
      throw new Error('Association is already inactive')
    }

    this.isActive = false
  }

  /**
   * Reactivate association
   * Business rule: Cannot reactivate expired associations
   */
  reactivate(): void {
    if (this.isActive) {
      throw new Error('Association is already active')
    }

    if (this.isExpired()) {
      throw new Error('Cannot reactivate expired association')
    }

    this.isActive = true
  }

  /**
   * Extend expiration date
   * Business rule: Can only extend, not shorten expiration
   */
  extendExpiration(newExpiresAt: Date): void {
    if (!newExpiresAt) {
      throw new Error('New expiration date is required')
    }

    // If current expiration exists, new date must be after it
    if (this.expiresAt && newExpiresAt.getTime() <= this.expiresAt.getTime()) {
      throw new Error('New expiration date must be after current expiration')
    }

    // New expiration must be in the future
    if (newExpiresAt.getTime() < Date.now()) {
      throw new Error('New expiration date must be in the future')
    }

    this.expiresAt = newExpiresAt
  }

  /**
   * Check if association is active AND not expired
   * Per plan.md: Context switching requires active, non-expired association
   */
  isActiveAndNotExpired(): boolean {
    return this.isActive && !this.isExpired()
  }

  /**
   * Convert to persistence format
   */
  toPersistence(): {
    id: string
    consultantUserId: string
    tenantId: string
    roleId: string
    addedBy: string
    addedAt: Date
    expiresAt: Date | null
    isActive: boolean
  } {
    return {
      id: this.id,
      consultantUserId: this.consultantUserId,
      tenantId: this.tenantId,
      roleId: this.roleId,
      addedBy: this.addedBy,
      addedAt: this.addedAt,
      expiresAt: this.expiresAt,
      isActive: this.isActive,
    }
  }

  /**
   * Get days until expiration
   * Useful for UI display and warning notifications
   */
  getDaysUntilExpiration(): number | null {
    if (!this.expiresAt) {
      return null // Never expires
    }

    const now = Date.now()
    const expiry = this.expiresAt.getTime()

    if (expiry < now) {
      return 0 // Already expired
    }

    const msPerDay = 1000 * 60 * 60 * 24
    const daysRemaining = Math.ceil((expiry - now) / msPerDay)

    return daysRemaining
  }

  /**
   * Check if association is expiring soon
   * Per spec.md: Warning when <30 days remaining
   */
  isExpiringSoon(warningThresholdDays: number = 30): boolean {
    const daysRemaining = this.getDaysUntilExpiration()

    if (daysRemaining === null) {
      return false // Never expires
    }

    return daysRemaining > 0 && daysRemaining <= warningThresholdDays
  }
}
