import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../core/logger/logger.service';

/**
 * Get Sync Status Use Case
 *
 * Retrieves status of RENTRI sync job from queue.
 * Used for polling job status from frontend.
 */
@Injectable()
export class GetSyncStatusUseCase {
  constructor(
    private readonly rentriSyncQueue: any, // RENTRISyncQueue
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('GetSyncStatusUseCase');
  }

  /**
   * Get job status by ID
   */
  async execute(jobId: string, tenantId: string): Promise<SyncJobStatus> {
    try {
      const job = await this.rentriSyncQueue.getJob(jobId);

      if (!job) {
        throw new Error('Job not found');
      }

      // Verify tenant isolation
      if (job.data.tenantId !== tenantId) {
        throw new Error('Unauthorized access to job');
      }

      const state = await job.getState();

      return {
        jobId: job.id,
        status: this.mapJobState(state),
        progress: job.progress || 0,
        data: job.data,
        result: job.returnvalue,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
        processedOn: job.processedOn ? new Date(job.processedOn) : undefined,
        finishedOn: job.finishedOn ? new Date(job.finishedOn) : undefined,
      };
    } catch (error: any) {
      this.logger.error('Failed to get sync status', error, { jobId, tenantId });
      throw error;
    }
  }

  /**
   * Map BullMQ job state to user-friendly status
   */
  private mapJobState(state: string): string {
    const stateMap: Record<string, string> = {
      waiting: 'pending',
      active: 'processing',
      completed: 'completed',
      failed: 'failed',
      delayed: 'delayed',
    };

    return stateMap[state] || state;
  }
}

export interface SyncJobStatus {
  jobId: string;
  status: string;
  progress: number;
  data: any;
  result?: any;
  failedReason?: string;
  attemptsMade: number;
  processedOn?: Date;
  finishedOn?: Date;
}
