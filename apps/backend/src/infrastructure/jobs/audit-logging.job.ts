import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger, Inject } from '@nestjs/common'
import { Job } from 'bullmq'
import { RoleChangeHistoryRepository } from '../../domain/identity-access/role-change-history.repository.interface'
import { RoleChangeHistory } from '../../domain/identity-access/role-change-history.entity'
import { PermissionAuditLogRepository } from '../../domain/identity-access/permission-audit-log.repository.interface'
import { PermissionAuditLog } from '../../domain/identity-access/permission-audit-log.entity'

/**
 * AuditLoggingProcessor
 * T148: Asynchronous audit event logging via BullMQ
 *
 * Requirements from plan.md:
 * - <1ms overhead for command handlers
 * - Async processing in background
 * - Retry failed audit logs (max 3 retries)
 * - Log failures but don't block operations
 *
 * Job Types:
 * - 'role-change': Log role assignment/revocation to RoleChangeHistory
 * - 'permission-check': Log permission checks to PermissionAuditLog (future)
 */
@Processor('audit-logging', {
  concurrency: 10, // Process 10 audit logs in parallel
})
export class AuditLoggingProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditLoggingProcessor.name)

  constructor(
    @Inject('RoleChangeHistoryRepository')
    private readonly roleChangeHistoryRepository: RoleChangeHistoryRepository,
    @Inject('PermissionAuditLogRepository')
    private readonly auditLogRepository: PermissionAuditLogRepository
  ) {
    super()
  }

  async process(job: Job): Promise<void> {
    const { type, data } = job.data

    switch (type) {
      case 'role-change':
        await this.processRoleChange(job, data)
        break
      case 'permission-check':
        await this.processPermissionCheck(job, data)
        break
      default:
        this.logger.warn(`Unknown audit log type: ${type}`)
    }
  }

  /**
   * Process role change audit event
   */
  private async processRoleChange(job: Job, data: any): Promise<void> {
    try {
      const roleChange = RoleChangeHistory.create({
        userId: data.userId,
        tenantId: data.tenantId,
        oldRoleId: data.oldRoleId,
        newRoleId: data.newRoleId,
        changedBy: data.changedBy,
        reason: data.reason,
        timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
        effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : new Date(),
        metadata: data.metadata,
      })

      await this.roleChangeHistoryRepository.save(roleChange)

      this.logger.debug(
        `[AUDIT] Logged role change for user ${data.userId}: ${data.oldRoleId} → ${data.newRoleId}`
      )
    } catch (error) {
      this.logger.error(`Failed to process role change audit: ${error.message}`, error.stack)

      // Retry failed jobs (BullMQ will handle retry logic)
      if (job.attemptsMade < 3) {
        throw error // Will trigger retry
      }

      // After 3 retries, log and discard
      this.logger.error(
        `Discarding role change audit after 3 failed attempts: ${JSON.stringify(data)}`
      )
    }
  }

  /**
   * Process permission check audit event
   * T149: Log all permission checks (granted AND denied)
   */
  private async processPermissionCheck(job: Job, data: any): Promise<void> {
    try {
      // Create permission audit log with cryptographic chaining
      const previousLog = await this.auditLogRepository.getLatestLog(data.tenantId)
      const previousHash = previousLog?.hash || '0' // Genesis log uses '0'

      const auditLog = PermissionAuditLog.create({
        userId: data.userId,
        tenantId: data.tenantId,
        actionAttempted: data.actionAttempted,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
        decision: data.decision,
        reason: data.reason,
        spidFiscalCode: data.spidFiscalCode,
        sessionId: data.sessionId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
        previousHash,
      })

      await this.auditLogRepository.save(auditLog)

      this.logger.debug(
        `[AUDIT] Logged permission check: user=${data.userId}, action=${data.actionAttempted}, decision=${data.decision}`
      )
    } catch (error) {
      this.logger.error(`Failed to process permission check audit: ${error.message}`, error.stack)

      // Retry failed jobs (BullMQ will handle retry logic)
      if (job.attemptsMade < 3) {
        throw error // Will trigger retry
      }

      // After 3 retries, log and discard
      this.logger.error(
        `Discarding permission check audit after 3 failed attempts: ${JSON.stringify(data)}`
      )
    }
  }
}
