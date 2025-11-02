/**
 * PermissionGrantedEvent Domain Event
 * Triggered when a permission is granted to a user (temporary grant)
 * Per plan.md FR-011: Temporary permission grants with business justification
 *
 * Event consumers:
 * - PermissionCacheService: Adds temp permission to cache
 * - AuditLogService: Records permission grant for compliance
 * - NotificationService: Notifies user and admin of temp permission grant
 * - SchedulerService: Schedules auto-revocation at expiration time
 */
export class PermissionGrantedEvent {
  public readonly occurredAt: Date;

  constructor(
    public readonly aggregateId: string, // TemporaryPermissionGrant ID
    public readonly tenantId: string,
    public readonly userId: string,
    public readonly permissions: string[], // Permission strings (resource:action:scope)
    public readonly startTime: Date,
    public readonly endTime: Date,
    public readonly grantedBy: string,
    public readonly businessJustification: string,
  ) {
    this.occurredAt = new Date();
  }

  /**
   * Get event name for routing/logging
   */
  getEventName(): string {
    return 'permission.granted';
  }

  /**
   * Get duration in minutes
   */
  getDurationMinutes(): number {
    return Math.floor((this.endTime.getTime() - this.startTime.getTime()) / 60000);
  }

  /**
   * Get remaining time in minutes (from now until expiration)
   */
  getRemainingMinutes(): number {
    const now = Date.now();
    if (now >= this.endTime.getTime()) {
      return 0; // Already expired
    }
    return Math.floor((this.endTime.getTime() - now) / 60000);
  }

  /**
   * Check if grant is currently active
   */
  isActive(): boolean {
    const now = Date.now();
    return now >= this.startTime.getTime() && now < this.endTime.getTime();
  }

  /**
   * Check if grant is sensitive (contains high-risk permissions)
   */
  isSensitive(): boolean {
    const sensitiveKeywords = ['delete', 'approve', 'configure', 'admin'];
    return this.permissions.some((perm) =>
      sensitiveKeywords.some((keyword) => perm.toLowerCase().includes(keyword)),
    );
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
      permissions: this.permissions,
      startTime: this.startTime.toISOString(),
      endTime: this.endTime.toISOString(),
      grantedBy: this.grantedBy,
      businessJustification: this.businessJustification,
      occurredAt: this.occurredAt.toISOString(),
      durationMinutes: this.getDurationMinutes(),
      isSensitive: this.isSensitive(),
    };
  }

  /**
   * Create event from object (for deserialization)
   */
  static fromObject(obj: Record<string, any>): PermissionGrantedEvent {
    return new PermissionGrantedEvent(
      obj.aggregateId,
      obj.tenantId,
      obj.userId,
      obj.permissions,
      new Date(obj.startTime),
      new Date(obj.endTime),
      obj.grantedBy,
      obj.businessJustification,
    );
  }
}
