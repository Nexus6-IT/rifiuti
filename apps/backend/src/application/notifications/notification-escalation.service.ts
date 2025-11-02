import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { LoggerService } from '../../core/logger/logger.service';

/**
 * Notification Escalation Service
 *
 * Handles escalation of unread critical notifications:
 * - Checks for unread notifications older than threshold
 * - Escalates to admins when operators don't respond
 * - Sends reminder emails for critical deadlines
 */
@Injectable()
export class NotificationEscalationService {
  // Escalation thresholds (hours)
  private readonly ESCALATION_THRESHOLDS = {
    WARNING: 24, // Escalate warning notifications after 24 hours
    ERROR: 4, // Escalate error notifications after 4 hours
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(NotificationEscalationService.name);
  }

  /**
   * Check for unread notifications requiring escalation
   * Runs every 2 hours
   */
  @Cron(CronExpression.EVERY_2_HOURS)
  async checkEscalations(): Promise<void> {
    this.logger.info('Starting notification escalation check');

    try {
      await this.escalateWarnings();
      await this.escalateErrors();
      this.logger.info('Notification escalation check completed');
    } catch (error) {
      this.logger.error('Failed to check notification escalations', error);
    }
  }

  /**
   * Escalate unread WARNING notifications older than 24 hours
   */
  private async escalateWarnings(): Promise<void> {
    const threshold = new Date(Date.now() - this.ESCALATION_THRESHOLDS.WARNING * 60 * 60 * 1000);

    const unreadWarnings = await this.prisma.notification.findMany({
      where: {
        severity: 'WARNING',
        isRead: false,
        createdAt: {
          lt: threshold,
        },
      },
      include: {
        user: true,
        tenant: {
          include: {
            users: {
              where: {
                role: 'ADMIN',
              },
            },
          },
        },
      },
    });

    this.logger.debug(`Found ${unreadWarnings.length} unread warnings to escalate`);

    for (const notification of unreadWarnings) {
      await this.escalateToAdmins(notification);
    }
  }

  /**
   * Escalate unread ERROR notifications older than 4 hours
   */
  private async escalateErrors(): Promise<void> {
    const threshold = new Date(Date.now() - this.ESCALATION_THRESHOLDS.ERROR * 60 * 60 * 1000);

    const unreadErrors = await this.prisma.notification.findMany({
      where: {
        severity: 'ERROR',
        isRead: false,
        createdAt: {
          lt: threshold,
        },
      },
      include: {
        user: true,
        tenant: {
          include: {
            users: {
              where: {
                role: 'ADMIN',
              },
            },
          },
        },
      },
    });

    this.logger.debug(`Found ${unreadErrors.length} unread errors to escalate`);

    for (const notification of unreadErrors) {
      await this.escalateToAdmins(notification);
    }
  }

  /**
   * Escalate notification to all admin users
   */
  private async escalateToAdmins(notification: any): Promise<void> {
    const { tenant, user } = notification;

    // Skip if already escalated
    const escalationKey = `escalated:${notification.id}`;
    const alreadyEscalated = await this.checkEscalationFlag(escalationKey);

    if (alreadyEscalated) {
      this.logger.debug(`Notification ${notification.id} already escalated, skipping`);
      return;
    }

    this.logger.info(
      `Escalating notification ${notification.id} for user ${user.email} to admins`,
    );

    // Send escalation email to all admins
    for (const admin of tenant.users) {
      try {
        const hoursUnread = Math.floor(
          (Date.now() - notification.createdAt.getTime()) / (1000 * 60 * 60),
        );

        await this.emailService.sendEmail({
          to: admin.email,
          subject: `[WasteFlow] Escalation: ${notification.title}`,
          html: this.buildEscalationEmail({
            adminName: `${admin.firstName} ${admin.lastName}`,
            userName: `${user.firstName} ${user.lastName}`,
            userEmail: user.email,
            notificationTitle: notification.title,
            notificationMessage: notification.message,
            notificationSeverity: notification.severity,
            hoursUnread,
            actionUrl: notification.actionUrl
              ? `${process.env.PUBLIC_URL || 'https://wasteflow.app'}${notification.actionUrl}`
              : undefined,
          }),
        });

        // Create escalation notification for admin
        await this.prisma.notification.create({
          data: {
            tenantId: tenant.id,
            userId: admin.id,
            type: 'SYSTEM_ERROR', // Using SYSTEM_ERROR as placeholder for escalation
            title: `Escalation: ${notification.title}`,
            message: `L'operatore ${user.firstName} ${user.lastName} non ha risposto alla notifica "${notification.title}" da ${hoursUnread} ore. Azione richiesta.`,
            severity: notification.severity,
            actionUrl: notification.actionUrl,
            isRead: false,
          },
        });

        this.logger.debug(`Escalation sent to admin ${admin.email}`);
      } catch (error) {
        this.logger.error(`Failed to escalate notification to admin ${admin.email}`, error);
      }
    }

    // Mark as escalated
    await this.setEscalationFlag(escalationKey);
  }

