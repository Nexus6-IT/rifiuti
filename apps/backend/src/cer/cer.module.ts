/**
 * CER Module - Dependency Injection
 * Configurazione modulo CER con service, repository e controller
 */

import { Module } from '@nestjs/common'
import { CERController } from '../api/cer/cer.controller'
import { CERCatalogService } from '../domain/cer/services/cer-catalog.service'
import { CERPrismaRepository } from '../infrastructure/persistence/cer-prisma.repository'
import { PrismaService } from '../infrastructure/persistence/prisma.service'

@Module({
  controllers: [CERController],
  providers: [
    PrismaService,
    CERCatalogService,
    {
      provide: 'ICERRepository',
      useClass: CERPrismaRepository,
    },
  ],
  exports: [CERCatalogService, PrismaService],
})
export class CERModule {}
