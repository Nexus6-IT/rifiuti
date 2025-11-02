import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsModule } from '../../application/notifications/notifications.module';

/**
 * Notifications API Module
 */
@Module({
  imports: [NotificationsModule],
  controllers: [NotificationsController],
})
export class NotificationsApiModule {}
