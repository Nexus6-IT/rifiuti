import { Injectable } from '@nestjs/common'
import { LoggerService } from '../../core/logger/logger.service'

/**
 * Trigger Batch Sync Use Case
 *
 * Queues multiple FIRs for RENTRI synchronization in batch.
 * Useful for:
 * - Manual bulk sync operations
 * - Retry failed syncs
 * - Scheduled batch processing
 */
@Injectable()
export class TriggerBatchSyncUseCase {
  constructor(
    private readonly firRepository: any,
    private readonly rentriSyncQueue: any, // RENTRISyncQueue - will be injected
    private readonly logger: LoggerService
  ) {
    this.logger.setContext('TriggerBatchSyncUseCase')
  }

  /**
   * Trigger batch sync for multiple FIRs
   */
  async execute(params: {
    firIds: string[]
    tenantId: string
    priority?: 'low' | 'normal' | 'high'
  }): Promise<BatchSyncResult> {
    const { firIds, tenantId, priority = 'normal' } = params

    this.logger.info(`Triggering batch sync for ${firIds.length} FIRs`, {
      tenantId,
      firCount: firIds.length,
      priority,
    })

    const results = {
      totalCount: firIds.length,
      queuedCount: 0,
      skippedCount: 0,
      skippedReasons: [] as Array<{ firId: string; reason: string }>,
      batchJobId: null as string | null,
    }

    // Validate all FIRs exist and belong to tenant
    const firs = await this.firRepository.findByIds(firIds, tenantId)

    if (firs.length !== firIds.length) {
      const foundIds = firs.map((f: any) => f.id)
      const missingIds = firIds.filter(id => !foundIds.includes(id))

      for (const missingId of missingIds) {
        results.skippedCount++
        results.skippedReasons.push({
          firId: missingId,
          reason: 'FIR not found or unauthorized',
        })
      }
    }

    // Filter FIRs that can be synced
    const syncableFIRs = []
    for (const fir of firs) {
      if (fir.canSyncToRENTRI()) {
        syncableFIRs.push(fir)
      } else {
        results.skippedCount++
        results.skippedReasons.push({
          firId: fir.id,
          reason: this.getSkipReason(fir),
        })
      }
    }

    // Queue sync jobs
    if (syncableFIRs.length > 0) {
      const batchJobId = await this.rentriSyncQueue.addBatchJob({
        firIds: syncableFIRs.map((f: any) => f.id),
        tenantId,
        priority,
      })

      results.queuedCount = syncableFIRs.length
      results.batchJobId = batchJobId

      this.logger.info(`Batch sync queued`, {
        batchJobId,
        queuedCount: results.queuedCount,
        skippedCount: results.skippedCount,
      })
    }

    return results
  }

  /**
   * Get reason why FIR was skipped
   */
  private getSkipReason(fir: any): string {
    if (fir.status !== 'COMPLETED') {
      return `Not completed (status: ${fir.status})`
    }

    if (fir.rentriSyncStatus.getStatus() === 'SYNCED') {
      return 'Already synced'
    }

    if (fir.rentriSyncStatus.getStatus() === 'PERMANENTLY_FAILED') {
      return 'Permanently failed - manual intervention required'
    }

    return 'Cannot sync'
  }
}

export interface BatchSyncResult {
  totalCount: number
  queuedCount: number
  skippedCount: number
  skippedReasons: Array<{ firId: string; reason: string }>
  batchJobId: string | null
}
