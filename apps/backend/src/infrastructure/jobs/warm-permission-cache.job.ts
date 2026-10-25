import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { Job } from 'bullmq'

/**
 * Warm Permission Cache Job
 * Pre-loads frequently accessed permissions
 *
 * RLS: oggi non legge nulla. Quando verra' scritto, `role_permissions`/`user_roles` hanno la RLS:
 * serve il client di sistema (con il file in punti-di-sistema.spec.ts) oppure un `TenantContext.run`
 * per azienda.
 */
@Processor('cache-warming')
export class WarmPermissionCacheJob extends WorkerHost {
  private readonly logger = new Logger(WarmPermissionCacheJob.name)

  async process(_job: Job): Promise<void> {
    this.logger.log('🔄 Warming permission cache...')
    // TODO: Pre-load permissions for active users
    this.logger.log('✅ Cache warming complete')
  }
}
