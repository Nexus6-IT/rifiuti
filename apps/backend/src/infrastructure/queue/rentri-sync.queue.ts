import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue, Job } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../../core/logger/logger.service';

/**
 * RENTRI Sync Queue
 *
 * BullMQ-based job queue for asynchronous RENTRI sync operations.
 * Supports single and batch FIR synchronization with configurable priorities and delays.
 *
 * Queue Features:
 * - Single FIR sync jobs
 * - Batch FIR sync jobs
 * - Priority levels: high, normal, low
 * - Delayed job execution
 * - Exponential backoff retry (handled by job processor)
 * - Job status tracking
 *
 * Retry Strategy:
 * - Max attempts: 5
 * - Backoff: Exponential (2^attempt * 60s)
 * - Max backoff: 60 minutes
 */
@Injectable()
export class RENTRISyncQueue implements OnModuleInit {
  private queue: Queue;
  private readonly queueName = 'rentri-sync';

  constructor(
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('RENTRISyncQueue');
  }

  /**
   * Initialize BullMQ queue on module init
   */
  async onModuleInit() {
    const redisHost = this.configService.get<string>('REDIS_HOST') || 'localhost';
    const redisPort = this.configService.get<number>('REDIS_PORT') || 6379;
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

    this.queue = new Queue(this.queueName, {
      connection: {
        host: redisHost,
        port: redisPort,
        password: redisPassword,
      },
      defaultJobOptions: {
        attempts: 5, // Max retry attempts
        backoff: {
          type: 'exponential',
          delay: 60000, // Base delay: 60 seconds (exponential will multiply)
        },
        removeOnComplete: {
          age: 86400, // Keep completed jobs for 24 hours
          count: 1000, // Keep max 1000 completed jobs
        },
        removeOnFail: {
          age: 604800, // Keep failed jobs for 7 days for debugging
        },
      },
    });

    this.logger.info('RENTRI sync queue initialized', {
      queueName: this.queueName,
      redisHost,
      redisPort,
    });
  }

  /**
   * Add single FIR sync job
   */
  async addSyncJob(params: {
    firId: string;
    tenantId: string;
    correlationId?: string;
    delay?: number; // Delay in milliseconds
    priority?: 'high' | 'normal' | 'low';
  }): Promise<string> {
    const { firId, tenantId, correlationId, delay = 0, priority = 'normal' } = params;

    const job = await this.queue.add(
      'sync-fir',
      {
        firId,
        tenantId,
        correlationId: correlationId || this.generateCorrelationId(),
        type: 'single',
      },
      {
        delay,
        priority: this.getPriorityValue(priority),
        jobId: `sync-${firId}-${Date.now()}`, // Unique job ID
      },
    );

    this.logger.info('RENTRI sync job added', {
      jobId: job.id,
      firId,
      tenantId,
      priority,
      delay,
    });

    return job.id as string;
  }

