import { Module } from '@nestjs/common'
import { NotificationService } from './notification.service'
import { DeadlineCheckerService } from './deadline-checker.service'
import { NotificationEscalationService } from './notification-escalation.service'
import { EmailService } from '../../infrastructure/email/email.service'
import { TemplateService } from '../../infrastructure/email/template.service'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { MudVersionRegistry } from '../mud/export/mud-version.registry'

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
    MudVersionRegistry,
  ],
  exports: [
    NotificationService,
    EmailService,
    // Esportato per il rilancio manuale dalla pagina «Stato del sistema»
    // (JobActionsService, azione 'scadenzario-autorizzazioni'): riprovvederlo
    // in quel modulo creerebbe una SECONDA istanza con i propri @Cron
    // registrati, cioe' raddoppierebbe i job schedulati (stessa convenzione
    // gia' in uso per RentriSyncModule/ReferenceDataModule).
    DeadlineCheckerService,
  ],
})
export class NotificationsModule {}
