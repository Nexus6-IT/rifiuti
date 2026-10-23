/**
 * CER Module - Dependency Injection
 * Configurazione modulo CER con service, repository e controller
 */

import { Module } from '@nestjs/common'
import { CERController } from '../api/cer/cer.controller'
import { CERCatalogService } from '../domain/cer/services/cer-catalog.service'
import { CERPrismaRepository } from '../infrastructure/persistence/cer-prisma.repository'

@Module({
  controllers: [CERController],
  providers: [
    CERCatalogService,
    {
      provide: 'ICERRepository',
      useClass: CERPrismaRepository,
    },
  ],
  exports: [CERCatalogService],
})
export class CERModule {}
