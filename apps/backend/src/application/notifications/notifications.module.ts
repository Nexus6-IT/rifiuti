import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { DeadlineCheckerService } from './deadline-checker.service';
import { NotificationEscalationService } from './notification-escalation.service';
import { EmailService } from '../../infrastructure/email/email.service';
import { TemplateService } from '../../infrastructure/email/template.service';
import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { LoggerModule } from '../../core/logger/logger.module';

/**
 * Notifications Module
 *
 * Handles in-app and email notifications with deadline monitoring and escalation.
 */
@Module({
  imports: [PrismaModule, LoggerModule],
  providers: [
    NotificationService,
    DeadlineCheckerService,
    NotificationEscalationService,
    EmailService,
    TemplateService,
  ],
  exports: [NotificationService, EmailService],
})
export class NotificationsModule {}
