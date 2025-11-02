import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TenantId } from '../../core/decorators/tenant.decorator';
import { UserId } from '../../core/decorators/user.decorator';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { LoggerService } from '../../core/logger/logger.service';
import { TriggerBatchSyncUseCase } from '../../application/rentri/trigger-batch-sync.use-case';
import { GetSyncStatusUseCase } from '../../application/rentri/get-sync-status.use-case';
import { RENTRISyncQueue } from '../../infrastructure/queue/rentri-sync.queue';
import { RENTRISyncLogRepository } from '../../infrastructure/persistence/rentri-sync-log.repository';
import {
  SyncFIRRequestDto,
  SyncFIRResponseDto,
  BatchSyncRequestDto,
  BatchSyncResponseDto,
  SyncStatusResponseDto,
  SyncLogsQueryDto,
  SyncLogsResponseDto,
  SyncLogEntryDto,
  QueueMetricsResponseDto,
} from './dto/sync-fir.dto';

/**
 * RENTRI Sync Controller
 *
 * Handles RENTRI synchronization API endpoints.
 *
 * Endpoints:
 * - POST /rentri/sync/fir/:id - Trigger single FIR sync
 * - POST /rentri/sync/batch - Trigger batch FIR sync
 * - GET /rentri/sync/status/:jobId - Get sync job status
 * - GET /rentri/sync/logs - Get sync audit logs
 * - GET /rentri/sync/metrics - Get queue metrics
 *
 * All endpoints require JWT authentication and enforce tenant isolation.
 */
@ApiTags('RENTRI Sync')
@ApiBearerAuth()
@Controller('rentri/sync')
@UseGuards(JwtAuthGuard)
export class RENTRISyncController {
  constructor(
    private readonly triggerBatchSyncUseCase: TriggerBatchSyncUseCase,
    private readonly getSyncStatusUseCase: GetSyncStatusUseCase,
    private readonly rentriSyncQueue: RENTRISyncQueue,
    private readonly rentriSyncLogRepository: RENTRISyncLogRepository,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('RENTRISyncController');
  }

