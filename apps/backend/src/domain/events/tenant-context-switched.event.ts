/**
 * TenantContextSwitchedEvent Domain Event
 * Published when a consultant switches tenant context
 * Per plan.md: Audit trail must log tenant context switches
 *
 * Event Structure:
 * - consultantUserId: User ID of consultant performing switch
 * - sourceTenantId: Tenant being switched FROM
 * - targetTenantId: Tenant being switched TO
 * - targetRoleId: Role assigned in target tenant
 * - timestamp: When switch occurred
 * - sessionId: HTTP session/request ID for correlation
 *
 * Consumers:
 * - Audit log service: Logs context switch for compliance
 * - Analytics service: Tracks consultant tenant switching patterns
 * - Notification service: Sends email/Slack alert for security monitoring
 * - Cache invalidation service: Ensures permissions refreshed
 */
export class TenantContextSwitchedEvent {
  constructor(
    public readonly consultantUserId: string,
    public readonly sourceTenantId: string,
    public readonly targetTenantId: string,
    public readonly targetRoleId: string,
    public readonly timestamp: Date,
    public readonly sessionId?: string,
    public readonly ipAddress?: string,
    public readonly userAgent?: string
  ) {}

  /**
   * Get event type identifier
   * Used for event sourcing and message routing
   */
  get eventType(): string {
    return 'tenant_context_switched'
  }

  /**
   * Convert to event payload for publishing
   */
  toEventPayload(): {
    eventType: string
    consultantUserId: string
    sourceTenantId: string
    targetTenantId: string
    targetRoleId: string
    timestamp: string
    sessionId?: string
    ipAddress?: string
    userAgent?: string
    metadata: {
      direction: string
      isConsultantMode: boolean
    }
  } {
    return {
      eventType: this.eventType,
      consultantUserId: this.consultantUserId,
      sourceTenantId: this.sourceTenantId,
      targetTenantId: this.targetTenantId,
      targetRoleId: this.targetRoleId,
      timestamp: this.timestamp.toISOString(),
      sessionId: this.sessionId,
      ipAddress: this.ipAddress,
      userAgent: this.userAgent,
      metadata: {
        direction: `${this.sourceTenantId} → ${this.targetTenantId}`,
        isConsultantMode: true,
      },
    }
  }

  /**
   * Get audit log representation
   * Per plan.md: All tenant switches must be logged for compliance
   */
  toAuditLog(): {
    userId: string
    actionAttempted: string
    decision: 'ALLOW'
    contextAttributes: Record<string, any>
    timestamp: Date
  } {
    return {
      userId: this.consultantUserId,
      actionAttempted: 'switch_tenant_context',
      decision: 'ALLOW',
      contextAttributes: {
        sourceTenantId: this.sourceTenantId,
        targetTenantId: this.targetTenantId,
        targetRoleId: this.targetRoleId,
        sessionId: this.sessionId,
        ipAddress: this.ipAddress,
        userAgent: this.userAgent,
        consultantMode: true,
        switchDirection: `${this.sourceTenantId} → ${this.targetTenantId}`,
      },
      timestamp: this.timestamp,
    }
  }
}
