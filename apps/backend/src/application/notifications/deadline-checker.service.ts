import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { TemplateService } from '../../infrastructure/email/template.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { LoggerService } from '../../core/logger/logger.service';

/**
 * Deadline Checker Service
 *
 * Scheduled jobs for monitoring compliance deadlines:
 * - MUD report submission deadlines
 * - Register vidimazione deadlines
 * - Authorization expiration dates
 */
@Injectable()
export class DeadlineCheckerService {
  // MUD deadline: April 30th each year
  private readonly MUD_DEADLINE_MONTH = 3; // April (0-indexed)
  private readonly MUD_DEADLINE_DAY = 30;

  // Notification intervals (days before deadline)
  private readonly NOTIFICATION_INTERVALS = [30, 15, 7, 3, 1];

  constructor(
    private readonly prisma: PrismaService,
    private readonly templateService: TemplateService,
    private readonly emailService: EmailService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(DeadlineCheckerService.name);
  }

  /**
   * Check MUD deadlines daily at 8:00 AM
   * Sends reminder notifications at 30, 15, 7, 3, and 1 days before deadline
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async checkMudDeadlines(): Promise<void> {
    this.logger.info('Starting MUD deadline check');

    try {
      const today = new Date();
      const currentYear = today.getFullYear();
      const previousYear = currentYear - 1;

      // Calculate this year's MUD deadline (April 30th)
      const deadline = new Date(currentYear, this.MUD_DEADLINE_MONTH, this.MUD_DEADLINE_DAY);
      const daysUntilDeadline = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Skip if deadline has passed or too far in future
      if (daysUntilDeadline < 0 || daysUntilDeadline > 30) {
        this.logger.debug(`MUD deadline is ${daysUntilDeadline} days away, skipping notifications`);
        return;
      }

      // Check if we should send notifications today
      if (!this.NOTIFICATION_INTERVALS.includes(daysUntilDeadline)) {
        this.logger.debug(`No notification scheduled for ${daysUntilDeadline} days before deadline`);
        return;
      }

      this.logger.info(`Sending MUD deadline reminders: ${daysUntilDeadline} days remaining`);

      // Find all active tenants with MUD reports for previous year
      const tenants = await this.prisma.tenant.findMany({
        where: {
          subscriptionStatus: {
            in: ['ACTIVE', 'TRIAL'], // Include active and trial subscriptions
          },
        },
        include: {
          mudReports: {
            where: {
              year: previousYear,
            },
          },
          users: {
            where: {
              role: {
                in: ['ADMIN', 'OPERATOR'], // Only notify admins and operators
              },
            },
          },
        },
      });

      let notificationsSent = 0;

      for (const tenant of tenants) {
        // Get or create MUD report for previous year
        let mudReport = tenant.mudReports[0];

        if (!mudReport) {
          this.logger.info(`Creating draft MUD report for tenant ${tenant.id}, year ${previousYear}`);
          mudReport = await this.prisma.mUDReport.create({
            data: {
              tenantId: tenant.id,
              year: previousYear,
              status: 'DRAFT',
              reportData: {},
            },
          });
        }

        // Determine completion status
        const isComplete = mudReport.status === 'SUBMITTED';
        const reportData = mudReport.reportData as any;
        const completionPercentage = this.calculateMudCompletionPercentage(reportData);
        const missingData = this.getMudMissingData(reportData);

        // Send notifications to all admin/operator users
        for (const user of tenant.users) {
          try {
            const html = await this.templateService.renderMudDeadlineReminder({
              recipientName: `${user.firstName} ${user.lastName}`,
              year: currentYear,
              deadline: deadline.toLocaleDateString('it-IT', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              }),
              daysRemaining: daysUntilDeadline,
              companyName: tenant.ragioneSociale,
              referenceYear: previousYear,
              isComplete,
              completionPercentage,
              missingData,
              mudUrl: `${process.env.PUBLIC_URL || 'https://wasteflow.app'}/mud/${mudReport.id}`,
            });

            await this.emailService.sendEmail({
              to: user.email,
              subject: `[WasteFlow] Promemoria Scadenza MUD ${previousYear}`,
              html,
            });

            // Create in-app notification
            await this.prisma.notification.create({
              data: {
                tenantId: tenant.id,
                userId: user.id,
                type: 'MUD_DEADLINE_APPROACHING',
                title: `Promemoria Scadenza MUD ${previousYear}`,
                message: `Mancano ${daysUntilDeadline} giorni alla scadenza del MUD. ${isComplete ? 'Il MUD è pronto per l\'invio.' : `Completamento: ${completionPercentage}%`}`,
                severity: daysUntilDeadline <= 7 ? 'WARNING' : 'INFO',
                actionUrl: `/mud/${mudReport.id}`,
                isRead: false,
              },
            });

            notificationsSent++;
            this.logger.debug(`Sent MUD reminder to ${user.email}`);
          } catch (error) {
            this.logger.error(`Failed to send MUD reminder to ${user.email}`, error);
          }
        }
      }

      this.logger.info(`MUD deadline check completed: ${notificationsSent} notifications sent`);
    } catch (error) {
      this.logger.error('Failed to check MUD deadlines', error);
      throw error;
    }
  }

  /**
   * Check vidimazione (register validation) deadlines daily at 9:00 AM
   * TODO: Implement when Register entities are added to schema
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async checkVidimazioneDeadlines(): Promise<void> {
    this.logger.info('Starting vidimazione deadline check');

    try {
      // TODO: Implement when Register models are added
      // - Query registers needing vidimazione
      // - Check deadline (typically 60 days from first use)
      // - Send reminders using templateService.renderVidimazioneReminder()

      this.logger.debug('Vidimazione deadline check not yet implemented (awaiting Register schema)');
    } catch (error) {
      this.logger.error('Failed to check vidimazione deadlines', error);
    }
  }

  /**
   * Check authorization expiration dates daily at 10:00 AM
   * TODO: Implement when Authorization entities are added to schema
   */
  @Cron(CronExpression.EVERY_DAY_AT_10AM)
  async checkAuthorizationExpirations(): Promise<void> {
    this.logger.info('Starting authorization expiration check');

    try {
      // TODO: Implement when Authorization models are added
      // - Query authorizations expiring within 180 days
      // - Check intervals (180, 90, 60, 30, 15, 7, 3, 1 days)
      // - Send reminders using templateService.renderAuthorizationExpiration()
      // - Mark expired authorizations

      this.logger.debug('Authorization expiration check not yet implemented (awaiting Authorization schema)');
    } catch (error) {
      this.logger.error('Failed to check authorization expirations', error);
    }
  }

