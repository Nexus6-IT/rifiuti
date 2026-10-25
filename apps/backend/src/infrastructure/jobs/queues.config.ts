import { BullModule } from '@nestjs/bullmq'
import { AUDIT_QUEUE_JOB_OPTIONS } from './audit-queue.options'

/**
 * BullMQ Queue Configuration
 * Queues: permission-expiration, audit-archival, cache-warming, audit-logging
 */
export const QueuesConfig = [
  BullModule.registerQueue(
    { name: 'permission-expiration' }, // T204: Expire temp permissions every 5 min
    { name: 'permission-cleanup' }, // T205: Cleanup old requests daily at 2 AM
    { name: 'audit-archival' },
    { name: 'cache-warming' },
    { name: 'audit-logging', defaultJobOptions: AUDIT_QUEUE_JOB_OPTIONS } // T148: Async audit logging
  ),
]
