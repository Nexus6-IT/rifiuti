import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'

/**
 * Archive Audit Logs Job
 * Monthly partitioning per plan.md
 *
 * RLS: oggi non legge nulla. Quando verra' scritto, `audit_logs` ha la RLS: serve il client di
 * sistema (con il file in punti-di-sistema.spec.ts) oppure un `TenantContext.run` per azienda.
 */
@Processor('audit-archival')
export class ArchiveAuditLogsJob extends WorkerHost {
  private readonly logger = new Logger(ArchiveAuditLogsJob.name)

  async process(_job: Job): Promise<void> {
    this.logger.log('🔄 Running audit log archival...')
    // TODO: Archive logs older than 3 years to S3 cold storage
    this.logger.log('✅ Audit log archival complete')
  }
}