  /**
   * Cleanup old read notifications weekly (Sundays at midnight)
   */
  @Cron(CronExpression.EVERY_WEEK)
  async cleanupOldNotifications(): Promise<void> {
    this.logger.info('Starting notification cleanup');

    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const result = await this.prisma.notification.deleteMany({
        where: {
          createdAt: {
            lt: thirtyDaysAgo,
          },
          isRead: true,
        },
      });

      this.logger.info(`Cleaned up ${result.count} old notifications`);
    } catch (error) {
      this.logger.error('Failed to cleanup old notifications', error);
    }
  }

  /**
   * Calculate MUD completion percentage based on reportData
   */
  private calculateMudCompletionPercentage(reportData: any): number {
    if (!reportData || typeof reportData !== 'object') {
      return 0;
    }

    const requiredFields = [
      'companyInfo',
      'legalRepresentative',
      'wasteProduced',
      'wasteReceived',
      'wasteTransported',
      'certificates',
    ];

    let completedFields = 0;

    for (const field of requiredFields) {
      if (reportData[field] && Object.keys(reportData[field]).length > 0) {
        completedFields++;
      }
    }

    return Math.round((completedFields / requiredFields.length) * 100);
  }

  /**
   * Get list of missing data sections for MUD report
   */
  private getMudMissingData(reportData: any): string[] {
    if (!reportData || typeof reportData !== 'object') {
      return [
        'Dati azienda',
        'Rappresentante legale',
        'Rifiuti prodotti',
        'Rifiuti ricevuti',
        'Rifiuti trasportati',
        'Certificati analitici',
      ];
    }

    const missing: string[] = [];

    if (!reportData.companyInfo || Object.keys(reportData.companyInfo).length === 0) {
      missing.push('Dati azienda');
    }
    if (!reportData.legalRepresentative || Object.keys(reportData.legalRepresentative).length === 0) {
      missing.push('Rappresentante legale');
    }
    if (!reportData.wasteProduced || Object.keys(reportData.wasteProduced).length === 0) {
      missing.push('Rifiuti prodotti');
    }
    if (!reportData.wasteReceived || Object.keys(reportData.wasteReceived).length === 0) {
      missing.push('Rifiuti ricevuti');
    }
    if (!reportData.wasteTransported || Object.keys(reportData.wasteTransported).length === 0) {
      missing.push('Rifiuti trasportati');
    }
    if (!reportData.certificates || Object.keys(reportData.certificates).length === 0) {
      missing.push('Certificati analitici');
    }

    return missing;
  }
}
