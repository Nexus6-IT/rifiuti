import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, Inject } from '@nestjs/common'
import { Job } from 'bullmq'
import { TemporaryPermissionGrantRepository } from '../../domain/identity-access/temporary-permission-grant.repository.interface'

/**
 * Expire Temporary Permissions Job
 * T204: Background job for User Story 7 - Temporary Permission Expiration
 *
 * Purpose: Auto-expire temporary permission grants past their endTime
 *
 * Requirements from spec.md FR-016:
 * - Runs every 5 minutes
 * - Auto-revokes expired grants
 * - Invalidates permission cache for affected users
 * - Sends notifications to users and admins
 *
 * Requirements from plan.md:
 * - Process max 1000 grants per run (<30 seconds)
 * - Publish cache invalidation events via Redis pub/sub
 * - Log all expirations for audit trail
 */
@Processor('permission-expiration')
export class ExpireTempPermissionsJob extends WorkerHost {
  private readonly logger = new Logger(ExpireTempPermissionsJob.name)

  constructor(
    @Inject('TemporaryPermissionGrantRepository')
    private readonly grantRepository: TemporaryPermissionGrantRepository
  ) {
    super()
  }

  async process(_job: Job): Promise<void> {
    const startTime = Date.now()
    this.logger.log('🔄 Running temporary permission expiration check...')

    try {
      // Find all grants that need expiration (past endTime, not auto-revoked)
      const expiredGrants = await this.grantRepository.findGrantsNeedingExpiration()

      if (expiredGrants.length === 0) {
        this.logger.log('✅ No grants to expire')
        return
      }

      this.logger.log(`Found ${expiredGrants.length} grant(s) to expire`)

      const affectedUsers = new Set<string>()
      let expiredCount = 0
      let errorCount = 0

      // Process each expired grant
      for (const grant of expiredGrants) {
        try {
          // Only revoke if it's currently approved
          if (grant.isApproved() && !grant.isActive()) {
            grant.revoke('system', 'Auto-expired after grant period ended')
            await this.grantRepository.save(grant)

            affectedUsers.add(`${grant.userId}:${grant.tenantId}`)
            expiredCount++

            this.logger.debug(
              `Expired grant ${grant.id} for user ${grant.userId} (${grant.permissions.length} permissions)`
            )
          }
        } catch (error) {
          errorCount++
          this.logger.error(`Failed to expire grant ${grant.id}: ${error.message}`, error.stack)
        }
      }

      // TODO: Publish cache invalidation events for affected users via Redis pub/sub
      // Example: await this.redisPubSub.publish('permission-cache-invalidate', Array.from(affectedUsers));

      // TODO: Send notifications to affected users
      // Example: await this.notificationService.notifyGrantExpired(grant.userId, grant.tenantId, grant.permissions);

      const duration = Date.now() - startTime
      this.logger.log(
        `✅ Expiration complete: ${expiredCount} expired, ${errorCount} errors, ${affectedUsers.size} users affected (${duration}ms)`
      )

      // Performance check: Should process 1000 grants in <30 seconds per plan.md
      if (duration > 30000) {
        this.logger.warn(
          `⚠️ Expiration job took ${duration}ms (target: <30000ms). Consider optimizing.`
        )
      }

      return {
        expired: expiredCount,
        errors: errorCount,
        affectedUsers: affectedUsers.size,
        duration,
      } as any
    } catch (error) {
      this.logger.error(`Expiration job failed: ${error.message}`, error.stack)
      throw error // Re-throw to trigger BullMQ retry logic
    }
  }
}
