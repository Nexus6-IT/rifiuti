import { v4 as uuidv4 } from 'uuid'

/**
 * ResourceOwnership Entity
 * T182: Domain entity for User Story 6 - Task Assignment Automation
 *
 * Purpose: Track which users own/have access to which resources
 *
 * Requirements from spec.md FR-029-032:
 * - Track vehicle assignments for drivers
 * - Track facility assignments for operators
 * - Track zone-based routing assignments
 * - Support certification tracking (ADR, Hazmat, etc.)
 * - Support capacity tracking for vehicles
 * - Support expiration dates for temporary assignments
 *
 * Requirements from plan.md:
 * - Immutable once created (except deactivation)
 * - Support multiple resource types (vehicle, facility, zone, route)
 * - Track assignment metadata (assigned by, reason, expiration)
 * - Audit trail (createdAt, createdBy, revokedAt, revokedBy)
 */

export interface ResourceOwnershipProps {
  id?: string
  userId: string
  tenantId: string
  resourceType: string // vehicle, facility, zone, route
  resourceId: string
  assignedBy: string
  assignedAt?: Date
  expiresAt?: Date
  isActive?: boolean
  revokedBy?: string
  revokedAt?: Date
  revocationReason?: string
  reason?: string
  metadata?: Record<string, any> // certifications, capacity, zone, etc.
}

export class ResourceOwnership {
  private readonly _id: string
  private readonly _userId: string
  private readonly _tenantId: string
  private readonly _resourceType: string
  private readonly _resourceId: string
  private readonly _assignedBy: string
  private readonly _assignedAt: Date
  private readonly _expiresAt: Date | null
  private _isActive: boolean
  private _revokedBy: string | null
  private _revokedAt: Date | null
  private _revocationReason: string | null
  private readonly _reason?: string
  private readonly _metadata?: Record<string, any>

  private constructor(props: ResourceOwnershipProps) {
    // Validate required fields
    if (!props.userId || props.userId.trim() === '') {
      throw new Error('userId is required')
    }
    if (!props.tenantId || props.tenantId.trim() === '') {
      throw new Error('tenantId is required')
    }
    if (!props.resourceType || props.resourceType.trim() === '') {
      throw new Error('resourceType is required')
    }
    if (!props.resourceId || props.resourceId.trim() === '') {
      throw new Error('resourceId is required')
    }

    this._id = props.id || uuidv4()
    this._userId = props.userId
    this._tenantId = props.tenantId
    this._resourceType = props.resourceType
    this._resourceId = props.resourceId
    this._assignedBy = props.assignedBy
    this._assignedAt = props.assignedAt || new Date()
    this._expiresAt = props.expiresAt || null
    this._isActive = props.isActive !== undefined ? props.isActive : true
    this._revokedBy = props.revokedBy || null
    this._revokedAt = props.revokedAt || null
    this._revocationReason = props.revocationReason || null
    this._reason = props.reason
    this._metadata = props.metadata

    // Note: Not using Object.freeze() to allow deactivation mutations
  }

  /**
   * Factory method to create new ResourceOwnership
   */
  static create(props: ResourceOwnershipProps): ResourceOwnership {
    return new ResourceOwnership(props)
  }

  /**
   * Reconstruct from persistence
   */
  static fromPersistence(data: any): ResourceOwnership {
    return new ResourceOwnership({
      id: data.id,
      userId: data.userId,
      tenantId: data.tenantId,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      assignedBy: data.assignedBy,
      assignedAt: data.assignedAt,
      expiresAt: data.expiresAt,
      isActive: data.isActive,
      revokedBy: data.revokedBy,
      revokedAt: data.revokedAt,
      revocationReason: data.revocationReason,
      reason: data.reason,
      metadata: data.metadata,
    })
  }

  /**
   * Convert to persistence format
   */
  toPersistence(): any {
    return {
      id: this._id,
      userId: this._userId,
      tenantId: this._tenantId,
      resourceType: this._resourceType,
      resourceId: this._resourceId,
      assignedBy: this._assignedBy,
      assignedAt: this._assignedAt,
      expiresAt: this._expiresAt,
      isActive: this._isActive,
      revokedBy: this._revokedBy,
      revokedAt: this._revokedAt,
      revocationReason: this._revocationReason,
      reason: this._reason,
      metadata: this._metadata,
    }
  }

  /**
   * Check if ownership is expired
   */
  isExpired(): boolean {
    if (!this._expiresAt) {
      return false
    }

    return new Date() > this._expiresAt
  }

  /**
   * Check if ownership is active and not expired
   */
  isActiveAndNotExpired(): boolean {
    return this._isActive && !this.isExpired()
  }

  /**
   * Deactivate ownership
   */
  deactivate(revokedBy: string, reason: string): void {
    if (!this._isActive) {
      throw new Error('Ownership is already inactive')
    }

    // Mutate state (allowed for deactivation)
    this._isActive = false
    this._revokedBy = revokedBy
    this._revokedAt = new Date()
    this._revocationReason = reason
  }

  // Getters
  get id(): string {
    return this._id
  }

  get userId(): string {
    return this._userId
  }

  get tenantId(): string {
    return this._tenantId
  }

  get resourceType(): string {
    return this._resourceType
  }

  get resourceId(): string {
    return this._resourceId
  }

  get assignedBy(): string {
    return this._assignedBy
  }

  get assignedAt(): Date {
    return this._assignedAt
  }

  get expiresAt(): Date | null {
    return this._expiresAt
  }

  get isActive(): boolean {
    return this._isActive
  }

  get revokedBy(): string | null {
    return this._revokedBy
  }

  get revokedAt(): Date | null {
    return this._revokedAt
  }

  get revocationReason(): string | null {
    return this._revocationReason
  }

  get reason(): string | undefined {
    return this._reason
  }

  get metadata(): Record<string, any> | undefined {
    return this._metadata
  }
}
