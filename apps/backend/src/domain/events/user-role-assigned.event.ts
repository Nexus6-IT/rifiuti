/**
 * UserRoleAssignedEvent Domain Event
 * Triggered when a role is assigned to a user
 * Per plan.md: Event-driven architecture for audit trail and cache invalidation
 *
 * Event consumers:
 * - PermissionCacheService: Invalidates user permission cache
 * - RedisPubSubService: Broadcasts invalidation to all instances
 * - AuditLogService: Records role assignment for compliance
 * - NotificationService: Notifies user of role assignment
 */
export class UserRoleAssignedEvent {
  public readonly occurredAt: Date

  constructor(
    public readonly aggregateId: string, // UserRole ID
    public readonly tenantId: string,
    public readonly userId: string,
    public readonly roleId: string,
    public readonly roleName: string,
    public readonly assignedBy: string,
    public readonly expiresAt: Date | null,
    public readonly facilityIds: string[] | null,
    public readonly isDelegated: boolean,
    public readonly delegationReason: string | null
  ) {
    this.occurredAt = new Date()
  }

  /**
   * Get event name for routing/logging
   */
  getEventName(): string {
    return 'user-role.assigned'
  }

  /**
   * Check if assignment is temporary
   */
  isTemporary(): boolean {
    return this.expiresAt !== null
  }

  /**
   * Check if assignment is facility-scoped
   */
  isFacilityScoped(): boolean {
    return this.facilityIds !== null && this.facilityIds.length > 0
  }

  /**
   * Convert to plain object for serialization
   */
  toObject(): Record<string, any> {
    return {
      eventName: this.getEventName(),
      aggregateId: this.aggregateId,
      tenantId: this.tenantId,
      userId: this.userId,
      roleId: this.roleId,
      roleName: this.roleName,
      assignedBy: this.assignedBy,
      expiresAt: this.expiresAt?.toISOString() || null,
      facilityIds: this.facilityIds,
      isDelegated: this.isDelegated,
      delegationReason: this.delegationReason,
      occurredAt: this.occurredAt.toISOString(),
    }
  }

  /**
   * Create event from object (for deserialization)
   */
  static fromObject(obj: Record<string, any>): UserRoleAssignedEvent {
    return new UserRoleAssignedEvent(
      obj.aggregateId,
      obj.tenantId,
      obj.userId,
      obj.roleId,
      obj.roleName,
      obj.assignedBy,
      obj.expiresAt ? new Date(obj.expiresAt) : null,
      obj.facilityIds,
      obj.isDelegated,
      obj.delegationReason
    )
  }
}
