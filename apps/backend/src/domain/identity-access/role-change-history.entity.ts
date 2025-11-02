import * as crypto from 'crypto';

/**
 * RoleChangeHistory Entity
 * Immutable record of role assignments and changes
 * T138: RoleChangeHistory entity per User Story 4
 *
 * Purpose: Track all role changes for compliance and historical reconstruction
 *
 * Requirements from spec.md:
 * - Track who made the change, when, and why
 * - Store old role and new role for comparison
 * - Support historical permission reconstruction (US4 acceptance scenario 5)
 * - Include tenant context
 * - 10-year retention for ARPA compliance
 *
 * Requirements from plan.md:
 * - Immutable once created
 * - Support role hierarchy changes over time
 */
export class RoleChangeHistory {
  private constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly tenantId: string,
    public readonly oldRoleId: string | null,
    public readonly newRoleId: string | null,
    public readonly changedBy: string,
    public readonly reason: string,
    public readonly timestamp: Date,
    public readonly effectiveDate: Date,
    public readonly metadata?: Record<string, any>,
  ) {
    // Freeze object to enforce immutability
    Object.freeze(this);
  }

  /**
   * Factory method: Create new role change history record
   */
  static create(props: {
    id?: string;
    userId: string;
    tenantId: string;
    oldRoleId?: string | null;
    newRoleId?: string | null;
    changedBy: string;
    reason: string;
    timestamp?: Date;
    effectiveDate?: Date;
    metadata?: Record<string, any>;
  }): RoleChangeHistory {
    // Validation
    if (!props.userId || props.userId.trim() === '') {
      throw new Error('userId is required');
    }

    if (!props.tenantId || props.tenantId.trim() === '') {
      throw new Error('tenantId is required');
    }

    // At least one role must be provided
    if (props.oldRoleId === null && props.newRoleId === null) {
      throw new Error('At least one of oldRoleId or newRoleId must be provided');
    }

    if (!props.changedBy || props.changedBy.trim() === '') {
      throw new Error('changedBy is required');
    }

    if (!props.reason || props.reason.trim() === '') {
      throw new Error('reason is required');
    }

    // Generate ID if not provided
    const id = props.id || crypto.randomUUID();

    // Use current timestamp if not provided
    const timestamp = props.timestamp || new Date();

    // Use timestamp as effectiveDate if not provided
    const effectiveDate = props.effectiveDate || timestamp;

    // Normalize null/undefined for role IDs
    const oldRoleId = props.oldRoleId === undefined ? null : props.oldRoleId;
    const newRoleId = props.newRoleId === undefined ? null : props.newRoleId;

    // Validate newRoleId specifically
    if (newRoleId !== null && newRoleId.trim() === '') {
      throw new Error('newRoleId is required');
    }

    return new RoleChangeHistory(
      id,
      props.userId,
      props.tenantId,
      oldRoleId,
      newRoleId,
      props.changedBy,
      props.reason,
      timestamp,
      effectiveDate,
      props.metadata,
    );
  }

  /**
   * Reconstruct from persistence
   */
  static fromPersistence(data: any): RoleChangeHistory {
    return new RoleChangeHistory(
      data.id,
      data.userId,
      data.tenantId,
      data.oldRoleId,
      data.newRoleId,
      data.changedBy,
      data.reason,
      data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp),
      data.effectiveDate instanceof Date ? data.effectiveDate : new Date(data.effectiveDate),
      data.metadata,
    );
  }

  /**
   * Check if this is an initial role assignment (no previous role)
   */
  isInitialAssignment(): boolean {
    return this.oldRoleId === null && this.newRoleId !== null;
  }

  /**
   * Check if this is a role revocation (no new role)
   */
  isRevocation(): boolean {
    return this.oldRoleId !== null && this.newRoleId === null;
  }

  /**
   * Check if this is a role change (has both old and new roles)
   */
  isRoleChange(): boolean {
    return this.oldRoleId !== null && this.newRoleId !== null;
  }

  /**
   * Get the role ID that was active at a specific timestamp
   * Used for historical permission reconstruction
   */
  getRoleAtTime(queryDate: Date): string | null {
    // If query date is before effective date, return old role
    if (queryDate < this.effectiveDate) {
      return this.oldRoleId;
    }

    // If query date is at or after effective date, return new role
    return this.newRoleId;
  }

  /**
   * Check if this change occurred before another change
   */
  isBefore(other: RoleChangeHistory): boolean {
    return this.effectiveDate < other.effectiveDate;
  }

  /**
   * Check if this change occurred after another change
   */
  isAfter(other: RoleChangeHistory): boolean {
    return this.effectiveDate > other.effectiveDate;
  }

  /**
   * Convert to plain object for persistence
   */
  toPersistence(): any {
    return {
      id: this.id,
      userId: this.userId,
      tenantId: this.tenantId,
      oldRoleId: this.oldRoleId,
      newRoleId: this.newRoleId,
      changedBy: this.changedBy,
      reason: this.reason,
      timestamp: this.timestamp,
      effectiveDate: this.effectiveDate,
      metadata: this.metadata,
    };
  }
}
