import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupController } from '../../api/backup/backup.controller';
import { LoggerModule } from '../../core/logger/logger.module';

/**
 * Backup Module
 *
 * Handles automated database backups and restoration.
 */
@Module({
  imports: [LoggerModule],
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
