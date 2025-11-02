import { Controller, Post, Get, Delete, Query, UseGuards, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { BackupService } from '../../infrastructure/backup/backup.service';

/**
 * Backup Controller
 *
 * Handles manual database backup operations.
 * Note: Automated backups run via cron jobs in production.
 */
@Controller('backup')
@UseGuards(JwtAuthGuard)
@ApiTags('Backup')
@ApiBearerAuth()
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a manual database backup' })
  @HttpCode(200)
  async createBackup() {
    return await this.backupService.createBackup();
  }

  @Get('list')
  @ApiOperation({ summary: 'List all available backups' })
  async listBackups() {
    return await this.backupService.listBackups();
  }

  @Post('restore')
  @ApiOperation({ summary: 'Restore database from a backup file' })
  @ApiQuery({ name: 'filename', required: true, type: String })
  @HttpCode(200)
  async restoreBackup(@Query('filename') filename: string) {
    return await this.backupService.restoreBackup(filename);
  }

  @Delete('cleanup')
  @ApiOperation({ summary: 'Cleanup old backups (older than 30 days)' })
  @HttpCode(200)
  async cleanupOldBackups() {
    const deletedCount = await this.backupService.cleanupOldBackups();
    return { deleted: deletedCount };
  }
}
