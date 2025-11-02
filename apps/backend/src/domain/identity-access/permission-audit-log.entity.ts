import * as crypto from 'crypto';

/**
 * PermissionAuditLog Entity
 * Immutable audit log for all permission checks with cryptographic chaining
 * T137: PermissionAuditLog entity per User Story 4
 *
 * Purpose: Create tamper-proof audit trail for ARPA compliance
 *
 * Requirements from plan.md:
 * - SHA-256 cryptographic chaining for tamper detection
 * - Each log contains hash of previous log
 * - <1ms overhead for logging
 * - Immutable once created (no updates)
 *
 * Requirements from spec.md FR-018:
 * - Log all permission checks (ALLOW and DENY)
 * - Include user ID, action, timestamp (ms precision), decision
 * - Include SPID fiscal code for ARPA compliance
 * - Include tenant context for multi-tenant isolation
 * - 10-year retention requirement
 */
export class PermissionAuditLog {
  private constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly tenantId: string,
    public readonly actionAttempted: string,
    public readonly resourceType: string | undefined,
    public readonly resourceId: string | undefined,
    public readonly decision: 'ALLOW' | 'DENY',
    public readonly reason: string | undefined,
    public readonly spidFiscalCode: string | undefined,
    public readonly sessionId: string | undefined,
    public readonly ipAddress: string | undefined,
    public readonly userAgent: string | undefined,
    public readonly timestamp: Date,
    public readonly previousHash: string,
    public readonly hash: string | undefined,
  ) {
    // Freeze object to enforce immutability
    Object.freeze(this);
  }

  /**
   * Factory method: Create new audit log
   */
  static create(props: {
    id?: string;
    userId: string;
    tenantId: string;
    actionAttempted: string;
    resourceType?: string;
    resourceId?: string;
    decision: string;
    reason?: string;
    spidFiscalCode?: string;
    sessionId?: string;
    ipAddress?: string;
    userAgent?: string;
    timestamp?: Date;
    previousHash: string;
  }): PermissionAuditLog {
    // Validation
    if (!props.userId || props.userId.trim() === '') {
      throw new Error('userId is required');
    }

    if (!props.tenantId || props.tenantId.trim() === '') {
      throw new Error('tenantId is required');
    }

    if (!props.actionAttempted || props.actionAttempted.trim() === '') {
      throw new Error('actionAttempted is required');
    }

    if (props.decision !== 'ALLOW' && props.decision !== 'DENY') {
      throw new Error('decision must be ALLOW or DENY');
    }

    if (props.decision === 'DENY' && (!props.reason || props.reason.trim() === '')) {
      throw new Error('reason is required when decision is DENY');
    }

    // Generate ID if not provided
    const id = props.id || crypto.randomUUID();

    // Use current timestamp if not provided
    const timestamp = props.timestamp || new Date();

    // Create entity
    const log = new PermissionAuditLog(
      id,
      props.userId,
      props.tenantId,
      props.actionAttempted,
      props.resourceType,
      props.resourceId,
      props.decision as 'ALLOW' | 'DENY',
      props.reason,
      props.spidFiscalCode,
      props.sessionId,
      props.ipAddress,
      props.userAgent,
      timestamp,
      props.previousHash,
      undefined, // Hash will be calculated
    );

    // Calculate and store hash
    const hash = log.calculateHash();

    // Return new instance with hash
    return new PermissionAuditLog(
      log.id,
      log.userId,
      log.tenantId,
      log.actionAttempted,
      log.resourceType,
      log.resourceId,
      log.decision,
      log.reason,
      log.spidFiscalCode,
      log.sessionId,
      log.ipAddress,
      log.userAgent,
      log.timestamp,
      log.previousHash,
      hash,
    );
  }

  /**
   * Reconstruct from persistence
   */
  static fromPersistence(data: any): PermissionAuditLog {
    return new PermissionAuditLog(
      data.id,
      data.userId,
      data.tenantId,
      data.actionAttempted,
      data.resourceType,
      data.resourceId,
      data.decision,
      data.reason,
      data.spidFiscalCode,
      data.sessionId,
      data.ipAddress,
      data.userAgent,
      data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp),
      data.previousHash,
      data.hash,
    );
  }

  /**
   * Calculate SHA-256 hash of this log entry
   * Hash includes all fields except the hash itself
   */
  calculateHash(): string {
    const data = {
      id: this.id,
      userId: this.userId,
      tenantId: this.tenantId,
      actionAttempted: this.actionAttempted,
      resourceType: this.resourceType,
      resourceId: this.resourceId,
      decision: this.decision,
      reason: this.reason,
      spidFiscalCode: this.spidFiscalCode,
      sessionId: this.sessionId,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      timestamp: this.timestamp.toISOString(),
      previousHash: this.previousHash,
    };

    const jsonString = JSON.stringify(data);
    return crypto.createHash('sha256').update(jsonString).digest('hex');
  }

  /**
   * Verify that stored hash matches calculated hash
   * Detects tampering with log content
   */
  isHashValid(): boolean {
    if (!this.hash) {
      return false;
    }

    const calculatedHash = this.calculateHash();
    return this.hash === calculatedHash;
  }

  /**
   * Verify chain integrity with previous log
   * Checks that this log's previousHash matches the previous log's hash
   */
  isChainValid(previousLog: PermissionAuditLog): boolean {
    if (!previousLog.hash) {
      return false;
    }

    return this.previousHash === previousLog.hash;
  }

  /**
   * Convert to plain object for persistence
   */
  toPersistence(): any {
    return {
      id: this.id,
      userId: this.userId,
      tenantId: this.tenantId,
      actionAttempted: this.actionAttempted,
      resourceType: this.resourceType,
      resourceId: this.resourceId,
      decision: this.decision,
      reason: this.reason,
      spidFiscalCode: this.spidFiscalCode,
      sessionId: this.sessionId,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      timestamp: this.timestamp,
      previousHash: this.previousHash,
      hash: this.hash,
    };
  }
}
