/**
 * Prisma Module
 * Provides PrismaService (applicazione) e PrismaSistemaService (job di sistema) globalmente
 */

import { Module, Global } from '@nestjs/common'
import { PrismaService } from './prisma.service'
import { PrismaSistemaService } from './prisma-sistema.service'

@Global()
@Module({
  providers: [PrismaService, PrismaSistemaService],
  exports: [PrismaService, PrismaSistemaService],
})
export class PrismaModule {}
