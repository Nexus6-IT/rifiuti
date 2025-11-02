import { IsUUID, IsOptional, IsString, IsEnum, IsArray, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Sync Single FIR Request DTO
 */
export class SyncFIRRequestDto {
  @ApiProperty({
    description: 'Correlation ID for tracking request',
    example: 'req-123456',
    required: false,
  })
  @IsOptional()
  @IsString()
  correlationId?: string;

  @ApiProperty({
    description: 'Job priority',
    enum: ['high', 'normal', 'low'],
    default: 'normal',
    required: false,
  })
  @IsOptional()
  @IsEnum(['high', 'normal', 'low'])
  priority?: 'high' | 'normal' | 'low';

  @ApiProperty({
    description: 'Delay before job execution (milliseconds)',
    example: 0,
    default: 0,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  delay?: number;
}

/**
 * Sync Single FIR Response DTO
 */
export class SyncFIRResponseDto {
  @ApiProperty({
    description: 'Job ID for tracking sync status',
    example: 'sync-abc123-1234567890',
  })
  jobId: string;

  @ApiProperty({
    description: 'FIR ID being synced',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  firId: string;

  @ApiProperty({
    description: 'Status of job submission',
    example: 'Job queued successfully',
  })
  message: string;

  @ApiProperty({
    description: 'Estimated start time (if delayed)',
    example: '2025-10-19T14:30:00.000Z',
    required: false,
  })
  estimatedStartTime?: string;
}

/**
 * Batch Sync Request DTO
 */
export class BatchSyncRequestDto {
  @ApiProperty({
    description: 'Array of FIR IDs to sync',
    example: ['550e8400-e29b-41d4-a716-446655440000', '660e8400-e29b-41d4-a716-446655440001'],
    type: [String],
  })
  @IsArray()
  @IsUUID('4', { each: true })
  firIds: string[];

  @ApiProperty({
    description: 'Correlation ID for tracking request',
    example: 'batch-req-123456',
    required: false,
  })
  @IsOptional()
  @IsString()
  correlationId?: string;

  @ApiProperty({
    description: 'Job priority',
    enum: ['high', 'normal', 'low'],
    default: 'normal',
    required: false,
  })
  @IsOptional()
  @IsEnum(['high', 'normal', 'low'])
  priority?: 'high' | 'normal' | 'low';
}

/**
 * Batch Sync Response DTO
 */
export class BatchSyncResponseDto {
  @ApiProperty({
    description: 'Batch job ID for tracking',
    example: 'batch-tenant1-1234567890',
  })
  batchJobId: string;

  @ApiProperty({
    description: 'Number of FIRs queued for sync',
    example: 15,
  })
  queuedCount: number;

  @ApiProperty({
    description: 'Number of FIRs skipped (already synced or invalid)',
    example: 2,
  })
  skippedCount: number;

  @ApiProperty({
    description: 'Status message',
    example: 'Batch sync job queued successfully',
  })
  message: string;
}

/**
 * Sync Status Response DTO
 */
export class SyncStatusResponseDto {
  @ApiProperty({
    description: 'Job ID',
    example: 'sync-abc123-1234567890',
  })
  jobId: string;

  @ApiProperty({
    description: 'Job status',
    enum: ['pending', 'delayed', 'processing', 'completed', 'failed'],
    example: 'processing',
  })
  status: 'pending' | 'delayed' | 'processing' | 'completed' | 'failed';

  @ApiProperty({
    description: 'Job progress (0-100)',
    example: 75,
  })
  progress: number;

  @ApiProperty({
    description: 'Job data',
    example: {
      firId: '550e8400-e29b-41d4-a716-446655440000',
      tenantId: '660e8400-e29b-41d4-a716-446655440000',
      type: 'single',
    },
  })
  data: any;

  @ApiProperty({
    description: 'Job result (if completed)',
    required: false,
  })
  result?: any;

  @ApiProperty({
    description: 'Failure reason (if failed)',
    example: 'RENTRI API timeout',
    required: false,
  })
  failedReason?: string;

  @ApiProperty({
    description: 'Number of attempts made',
    example: 2,
  })
  attemptsMade: number;

  @ApiProperty({
    description: 'When job started processing',
    example: '2025-10-19T14:25:00.000Z',
    required: false,
  })
  processedOn?: Date;

  @ApiProperty({
    description: 'When job finished',
    example: '2025-10-19T14:27:00.000Z',
    required: false,
  })
  finishedOn?: Date;
}

/**
 * Sync Logs Query DTO
 */
export class SyncLogsQueryDto {
  @ApiProperty({
    description: 'FIR ID to filter logs',
    required: false,
  })
  @IsOptional()
  @IsUUID('4')
  firId?: string;

  @ApiProperty({
    description: 'Sync status filter',
    enum: ['SUCCESS', 'FAILURE', 'PENDING'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['SUCCESS', 'FAILURE', 'PENDING'])
  status?: 'SUCCESS' | 'FAILURE' | 'PENDING';

  @ApiProperty({
    description: 'Filter logs from this date',
    example: '2025-10-01',
    required: false,
  })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiProperty({
    description: 'Filter logs until this date',
    example: '2025-10-19',
    required: false,
  })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiProperty({
    description: 'Page number (starts at 1)',
    example: 1,
    default: 1,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({
    description: 'Items per page',
    example: 20,
    default: 20,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/**
 * Sync Log Entry DTO
 */
export class SyncLogEntryDto {
  @ApiProperty({
    description: 'Log entry ID',
    example: '770e8400-e29b-41d4-a716-446655440000',
  })
  id: string;

  @ApiProperty({
    description: 'FIR ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  firId: string;

  @ApiProperty({
    description: 'Sync status',
    enum: ['SUCCESS', 'FAILURE', 'PENDING'],
    example: 'SUCCESS',
  })
  status: 'SUCCESS' | 'FAILURE' | 'PENDING';

  @ApiProperty({
    description: 'Attempt number',
    example: 1,
  })
  attempt: number;

  @ApiProperty({
    description: 'Error message (if failed)',
    required: false,
  })
  errorMessage?: string;

  @ApiProperty({
    description: 'Error code (if failed)',
    required: false,
  })
  errorCode?: string;

  @ApiProperty({
    description: 'RENTRI protocol number (if successful)',
    required: false,
  })
  protocolNumber?: string;

  @ApiProperty({
    description: 'When sync completed',
    required: false,
  })
  syncedAt?: Date;

  @ApiProperty({
    description: 'Sync duration in milliseconds',
    example: 1543,
    required: false,
  })
  durationMs?: number;

  @ApiProperty({
    description: 'When log entry was created',
    example: '2025-10-19T14:25:00.000Z',
  })
  createdAt: Date;
}

/**
 * Sync Logs Response DTO
 */
export class SyncLogsResponseDto {
  @ApiProperty({
    description: 'Array of sync log entries',
    type: [SyncLogEntryDto],
  })
  data: SyncLogEntryDto[];

  @ApiProperty({
    description: 'Total count of logs matching filter',
    example: 142,
  })
  total: number;

  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page: number;

  @ApiProperty({
    description: 'Items per page',
    example: 20,
  })
  limit: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 8,
  })
  totalPages: number;
}

/**
 * Queue Metrics Response DTO
 */
export class QueueMetricsResponseDto {
  @ApiProperty({
    description: 'Global queue metrics',
  })
  global: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    total: number;
  };

  @ApiProperty({
    description: 'Tenant-specific metrics',
    required: false,
  })
  tenant?: {
    waiting: number;
    active: number;
    failed: number;
  };
}
