import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { Notification, NotificationType, NotificationSeverity } from '../../domain/notification/notification.entity';
import { LoggerService } from '../../core/logger/logger.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * Notification Service
 *
 * Manages in-app and email notifications:
 * - Create notifications
 * - Send email alerts
 * - Mark as read/unread
 * - Get user notifications
 * - Cleanup old notifications
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(NotificationService.name);
  }

  /**
   * Create and send notification
   */
  async createNotification(params: {
    tenantId: string;
    userId: string;
    userEmail: string;
    userName: string;
    type: NotificationType;
    title: string;
    message: string;
    severity: NotificationSeverity;
    actionUrl?: string;
    metadata?: Record<string, any>;
    sendEmail?: boolean;
  }): Promise<Notification> {
    this.logger.info(`Creating notification for user ${params.userId}: ${params.type}`);

    // Create notification entity
    const notification = Notification.create({
      id: uuidv4(),
      tenantId: params.tenantId,
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      severity: params.severity,
      actionUrl: params.actionUrl,
      metadata: params.metadata,
    });

    // Persist to database
    await this.prisma.notification.create({
      data: notification.toPlainObject(),
    });

    // Send email if requested
    if (params.sendEmail) {
      await this.sendNotificationEmail({
        to: params.userEmail,
        recipientName: params.userName,
        notification,
      });
    }

    this.logger.info(`Notification created: ${notification.getId()}`);

    return notification;
  }

  /**
   * Send notification email
   */
  private async sendNotificationEmail(params: {
    to: string;
    recipientName: string;
    notification: Notification;
  }): Promise<void> {
    try {
      const html = `
        <h2>${params.notification.getTitle()}</h2>
        <p>Gentile ${params.recipientName},</p>
        <p>${params.notification.getMessage()}</p>
        ${
          params.notification.getActionUrl()
            ? `<p><a href="${params.notification.getActionUrl()}" style="background: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Vai al Sistema</a></p>`
            : ''
        }
      `;

      await this.emailService.sendEmail({
        to: params.to,
        subject: `[WasteFlow] ${params.notification.getTitle()}`,
        html,
      });
    } catch (error) {
      this.logger.error(`Failed to send notification email to ${params.to}`, error);
      // Don't throw - notification still created in-app
    }
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(params: {
    userId: string;
    tenantId: string;
    unreadOnly?: boolean;
    limit?: number;
  }): Promise<Notification[]> {
    const notifications = await this.prisma.notification.findMany({
      where: {
        userId: params.userId,
        tenantId: params.tenantId,
        ...(params.unreadOnly ? { isRead: false } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: params.limit || 50,
    });

    return notifications.map((n: any) =>
      Notification.create({
        id: n.id,
        tenantId: n.tenantId,
        userId: n.userId,
        type: n.type as NotificationType,
        title: n.title,
        message: n.message,
        severity: n.severity as NotificationSeverity,
        actionUrl: n.actionUrl || undefined,
        metadata: {}, // Prisma schema does not have metadata field, so pass empty object
      }),
    );
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userId: string, tenantId: string): Promise<number> {
    return await this.prisma.notification.count({
      where: {
        userId,
        tenantId,
        isRead: false,
      },
    });
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    await this.prisma.notification.update({
      where: {
        id: notificationId,
        userId, // Ensure user owns notification
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    this.logger.debug(`Notification marked as read: ${notificationId}`);
  }

  /**
   * Mark all as read
   */
  async markAllAsRead(userId: string, tenantId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        userId,
        tenantId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    this.logger.info(`All notifications marked as read for user ${userId}`);
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    await this.prisma.notification.delete({
      where: {
        id: notificationId,
        userId,
      },
    });

    this.logger.debug(`Notification deleted: ${notificationId}`);
  }

  /**
   * Cleanup old notifications (7 days)
   */
  async cleanupOldNotifications(): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const result = await this.prisma.notification.deleteMany({
      where: {
        createdAt: {
          lt: sevenDaysAgo,
        },
        isRead: true,
      },
    });

    this.logger.info(`Cleaned up ${result.count} old notifications`);

    return result.count;
  }

  /**
   * Notify FIR signature required
   */
  async notifyFIRSignatureRequired(params: {
    tenantId: string;
    userId: string;
    userEmail: string;
    userName: string;
    firId: string;
    firNumber: string;
    role: 'PRODUCER' | 'CARRIER' | 'RECEIVER';
  }): Promise<void> {
    const roleLabel = {
      PRODUCER: 'Produttore',
      CARRIER: 'Trasportatore',
      RECEIVER: 'Destinatario',
    }[params.role];

    await this.createNotification({
      tenantId: params.tenantId,
      userId: params.userId,
      userEmail: params.userEmail,
      userName: params.userName,
      type: 'SIGNATURE_REQUIRED',
      title: `Firma richiesta: FIR ${params.firNumber}`,
      message: `È richiesta la tua firma come ${roleLabel} per il FIR ${params.firNumber}`,
      severity: 'WARNING',
      actionUrl: `/fir/${params.firId}`,
      metadata: {
        firId: params.firId,
        firNumber: params.firNumber,
        role: params.role,
      },
      sendEmail: true,
    });

    // Also send specialized email
    await this.emailService.sendFIRSignatureRequired({
      to: params.userEmail,
      recipientName: params.userName,
      firNumber: params.firNumber,
      role: params.role,
      actionUrl: `${process.env.PUBLIC_URL}/fir/${params.firId}`,
    });
  }

  /**
   * Notify FIR completed
   * TODO: FIR_COMPLETED type doesn't exist in Prisma schema - using RENTRI_SYNC_SUCCESS as fallback
   * Consider adding FIR_COMPLETED to NotificationType enum in schema
   */
  async notifyFIRCompleted(params: {
    tenantId: string;
    userId: string;
    userEmail: string;
    userName: string;
    firNumber: string;
  }): Promise<void> {
    await this.createNotification({
      tenantId: params.tenantId,
      userId: params.userId,
      userEmail: params.userEmail,
      userName: params.userName,
      type: 'RENTRI_SYNC_SUCCESS', // TODO: Should be 'FIR_COMPLETED' once added to schema
      title: `FIR completato: ${params.firNumber}`,
      message: `Il FIR ${params.firNumber} è stato completato con tutte le firme digitali`,
      severity: 'INFO', // Changed from SUCCESS to match Prisma enum
      metadata: {
        firNumber: params.firNumber,
      },
      sendEmail: true,
    });

    await this.emailService.sendFIRCompleted({
      to: params.userEmail,
      recipientName: params.userName,
      firNumber: params.firNumber,
    });
  }

  /**
   * Notify RENTRI sync failed
   */
  async notifyRENTRISyncFailed(params: {
    tenantId: string;
    userId: string;
    userEmail: string;
    userName: string;
    firNumber: string;
    error: string;
  }): Promise<void> {
    await this.createNotification({
      tenantId: params.tenantId,
      userId: params.userId,
      userEmail: params.userEmail,
      userName: params.userName,
      type: 'RENTRI_SYNC_FAILED',
      title: `Errore sincronizzazione RENTRI: ${params.firNumber}`,
      message: `La sincronizzazione del FIR ${params.firNumber} con RENTRI è fallita: ${params.error}`,
      severity: 'ERROR',
      metadata: {
        firNumber: params.firNumber,
        error: params.error,
      },
      sendEmail: true,
    });

    await this.emailService.sendRENTRISyncFailed({
      to: params.userEmail,
      recipientName: params.userName,
      firNumber: params.firNumber,
      error: params.error,
    });
  }
}