  /**
   * Add batch FIR sync job
   */
  async addBatchJob(params: {
    firIds: string[];
    tenantId: string;
    correlationId?: string;
    priority?: 'high' | 'normal' | 'low';
  }): Promise<string> {
    const { firIds, tenantId, correlationId, priority = 'normal' } = params;

    if (firIds.length === 0) {
      throw new Error('Batch job requires at least one FIR ID');
    }

    const job = await this.queue.add(
      'sync-batch',
      {
        firIds,
        tenantId,
        correlationId: correlationId || this.generateCorrelationId(),
        type: 'batch',
      },
      {
        priority: this.getPriorityValue(priority),
        jobId: `batch-${tenantId}-${Date.now()}`,
      },
    );

    this.logger.info('RENTRI batch sync job added', {
      jobId: job.id,
      firCount: firIds.length,
      tenantId,
      priority,
    });

    return job.id as string;
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Job | null> {
    try {
      const job = await this.queue.getJob(jobId);
      return job || null;
    } catch (error: any) {
      this.logger.error('Failed to get job', error, { jobId });
      return null;
    }
  }

  /**
   * Get job state
   */
  async getJobState(jobId: string): Promise<string | null> {
    const job = await this.getJob(jobId);
    if (!job) return null;

    try {
      return await job.getState();
    } catch (error: any) {
      this.logger.error('Failed to get job state', error, { jobId });
      return null;
    }
  }

  /**
   * Get all waiting jobs for a tenant
   */
  async getWaitingJobs(tenantId: string): Promise<Job[]> {
    const jobs = await this.queue.getJobs(['waiting', 'delayed']);
    return jobs.filter(job => job.data.tenantId === tenantId);
  }

  /**
   * Get all active jobs for a tenant
   */
  async getActiveJobs(tenantId: string): Promise<Job[]> {
    const jobs = await this.queue.getJobs(['active']);
    return jobs.filter(job => job.data.tenantId === tenantId);
  }

  /**
   * Get all failed jobs for a tenant
   */
  async getFailedJobs(tenantId: string): Promise<Job[]> {
    const jobs = await this.queue.getJobs(['failed']);
    return jobs.filter(job => job.data.tenantId === tenantId);
  }

  /**
   * Cancel/remove a job
   */
  async cancelJob(jobId: string, tenantId: string): Promise<boolean> {
    const job = await this.getJob(jobId);

    if (!job) {
      this.logger.warn('Job not found for cancellation', { jobId, tenantId });
      return false;
    }

    // Verify tenant ownership
    if (job.data.tenantId !== tenantId) {
      const error = new Error('Unauthorized: Cannot cancel job from different tenant');
      this.logger.error('Unauthorized job cancellation attempt', error, { jobId, tenantId });
      throw error;
    }

    const state = await job.getState();

    // Only cancel jobs that are not already completed
    if (state === 'completed') {
      this.logger.warn('Cannot cancel completed job', { jobId, state });
      return false;
    }

    try {
      await job.remove();
      this.logger.info('Job cancelled', { jobId, tenantId, state });
      return true;
    } catch (error: any) {
      this.logger.error('Failed to cancel job', error, { jobId, tenantId });
      return false;
    }
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics(tenantId?: string): Promise<QueueMetrics> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    // If tenant filter is provided, get tenant-specific counts
    let tenantCounts;
    if (tenantId) {
      const [waitingJobs, activeJobs, failedJobs] = await Promise.all([
        this.getWaitingJobs(tenantId),
        this.getActiveJobs(tenantId),
        this.getFailedJobs(tenantId),
      ]);

      tenantCounts = {
        waiting: waitingJobs.length,
        active: activeJobs.length,
        failed: failedJobs.length,
      };
    }

    return {
      global: {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed,
      },
      tenant: tenantCounts,
    };
  }

  /**
   * Pause queue processing
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    this.logger.warn('RENTRI sync queue paused');
  }

  /**
   * Resume queue processing
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    this.logger.info('RENTRI sync queue resumed');
  }

  /**
   * Clean old jobs
   */
  async clean(olderThanMs: number = 86400000): Promise<void> {
    const cleaned = await this.queue.clean(olderThanMs, 1000);
    this.logger.info('Queue cleaned', {
      deletedJobs: cleaned.length,
      olderThanHours: olderThanMs / 3600000,
    });
  }

  /**
   * Get queue instance (for worker)
   */
  getQueue(): Queue {
    return this.queue;
  }

  /**
   * Convert priority string to numeric value
   */
  private getPriorityValue(priority: 'high' | 'normal' | 'low'): number {
    const priorityMap = {
      high: 1,
      normal: 5,
      low: 10,
    };
    return priorityMap[priority];
  }

  /**
   * Generate correlation ID
   */
  private generateCorrelationId(): string {
    return `rentri-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }
}

/**
 * Queue Metrics Interface
 */
export interface QueueMetrics {
  global: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  };
  tenant?: {
    waiting: number;
    active: number;
    failed: number;
  };
}
