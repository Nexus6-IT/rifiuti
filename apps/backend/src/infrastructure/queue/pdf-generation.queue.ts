import { Injectable } from '@nestjs/common'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { LoggerService } from '../../core/logger/logger.service'
import { PdfGenerationJobData, PdfGenerationJobResult } from './jobs/pdf-generation.job'

/**
 * PDF Generation Queue Service
 *
 * Manages PDF generation jobs:
 * - Single document PDF generation
 * - Batch PDF generation
 * - Job status tracking
 * - Job cancellation
 */
@Injectable()
export class PdfGenerationQueueService {
  constructor(
    @InjectQueue('pdf-generation')
    private readonly pdfQueue: Queue<PdfGenerationJobData, PdfGenerationJobResult>,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(PdfGenerationQueueService.name)
  }

  /**
   * Queue single PDF generation
   */
  async queueSinglePdf(params: {
    tenantId: string
    documentType: 'fir' | 'mud'
    documentId: string
    requestedBy: string
    options?: {
      includeAttachments?: boolean
      useTemplate?: string
    }
  }): Promise<string> {
    const job = await this.pdfQueue.add(
      'generate-single',
      {
        tenantId: params.tenantId,
        documentType: params.documentType,
        documentIds: [params.documentId],
        requestedBy: params.requestedBy,
        options: params.options,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: 1000, // Keep last 1000 completed jobs
        removeOnFail: 5000, // Keep last 5000 failed jobs
      }
    )

    this.logger.info(
      `Queued single PDF generation: jobId=${job.id}, documentId=${params.documentId}`
    )

    return job.id!
  }

  /**
   * Queue batch PDF generation
   */
  async queueBatchPdf(params: {
    tenantId: string
    documentType: 'fir' | 'mud'
    documentIds: string[]
    requestedBy: string
    batchId?: string
    options?: {
      includeAttachments?: boolean
      useTemplate?: string
    }
  }): Promise<string> {
    const batchId = params.batchId || `batch-${Date.now()}`

    const job = await this.pdfQueue.add(
      'generate-batch',
      {
        tenantId: params.tenantId,
        documentType: params.documentType,
        documentIds: params.documentIds,
        batchId,
        requestedBy: params.requestedBy,
        options: params.options,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 10000,
        },
        removeOnComplete: 500,
        removeOnFail: 2000,
        priority: params.documentIds.length > 10 ? 5 : 10, // Lower priority for large batches
      }
    )

    this.logger.info(
      `Queued batch PDF generation: jobId=${job.id}, batchId=${batchId}, count=${params.documentIds.length}`
    )

    return job.id!
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<{
    id: string
    state: string
    progress: number
    result?: PdfGenerationJobResult
    error?: string
  }> {
    const job = await this.pdfQueue.getJob(jobId)

    if (!job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    const state = await job.getState()
    const progress = (job.progress as number) || 0
    const result = job.returnvalue
    const error = job.failedReason

    return {
      id: jobId,
      state,
      progress,
      result,
      error,
    }
  }

  /**
   * Cancel job
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = await this.pdfQueue.getJob(jobId)

    if (!job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    await job.remove()

    this.logger.info(`PDF generation job cancelled: ${jobId}`)
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics(): Promise<{
    waiting: number
    active: number
    completed: number
    failed: number
    delayed: number
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.pdfQueue.getWaitingCount(),
      this.pdfQueue.getActiveCount(),
      this.pdfQueue.getCompletedCount(),
      this.pdfQueue.getFailedCount(),
      this.pdfQueue.getDelayedCount(),
    ])

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
    }
  }

  /**
   * Clear completed jobs older than specified hours
   */
  async clearOldJobs(olderThanHours: number = 24): Promise<number> {
    const olderThanMs = olderThanHours * 60 * 60 * 1000
    const gracePeriod = Date.now() - olderThanMs

    const completed = await this.pdfQueue.clean(gracePeriod, 1000, 'completed')
    const failed = await this.pdfQueue.clean(gracePeriod, 1000, 'failed')

    const totalCleaned = completed.length + failed.length

    this.logger.info(
      `Cleaned ${totalCleaned} old PDF jobs (completed: ${completed.length}, failed: ${failed.length})`
    )

    return totalCleaned
  }
}