  /**
   * Trigger single FIR sync to RENTRI
   */
  @Post('fir/:id')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Sync single FIR to RENTRI',
    description: 'Queues a single FIR for synchronization to the RENTRI government registry',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Sync job queued successfully',
    type: SyncFIRResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid FIR ID or FIR not syncable',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'FIR not found',
  })
  async syncFIR(
    @Param('id') firId: string,
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Body() dto: SyncFIRRequestDto,
  ): Promise<SyncFIRResponseDto> {
    this.logger.info('Sync FIR request received', {
      firId,
      tenantId,
      userId,
      priority: dto.priority,
      delay: dto.delay,
    });

    try {
      // Queue the sync job
      const jobId = await this.rentriSyncQueue.addSyncJob({
        firId,
        tenantId,
        correlationId: dto.correlationId,
        delay: dto.delay || 0,
        priority: dto.priority || 'normal',
      });

      const estimatedStartTime = dto.delay
        ? new Date(Date.now() + dto.delay).toISOString()
        : undefined;

      this.logger.info('FIR sync job queued', {
        jobId,
        firId,
        tenantId,
        estimatedStartTime,
      });

      return {
        jobId,
        firId,
        message: dto.delay
          ? `FIR sync job queued with ${dto.delay / 1000}s delay`
          : 'FIR sync job queued successfully',
        estimatedStartTime,
      };
    } catch (error: any) {
      this.logger.error('Failed to queue FIR sync job', error, {
        firId,
        tenantId,
      });

      if (error.message?.includes('not found')) {
        throw new NotFoundException(`FIR with ID ${firId} not found`);
      }

      if (error.message?.includes('not syncable') || error.message?.includes('BUSINESS_RULE_VIOLATION')) {
        throw new BadRequestException(error.message);
      }

      throw error;
    }
  }

  /**
   * Trigger batch FIR sync to RENTRI
   */
  @Post('batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Batch sync FIRs to RENTRI',
    description: 'Queues multiple FIRs for synchronization to RENTRI',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Batch sync job queued successfully',
    type: BatchSyncResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request or no syncable FIRs',
  })
  async batchSync(
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Body() dto: BatchSyncRequestDto,
  ): Promise<BatchSyncResponseDto> {
    this.logger.info('Batch sync request received', {
      tenantId,
      userId,
      firCount: dto.firIds.length,
      priority: dto.priority,
    });

    if (dto.firIds.length === 0) {
      throw new BadRequestException('At least one FIR ID is required');
    }

    if (dto.firIds.length > 100) {
      throw new BadRequestException('Maximum 100 FIRs per batch');
    }

    try {
      // Use the batch sync use case
      // TODO: correlationId from DTO is currently not passed to use case
      const result = await this.triggerBatchSyncUseCase.execute({
        firIds: dto.firIds,
        tenantId,
        priority: dto.priority || 'normal',
      });

      this.logger.info('Batch sync job queued', {
        batchJobId: result.batchJobId,
        tenantId,
        queuedCount: result.queuedCount,
        skippedCount: result.skippedCount,
      });

      return {
        batchJobId: result.batchJobId || '',
        queuedCount: result.queuedCount,
        skippedCount: result.skippedCount || 0,
        message: `Queued ${result.queuedCount} FIRs for sync`,
      };
    } catch (error: any) {
      this.logger.error('Failed to queue batch sync', error, {
        tenantId,
        firCount: dto.firIds.length,
      });

      throw new BadRequestException(error.message || 'Failed to queue batch sync');
    }
  }

  /**
   * Get sync job status
   */
  @Get('status/:jobId')
  @ApiOperation({
    summary: 'Get sync job status',
    description: 'Retrieves the current status of a RENTRI sync job',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Job status retrieved successfully',
    type: SyncStatusResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Job not found',
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Unauthorized access to job',
  })
  async getSyncStatus(
    @Param('jobId') jobId: string,
    @TenantId() tenantId: string,
    @UserId() userId: string,
  ): Promise<SyncStatusResponseDto> {
    this.logger.debug('Get sync status request', {
      jobId,
      tenantId,
      userId,
    });

    try {
      const status = await this.getSyncStatusUseCase.execute(jobId, tenantId);

      return {
        jobId: status.jobId,
        status: status.status as any,
        progress: status.progress,
        data: status.data,
        result: status.result,
        failedReason: status.failedReason,
        attemptsMade: status.attemptsMade,
        processedOn: status.processedOn,
        finishedOn: status.finishedOn,
      };
    } catch (error: any) {
      this.logger.error('Failed to get sync status', error, {
        jobId,
        tenantId,
      });

      if (error.message?.includes('not found')) {
        throw new NotFoundException(`Job with ID ${jobId} not found`);
      }

      if (error.message?.includes('Unauthorized')) {
        throw new UnauthorizedException('Cannot access job from different tenant');
      }

      throw error;
    }
  }

  /**
   * Get sync logs with pagination and filtering
   */
  @Get('logs')
  @ApiOperation({
    summary: 'Get RENTRI sync logs',
    description: 'Retrieves paginated sync audit logs with optional filtering',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Sync logs retrieved successfully',
    type: SyncLogsResponseDto,
  })
  async getSyncLogs(
    @TenantId() tenantId: string,
    @UserId() userId: string,
    @Query() query: SyncLogsQueryDto,
  ): Promise<SyncLogsResponseDto> {
    this.logger.debug('Get sync logs request', {
      tenantId,
      userId,
      query,
    });

    const page = query.page || 1;
    const limit = query.limit || 20;
    const offset = (page - 1) * limit;

    // Build filter criteria
    const criteria: any = {};

    if (query.firId) {
      criteria.firId = query.firId;
    }

    if (query.status) {
      criteria.status = query.status;
    }

    if (query.dateFrom || query.dateTo) {
      if (query.dateFrom) {
        criteria.dateFrom = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        criteria.dateTo = new Date(query.dateTo);
      }
    }

    try {
      const result = await this.rentriSyncLogRepository.findPaginated(
        limit,
        offset,
        criteria,
      );

      const totalPages = Math.ceil(result.total / limit);

      const data: SyncLogEntryDto[] = result.data.map(log => ({
        id: log.id,
        firId: log.firId,
        status: log.status,
        attempt: log.attempt,
        errorMessage: log.errorMessage || undefined,
        errorCode: log.errorCode || undefined,
        protocolNumber: log.protocolNumber || undefined,
        syncedAt: log.syncedAt || undefined,
        durationMs: log.durationMs || undefined,
        createdAt: log.createdAt,
      }));

      this.logger.info('Sync logs retrieved', {
        tenantId,
        total: result.total,
        page,
        limit,
        totalPages,
      });

      return {
        data,
        total: result.total,
        page,
        limit,
        totalPages,
      };
    } catch (error: any) {
      this.logger.error('Failed to get sync logs', error, {
        tenantId,
        query,
      });

      throw new BadRequestException('Failed to retrieve sync logs');
    }
  }

  /**
   * Get queue metrics
   */
  @Get('metrics')
  @ApiOperation({
    summary: 'Get RENTRI sync queue metrics',
    description: 'Retrieves current queue metrics including job counts by status',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Queue metrics retrieved successfully',
    type: QueueMetricsResponseDto,
  })
  async getQueueMetrics(
    @TenantId() tenantId: string,
    @UserId() userId: string,
  ): Promise<QueueMetricsResponseDto> {
    this.logger.debug('Get queue metrics request', {
      tenantId,
      userId,
    });

    try {
      const metrics = await this.rentriSyncQueue.getQueueMetrics(tenantId);

      this.logger.debug('Queue metrics retrieved', {
        tenantId,
        metrics,
      });

      return metrics;
    } catch (error: any) {
      this.logger.error('Failed to get queue metrics', error, {
        tenantId,
      });

      throw new BadRequestException('Failed to retrieve queue metrics');
    }
  }
}
