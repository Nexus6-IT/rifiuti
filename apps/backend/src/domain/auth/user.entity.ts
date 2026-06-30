import { DomainException } from '../shared/domain-exception'
import { FiscalCode } from '../shared/fiscal-code.vo'
import { Email } from '../shared/email.vo'
import { SPIDAttributes } from './spid-attributes.vo'
import { AggregateRoot } from '../shared/aggregate-root'
import { UserCreatedEvent } from './events/user-created.event'

/**
 * User Aggregate Root
 *
 * Represents a user in the WasteFlow system with SPID/CIE authentication.
 * Manages user identity, SPID authentication attributes, and authorization.
 *
 * Business Rules:
 * - User must have valid Italian fiscal code
 * - User can belong to one or more tenants (multi-tenant support)
 * - User can sign documents only with SPID Level 2+ and recent authentication (<15 min)
 * - User roles determine access permissions
 *
 * Invariants:
 * - Fiscal code is immutable
 * - SPID attributes can be updated on re-authentication
 * - Roles can be added/removed dynamically
 */
export class User extends AggregateRoot {
  private id: string
  private fiscalCode: string
  private firstName: string
  private lastName: string
  private email: string
  private tenantId: string // Primary tenant
  private spidAttributes?: SPIDAttributes
  private roles: string[]
  private isActive: boolean
  private createdAt: Date
  private updatedAt: Date

  private constructor(
    id: string,
    fiscalCode: string,
    firstName: string,
    lastName: string,
    email: string,
    tenantId: string,
    spidAttributes?: SPIDAttributes,
    roles: string[] = [],
    isActive: boolean = true,
    createdAt?: Date,
    updatedAt?: Date
  ) {
    super()
    this.id = id
    this.fiscalCode = fiscalCode
    this.firstName = firstName
    this.lastName = lastName
    this.email = email
    this.tenantId = tenantId
    this.spidAttributes = spidAttributes
    this.roles = roles
    this.isActive = isActive
    this.createdAt = createdAt || new Date()
    this.updatedAt = updatedAt || new Date()
  }

  /**
   * Create new user
   */
  static create(params: {
    id: string
    fiscalCode: string
    firstName: string
    lastName: string
    email: string
    tenantId: string
    spidAttributes?: SPIDAttributes
    roles?: string[]
    isActive?: boolean
  }): User {
    // Validate fiscal code
    if (!params.fiscalCode || !FiscalCode.isValid(params.fiscalCode)) {
      throw DomainException.validationFailed(
        'INVALID_FISCAL_CODE',
        `Invalid Italian fiscal code: ${params.fiscalCode}`
      )
    }

    // Validate email
    if (!params.email || !Email.isValid(params.email)) {
      throw DomainException.validationFailed(
        'INVALID_EMAIL',
        `Invalid email address: ${params.email}`
      )
    }

    // Validate required fields
    if (!params.firstName || params.firstName.trim() === '') {
      throw DomainException.validationFailed('MISSING_FIRST_NAME', 'First name is required')
    }

    if (!params.lastName || params.lastName.trim() === '') {
      throw DomainException.validationFailed('MISSING_LAST_NAME', 'Last name is required')
    }

    if (!params.tenantId || params.tenantId.trim() === '') {
      throw DomainException.validationFailed('MISSING_TENANT_ID', 'Tenant ID is required')
    }

    const user = new User(
      params.id,
      params.fiscalCode.trim().toUpperCase(),
      params.firstName.trim(),
      params.lastName.trim(),
      params.email.trim().toLowerCase(),
      params.tenantId.trim(),
      params.spidAttributes,
      params.roles || [],
      params.isActive !== undefined ? params.isActive : true
    )

    // Emit domain event for new user creation
    user.addDomainEvent(
      new UserCreatedEvent({
        aggregateId: user.id,
        userId: user.id,
        fiscalCode: user.fiscalCode,
        email: user.email,
        tenantId: user.tenantId,
        hasSpidAuth: !!user.spidAttributes,
      })
    )

    return user
  }

  /**
   * Business Rule: User can sign documents only with SPID Level 2+
   * and recent authentication (within 15 minutes)
   */
  canSignDocuments(): boolean {
    if (!this.spidAttributes) {
      return false
    }

    // Must have SPID Level 2 or higher
    if (!this.spidAttributes.canSignDocuments()) {
      return false
    }

    // Authentication must be recent (within 15 minutes)
    if (!this.spidAttributes.isAuthenticationRecent()) {
      return false
    }

    return true
  }

  /**
   * Check if user has recent SPID authentication
   */
  hasRecentSpidAuth(): boolean {
    if (!this.spidAttributes) {
      return false
    }

    return this.spidAttributes.isAuthenticationRecent()
  }

  /**
   * Check if user has SPID authentication at all
   */
  hasSpidAuthentication(): boolean {
    return !!this.spidAttributes
  }

  /**
   * Update SPID authentication attributes
   * Called when user re-authenticates via SPID
   */
  updateSpidAuthentication(spidAttributes: SPIDAttributes): void {
    // Verify fiscal code matches
    if (spidAttributes.getFiscalCode() !== this.fiscalCode) {
      throw DomainException.businessRuleViolation(
        'FISCAL_CODE_MISMATCH',
        'SPID fiscal code does not match user fiscal code'
      )
    }

    this.spidAttributes = spidAttributes
    this.updatedAt = new Date()

    // Update email if changed
    const newEmail = spidAttributes.getEmail()
    if (newEmail !== this.email) {
      this.email = newEmail
    }
  }

  /**
   * Clear SPID authentication (logout)
   */
  clearSpidAuthentication(): void {
    this.spidAttributes = undefined
    this.updatedAt = new Date()
  }

  /**
   * Check if user has a specific role
   */
  hasRole(role: string): boolean {
    return this.roles.includes(role)
  }

  /**
   * Add role to user
   */
  addRole(role: string): void {
    if (!this.roles.includes(role)) {
      this.roles.push(role)
      this.updatedAt = new Date()
    }
  }

  /**
   * Remove role from user
   */
  removeRole(role: string): void {
    const index = this.roles.indexOf(role)
    if (index > -1) {
      this.roles.splice(index, 1)
      this.updatedAt = new Date()
    }
  }

  /**
   * Deactivate user
   */
  deactivate(): void {
    this.isActive = false
    this.updatedAt = new Date()
  }

  /**
   * Activate user
   */
  activate(): void {
    this.isActive = true
    this.updatedAt = new Date()
  }

  // Getters
  getId(): string {
    return this.id
  }

  getFiscalCode(): string {
    return this.fiscalCode
  }

  getFirstName(): string {
    return this.firstName
  }

  getLastName(): string {
    return this.lastName
  }

  getFullName(): string {
    return `${this.firstName} ${this.lastName}`
  }

  getEmail(): string {
    return this.email
  }

  getTenantId(): string {
    return this.tenantId
  }

  getSpidAttributes(): SPIDAttributes | undefined {
    return this.spidAttributes
  }

  getRoles(): string[] {
    return [...this.roles] // Return copy to prevent mutation
  }

  getIsActive(): boolean {
    return this.isActive
  }

  getCreatedAt(): Date {
    return this.createdAt
  }

  getUpdatedAt(): Date {
    return this.updatedAt
  }

  /**
   * Get SPID level (0 if no SPID auth)
   */
  getSpidLevel(): number {
    return this.spidAttributes?.getSpidLevel() || 0
  }
}
