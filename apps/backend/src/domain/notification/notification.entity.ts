/**
 * Notification Entity
 *
 * Represents an in-app notification for users.
 * Supports multiple channels (in-app, email, SMS).
 *
 * Types:
 * - FIR_SIGNATURE_REQUIRED
 * - FIR_COMPLETED
 * - RENTRI_SYNC_FAILED
 * - COMPLIANCE_ALERT
 * - SYSTEM_ANNOUNCEMENT
 */
export class Notification {
  private id: string
  private tenantId: string
  private userId: string
  private type: NotificationType
  private title: string
  private message: string
  private severity: NotificationSeverity
  private read: boolean
  private actionUrl?: string
  private metadata: Record<string, any>
  private createdAt: Date
  private readAt?: Date

  private constructor(params: {
    id: string
    tenantId: string
    userId: string
    type: NotificationType
    title: string
    message: string
    severity: NotificationSeverity
    actionUrl?: string
    metadata?: Record<string, any>
  }) {
    this.id = params.id
    this.tenantId = params.tenantId
    this.userId = params.userId
    this.type = params.type
    this.title = params.title
    this.message = params.message
    this.severity = params.severity
    this.read = false
    this.actionUrl = params.actionUrl
    this.metadata = params.metadata || {}
    this.createdAt = new Date()
  }

  static create(params: {
    id: string
    tenantId: string
    userId: string
    type: NotificationType
    title: string
    message: string
    severity: NotificationSeverity
    actionUrl?: string
    metadata?: Record<string, any>
  }): Notification {
    return new Notification(params)
  }

  markAsRead(): void {
    if (!this.read) {
      this.read = true
      this.readAt = new Date()
    }
  }

  markAsUnread(): void {
    this.read = false
    this.readAt = undefined
  }

  // Getters
  getId(): string {
    return this.id
  }

  getTenantId(): string {
    return this.tenantId
  }

  getUserId(): string {
    return this.userId
  }

  getType(): NotificationType {
    return this.type
  }

  getTitle(): string {
    return this.title
  }

  getMessage(): string {
    return this.message
  }

  getSeverity(): NotificationSeverity {
    return this.severity
  }

  isRead(): boolean {
    return this.read
  }

  getActionUrl(): string | undefined {
    return this.actionUrl
  }

  getMetadata(): Record<string, any> {
    return this.metadata
  }

  getCreatedAt(): Date {
    return this.createdAt
  }

  getReadAt(): Date | undefined {
    return this.readAt
  }

  toPlainObject() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      userId: this.userId,
      type: this.type,
      title: this.title,
      message: this.message,
      severity: this.severity,
      read: this.read,
      actionUrl: this.actionUrl,
      metadata: this.metadata,
      createdAt: this.createdAt,
      readAt: this.readAt,
    }
  }
}

// Notification types - must match Prisma schema enum
export type NotificationType =
  | 'FIR_DEADLINE_APPROACHING'
  | 'RENTRI_SYNC_FAILED'
  | 'RENTRI_SYNC_SUCCESS'
  | 'MUD_DEADLINE_APPROACHING'
  | 'SUBSCRIPTION_EXPIRING'
  | 'SIGNATURE_REQUIRED'
  | 'SYSTEM_ERROR'

// Notification severity - must match Prisma schema enum (no SUCCESS in Prisma)
export type NotificationSeverity = 'INFO' | 'WARNING' | 'ERROR'