  /**
   * Build escalation email HTML
   */
  private buildEscalationEmail(params: {
    adminName: string;
    userName: string;
    userEmail: string;
    notificationTitle: string;
    notificationMessage: string;
    notificationSeverity: string;
    hoursUnread: number;
    actionUrl?: string;
  }): string {
    const severityColor = {
      INFO: '#3b82f6',
      WARNING: '#f59e0b',
      ERROR: '#ef4444',
    }[params.notificationSeverity] || '#6b7280';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
          }
          .alert {
            padding: 20px;
            border-radius: 8px;
            margin: 20px 0;
            border-left: 4px solid ${severityColor};
            background-color: ${params.notificationSeverity === 'ERROR' ? '#fee2e2' : '#fef3c7'};
          }
          .button {
            display: inline-block;
            background-color: #ef4444;
            color: white;
            padding: 12px 24px;
            text-decoration: none;
            border-radius: 6px;
            margin: 15px 0;
            font-weight: 500;
          }
          .details {
            background-color: #f9fafb;
            padding: 15px;
            border-radius: 6px;
            margin: 15px 0;
          }
          .details-item {
            margin: 8px 0;
          }
          .details-label {
            font-weight: 600;
            color: #374151;
          }
        </style>
      </head>
      <body>
        <h2>🔴 Escalation Notifica</h2>

        <p>Gentile ${params.adminName},</p>

        <div class="alert">
          <strong>⚠️ Azione richiesta</strong><br>
          Una notifica ${params.notificationSeverity} non è stata letta da ${params.hoursUnread} ore e richiede la tua attenzione.
        </div>

        <div class="details">
          <div class="details-item">
            <span class="details-label">Utente:</span> ${params.userName} (${params.userEmail})
          </div>
          <div class="details-item">
            <span class="details-label">Titolo notifica:</span> ${params.notificationTitle}
          </div>
          <div class="details-item">
            <span class="details-label">Messaggio:</span> ${params.notificationMessage}
          </div>
          <div class="details-item">
            <span class="details-label">Severità:</span> ${params.notificationSeverity}
          </div>
          <div class="details-item">
            <span class="details-label">Tempo non letta:</span> ${params.hoursUnread} ore
          </div>
        </div>

        ${
          params.actionUrl
            ? `<p><a href="${params.actionUrl}" class="button">Vai al Sistema</a></p>`
            : ''
        }

        <p><strong>Azioni consigliate:</strong></p>
        <ol>
          <li>Verifica lo stato dell'attività correlata</li>
          <li>Contatta l'operatore se necessario</li>
          <li>Prendi le azioni necessarie per risolvere la situazione</li>
          <li>Aggiorna il sistema con le azioni intraprese</li>
        </ol>

        <p style="color: #6b7280; font-size: 12px; margin-top: 30px;">
          Questo è un messaggio automatico da WasteFlow.<br>
          &copy; ${new Date().getFullYear()} WasteFlow - Tutti i diritti riservati
        </p>
      </body>
      </html>
    `;
  }

  /**
   * Check if notification has been escalated
   * Uses in-memory cache or database flag
   */
  private async checkEscalationFlag(key: string): Promise<boolean> {
    // TODO: Implement with Redis cache when available
    // For now, check if escalation notification exists
    const escalationExists = await this.prisma.notification.findFirst({
      where: {
        title: {
          contains: 'Escalation:',
        },
        message: {
          contains: key.split(':')[1], // Extract notification ID
        },
      },
    });

    return !!escalationExists;
  }

  /**
   * Set escalation flag
   */
  private async setEscalationFlag(key: string): Promise<void> {
    // TODO: Implement with Redis cache when available
    // For now, escalation is tracked by creating escalation notifications
    this.logger.debug(`Escalation flag set: ${key}`);
  }

  /**
   * Manual escalation trigger for specific notification
   */
  async escalateNotification(notificationId: string): Promise<void> {
    this.logger.info(`Manually escalating notification ${notificationId}`);

    const notification = await this.prisma.notification.findUnique({
      where: {
        id: notificationId,
      },
      include: {
        user: true,
        tenant: {
          include: {
            users: {
              where: {
                role: 'ADMIN',
              },
            },
          },
        },
      },
    });

    if (!notification) {
      this.logger.warn(`Notification ${notificationId} not found`);
      return;
    }

    await this.escalateToAdmins(notification);
  }
}
