import { Injectable, OnModuleInit } from '@nestjs/common'
import { Worker, Job } from 'bullmq'
import { ConfigService } from '@nestjs/config'
import { LoggerService } from '../../../core/logger/logger.service'
import { MetricsService } from '../../../core/metrics/metrics.service'
import { SyncFIRToRENTRIUseCase } from '../../../application/rentri/sync-fir-to-rentri.use-case'
import { RENTRISyncQueue } from '../rentri-sync.queue'

/**
 * RENTRI Sync Job Processor
 *
 * BullMQ worker that processes RENTRI sync jobs.
 * Executes the SyncFIRToRENTRIUseCase for each job.
 *
 * Job Types:
 * - sync-fir: Single FIR synchronization
 * - sync-batch: Batch FIR synchronization
 *
 * Retry Strategy:
 * - Configured in queue: 5 attempts with exponential backoff
 * - Base delay: 60 seconds
 * - Backoff multiplier: 2^attempt
 * - Max backoff: Capped at use case level (60 minutes)
 *
 * Error Handling:
 * - Validation errors: Not retried (permanent failure)
 * - API errors: Retried with backoff
 * - Timeout errors: Retried with backoff
 */
@Injectable()
export class RENTRISyncJobProcessor implements OnModuleInit {
  private worker: Worker

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    private readonly syncFIRUseCase: SyncFIRToRENTRIUseCase,
    private readonly rentriSyncQueue: RENTRISyncQueue
  ) {
    this.logger.setContext('RENTRISyncJobProcessor')
  }

  /**
   * Initialize BullMQ worker on module init
   */
  async onModuleInit() {
    const redisHost = this.configService.get<string>('REDIS_HOST') || 'localhost'
    const redisPort = this.configService.get<number>('REDIS_PORT') || 6379
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD')

    this.worker = new Worker('rentri-sync', async (job: Job) => this.processJob(job), {
      connection: {
        host: redisHost,
        port: redisPort,
        password: redisPassword,
      },
      concurrency: this.configService.get<number>('RENTRI_SYNC_CONCURRENCY') || 5,
      limiter: {
        max: 10, // Max 10 jobs per interval
        duration: 1000, // 1 second interval
      },
    })

    // Setup event listeners
    this.setupEventListeners()

    this.logger.info('RENTRI sync job processor initialized', {
      redisHost,
      redisPort,
      concurrency: 5,
    })
  }

  /**
   * Process a job
   */
  private async processJob(job: Job): Promise<any> {
    const { type, firId, firIds, tenantId, correlationId } = job.data

    this.logger.info('Processing RENTRI sync job', {
      jobId: job.id,
      type,
      firId,
      firIds,
      tenantId,
      correlationId,
      attemptsMade: job.attemptsMade,
    })

    try {
      if (type === 'single') {
        return await this.processSingleSync(job)
      } else if (type === 'batch') {
        return await this.processBatchSync(job)
      } else {
        throw new Error(`Unknown job type: ${type}`)
      }
    } catch (error: any) {
      this.logger.error('Job processing failed', error, {
        jobId: job.id,
        type,
        firId,
        tenantId,
        attemptsMade: job.attemptsMade,
      })

      // Increment failure metric
      // TODO: rentriSyncJobsFailed metric doesn't exist in MetricsService
      // this.metrics.rentriSyncJobsFailed.inc({
      //   tenant_id: tenantId,
      //   job_type: type,
      // });

      // Check if this is a validation error (should not retry)
      if (this.isValidationError(error)) {
        this.logger.warn('Validation error - marking job as failed without retry', {
          jobId: job.id,
          error: error.message,
        })

        // Move job to failed queue without retry
        await job.moveToFailed(new Error(`Validation error: ${error.message}`), '0', false)
        return
      }

      // For other errors, let BullMQ handle retry with exponential backoff
      throw error
    }
  }

  /**
   * Process single FIR sync
   */
  private async processSingleSync(job: Job): Promise<SyncJobResult> {
    const { firId, tenantId, correlationId } = job.data
    const startTime = Date.now()

    try {
      // Update job progress
      await job.updateProgress(10)

      // Execute sync use case
      const result = await this.syncFIRUseCase.execute(firId, tenantId, correlationId)

      const duration = Date.now() - startTime

      await job.updateProgress(100)

      // Record success metric using firSyncDuration
      this.metrics.firSyncDuration.observe({ tenant_id: tenantId }, duration / 1000)

      this.logger.info('Single FIR sync completed', {
        jobId: job.id,
        firId,
        tenantId,
        success: result.success,
        protocolNumber: result.protocolNumber,
        duration,
      })

      return {
        jobId: job.id as string,
        type: 'single',
        success: result.success,
        firId,
        protocolNumber: result.protocolNumber,
        duration,
      }
    } catch (error: any) {
      const duration = Date.now() - startTime

      this.metrics.firSyncDuration.observe({ tenant_id: tenantId }, duration / 1000)

      throw error
    }
  }

  /**
   * Process batch FIR sync
   */
  private async processBatchSync(job: Job): Promise<SyncJobResult> {
    const { firIds, tenantId, correlationId } = job.data
    const startTime = Date.now()

    const results: Array<{ firId: string; success: boolean; error?: string }> = []
    const total = firIds.length
    let successCount = 0
    let failureCount = 0

    this.logger.info('Starting batch sync', {
      jobId: job.id,
      totalFIRs: total,
      tenantId,
    })

    try {
      for (let i = 0; i < firIds.length; i++) {
        const firId = firIds[i]

        // Update progress
        const progress = Math.floor(((i + 1) / total) * 100)
        await job.updateProgress(progress)

        try {
          const result = await this.syncFIRUseCase.execute(firId, tenantId, correlationId)

          results.push({
            firId,
            success: result.success,
          })

          if (result.success) {
            successCount++
          } else {
            failureCount++
          }

          this.logger.info('Batch item processed', {
            jobId: job.id,
            firId,
            success: result.success,
            progress: `${i + 1}/${total}`,
          })
        } catch (error: any) {
          failureCount++
          results.push({
            firId,
            success: false,
            error: error.message,
          })

          this.logger.error('Batch item failed', error, {
            jobId: job.id,
            firId,
            progress: `${i + 1}/${total}`,
          })

          // Continue with next FIR even if one fails
        }
      }

      const duration = Date.now() - startTime

      // Record batch metric
      // TODO: rentriSyncBatchCompleted metric doesn't exist in MetricsService
      // this.metrics.rentriSyncBatchCompleted.inc({
      //   tenant_id: tenantId,
      // });

      this.logger.info('Batch sync completed', {
        jobId: job.id,
        tenantId,
        total,
        successCount,
        failureCount,
        duration,
      })

      return {
        jobId: job.id as string,
        type: 'batch',
        success: failureCount === 0,
        total,
        successCount,
        failureCount,
        results,
        duration,
      }
    } catch (error: any) {
      const duration = Date.now() - startTime

      this.logger.error('Batch sync failed', error, {
        jobId: job.id,
        tenantId,
        total,
        processed: results.length,
        duration,
      })

      throw error
    }
  }

  /**
   * Check if error is a validation error (should not retry)
   */
  private isValidationError(error: any): boolean {
    const validationErrorMessages = [
      'RENTRI_SYNC_REQUIRES_COMPLETED_FIR',
      'ALREADY_SYNCED_TO_RENTRI',
      'BUSINESS_RULE_VIOLATION',
      'VALIDATION_ERROR',
    ]

    return validationErrorMessages.some(
      msg => error.message?.includes(msg) || error.code?.includes(msg)
    )
  }

  /**
   * Setup worker event listeners
   */
  private setupEventListeners(): void {
    this.worker.on('completed', (job: Job, result: any) => {
      this.logger.info('Job completed', {
        jobId: job.id,
        type: job.data.type,
        tenantId: job.data.tenantId,
        result,
      })

      // Record completion metric
      // TODO: rentriSyncJobsCompleted metric doesn't exist in MetricsService
      // this.metrics.rentriSyncJobsCompleted.inc({
      //   tenant_id: job.data.tenantId,
      //   job_type: job.data.type,
      // });
    })

    this.worker.on('failed', (job: Job | undefined, error: Error) => {
      if (!job) {
        this.logger.error('Job failed without job data', error)
        return
      }

      this.logger.error('Job failed', error, {
        jobId: job.id,
        type: job.data.type,
        tenantId: job.data.tenantId,
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
      })

      // Metric already recorded in processJob
    })

    this.worker.on('active', (job: Job) => {
      this.logger.debug('Job started', {
        jobId: job.id,
        type: job.data.type,
        tenantId: job.data.tenantId,
      })

      // Record active job metric
      // TODO: rentriSyncActiveJobs metric doesn't exist in MetricsService
      // this.metrics.rentriSyncActiveJobs.set(
      //   { tenant_id: job.data.tenantId },
      //   1,
      // );
    })

    this.worker.on('stalled', (jobId: string) => {
      this.logger.warn('Job stalled', { jobId })
    })

    this.worker.on('error', (error: Error) => {
      this.logger.error('Worker error', error)
    })
  }

  /**
   * Graceful shutdown
   */
  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close()
      this.logger.info('RENTRI sync worker closed')
    }
  }
}

/**
 * Job Result Interface
 */
export interface SyncJobResult {
  jobId: string
  type: 'single' | 'batch'
  success: boolean
  firId?: string
  protocolNumber?: string
  total?: number
  successCount?: number
  failureCount?: number
  results?: Array<{ firId: string; success: boolean; error?: string }>
  duration: number
}
