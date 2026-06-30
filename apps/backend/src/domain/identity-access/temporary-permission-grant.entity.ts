import { v4 as uuidv4 } from 'uuid'

/**
 * TemporaryPermissionGrant Entity
 * T197: Domain entity for User Story 7 - Temporary Permission Requests
 *
 * Purpose: Manage time-limited permission elevation for consultants
 *
 * Requirements from spec.md FR-033-036:
 * - Time-bound permissions (start and end time)
 * - Maximum 7 days duration
 * - Maximum 10 permissions per grant
 * - Approval/rejection workflow
 * - Manual revocation support
 * - Auto-expire after end time
 *
 * Requirements from plan.md:
 * - Immutable once approved (except revocation)
 * - Track full audit trail
 * - Validate time bounds
 * - Require justification
 */

export type GrantStatus = 'pending' | 'approved' | 'rejected' | 'revoked'

export interface TemporaryPermissionGrantProps {
  id?: string
  userId: string
  tenantId: string
  permissions: string[] // Array of permission strings like "fir:export:all"
  startTime: Date
  endTime: Date
  justification: string
  requestedBy: string
  requestedAt?: Date
  status?: GrantStatus
  approvedBy?: string
  approvedAt?: Date
  approvalReason?: string
  revokedBy?: string
  revokedAt?: Date
  revocationReason?: string
}

export class TemporaryPermissionGrant {
  private readonly _id: string
  private readonly _userId: string
  private readonly _tenantId: string
  private readonly _permissions: string[]
  private readonly _startTime: Date
  private readonly _endTime: Date
  private readonly _justification: string
  private readonly _requestedBy: string
  private readonly _requestedAt: Date
  private _status: GrantStatus
  private _approvedBy: string | null
  private _approvedAt: Date | null
  private _approvalReason: string | null
  private _revokedBy: string | null
  private _revokedAt: Date | null
  private _revocationReason: string | null

  private constructor(props: TemporaryPermissionGrantProps) {
    // Validate required fields
    if (!props.userId || props.userId.trim() === '') {
      throw new Error('userId is required')
    }
    if (!props.tenantId || props.tenantId.trim() === '') {
      throw new Error('tenantId is required')
    }
    if (!props.permissions || props.permissions.length === 0) {
      throw new Error('At least 1 permission is required')
    }
    if (props.permissions.length > 10) {
      throw new Error('Maximum 10 permissions allowed')
    }
    if (!props.justification || props.justification.trim() === '') {
      throw new Error('Justification is required')
    }

    // Validate time bounds
    if (props.endTime <= props.startTime) {
      throw new Error('endTime must be after startTime')
    }

    // Validate duration (max 7 days)
    const durationMs = props.endTime.getTime() - props.startTime.getTime()
    const maxDurationMs = 7 * 24 * 60 * 60 * 1000 // 7 days in milliseconds
    if (durationMs > maxDurationMs) {
      throw new Error('Grant duration cannot exceed 7 days')
    }

    this._id = props.id || uuidv4()
    this._userId = props.userId
    this._tenantId = props.tenantId
    this._permissions = props.permissions
    this._startTime = props.startTime
    this._endTime = props.endTime
    this._justification = props.justification
    this._requestedBy = props.requestedBy
    this._requestedAt = props.requestedAt || new Date()
    this._status = props.status || 'pending'
    this._approvedBy = props.approvedBy || null
    this._approvedAt = props.approvedAt || null
    this._approvalReason = props.approvalReason || null
    this._revokedBy = props.revokedBy || null
    this._revokedAt = props.revokedAt || null
    this._revocationReason = props.revocationReason || null
  }

  /**
   * Factory method to create new TemporaryPermissionGrant
   */
  static create(props: TemporaryPermissionGrantProps): TemporaryPermissionGrant {
    return new TemporaryPermissionGrant(props)
  }

  /**
   * Reconstruct from persistence
   */
  static fromPersistence(data: any): TemporaryPermissionGrant {
    return new TemporaryPermissionGrant({
      id: data.id,
      userId: data.userId,
      tenantId: data.tenantId,
      permissions: data.permissions,
      startTime: data.startTime,
      endTime: data.endTime,
      justification: data.justification,
      requestedBy: data.requestedBy,
      requestedAt: data.requestedAt,
      status: data.status,
      approvedBy: data.approvedBy,
      approvedAt: data.approvedAt,
      approvalReason: data.approvalReason,
      revokedBy: data.revokedBy,
      revokedAt: data.revokedAt,
      revocationReason: data.revocationReason,
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
      permissions: this._permissions,
      startTime: this._startTime,
      endTime: this._endTime,
      justification: this._justification,
      requestedBy: this._requestedBy,
      requestedAt: this._requestedAt,
      status: this._status,
      approvedBy: this._approvedBy,
      approvedAt: this._approvedAt,
      approvalReason: this._approvalReason,
      revokedBy: this._revokedBy,
      revokedAt: this._revokedAt,
      revocationReason: this._revocationReason,
    }
  }

  /**
   * Approve the grant
   */
  approve(approvedBy: string, reason: string): void {
    if (this._status === 'approved' || this._status === 'rejected') {
      throw new Error('Grant has already been approved or rejected')
    }

    this._status = 'approved'
    this._approvedBy = approvedBy
    this._approvedAt = new Date()
    this._approvalReason = reason
  }

  /**
   * Reject the grant
   */
  reject(approvedBy: string, reason: string): void {
    if (this._status === 'approved' || this._status === 'rejected') {
      throw new Error('Grant has already been approved or rejected')
    }

    this._status = 'rejected'
    this._approvedBy = approvedBy
    this._approvedAt = new Date()
    this._approvalReason = reason
  }

  /**
   * Revoke an approved grant
   */
  revoke(revokedBy: string, reason: string): void {
    if (this._status === 'revoked') {
      throw new Error('Grant is already revoked')
    }

    if (this._status !== 'approved') {
      throw new Error('Can only revoke approved grants')
    }

    this._status = 'revoked'
    this._revokedBy = revokedBy
    this._revokedAt = new Date()
    this._revocationReason = reason
  }

  /**
   * Check if grant is currently active
   * Active = approved AND within time bounds AND not revoked
   */
  isActive(): boolean {
    if (this._status !== 'approved') {
      return false
    }

    const now = new Date()
    return now >= this._startTime && now <= this._endTime
  }

  /**
   * Check if grant is expired
   */
  isExpired(): boolean {
    const now = new Date()
    return now > this._endTime
  }

  /**
   * Check if grant is approved
   */
  isApproved(): boolean {
    return this._status === 'approved'
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

  get permissions(): string[] {
    return this._permissions
  }

  get startTime(): Date {
    return this._startTime
  }

  get endTime(): Date {
    return this._endTime
  }

  get justification(): string {
    return this._justification
  }

  get requestedBy(): string {
    return this._requestedBy
  }

  get requestedAt(): Date {
    return this._requestedAt
  }

  get status(): GrantStatus {
    return this._status
  }

  get approvedBy(): string | null {
    return this._approvedBy
  }

  get approvedAt(): Date | null {
    return this._approvedAt
  }

  get approvalReason(): string | null {
    return this._approvalReason
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
}
