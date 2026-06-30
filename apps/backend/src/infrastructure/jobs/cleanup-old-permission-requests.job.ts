import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, Inject } from '@nestjs/common'
import { Job } from 'bullmq'
import { TemporaryPermissionGrantRepository } from '../../domain/identity-access/temporary-permission-grant.repository.interface'
import { PrismaService } from '../persistence/prisma.service'

/**
 * Cleanup Old Permission Requests Job
 * T205: Background job for User Story 7 - Data Retention
 *
 * Purpose: Archive/delete old permission requests to maintain performance
 *
 * Requirements from spec.md:
 * - Runs daily at 2 AM
 * - Archives requests older than 90 days
 * - Keeps active and recently expired grants
 * - Maintains audit trail compliance (10-year retention)
 *
 * Requirements from plan.md:
 * - Monthly partitioning for large tables
 * - Move old data to cold storage
 * - Optimize query performance on main table
 */
@Processor('permission-cleanup')
export class CleanupOldPermissionRequestsJob extends WorkerHost {
  private readonly logger = new Logger(CleanupOldPermissionRequestsJob.name)

  private readonly RETENTION_DAYS = 90 // Keep requests for 90 days before archival
  private readonly BATCH_SIZE = 500 // Process in batches to avoid long transactions

  constructor(
    @Inject('TemporaryPermissionGrantRepository')
    private readonly grantRepository: TemporaryPermissionGrantRepository,
    private readonly prisma: PrismaService
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const startTime = Date.now()
    this.logger.log('🧹 Running permission requests cleanup job...')

    try {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - this.RETENTION_DAYS)

      // Find old grants that are expired and revoked
      const oldGrants = await this.prisma.temporaryPermissionGrant.findMany({
        where: {
          endTime: {
            lt: cutoffDate,
          },
          OR: [
            { autoRevoked: true },
            {
              endTime: {
                lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
              },
            },
          ],
        },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          createdAt: true,
          endTime: true,
        },
        take: this.BATCH_SIZE,
      })

      if (oldGrants.length === 0) {
        this.logger.log('✅ No old grants to archive')
        return
      }

      this.logger.log(`Found ${oldGrants.length} grant(s) older than ${this.RETENTION_DAYS} days`)

      let archivedCount = 0
      const deletedCount = 0
      let errorCount = 0

      // Archive grants before deletion (for audit compliance)
      for (const grant of oldGrants) {
        try {
          // TODO: Move to archive table or export to S3 for 10-year retention
          // Example: await this.archiveService.archiveGrant(grant);

          // For now, we'll just log the archival
          this.logger.debug(`Would archive grant ${grant.id} from ${grant.createdAt.toISOString()}`)

          archivedCount++

          // After archiving, we could delete from main table to improve performance
          // Commented out for safety - enable only after archive strategy is in place
          // await this.grantRepository.delete(grant.id, grant.tenantId);
          // deletedCount++;
        } catch (error) {
          errorCount++
          this.logger.error(`Failed to archive grant ${grant.id}: ${error.message}`, error.stack)
        }
      }

      const duration = Date.now() - startTime
      this.logger.log(
        `✅ Cleanup complete: ${archivedCount} archived, ${deletedCount} deleted, ${errorCount} errors (${duration}ms)`
      )

      return {
        archived: archivedCount,
        deleted: deletedCount,
        errors: errorCount,
        duration,
      } as any
    } catch (error) {
      this.logger.error(`Cleanup job failed: ${error.message}`, error.stack)
      throw error // Re-throw to trigger BullMQ retry logic
    }
  }
}
