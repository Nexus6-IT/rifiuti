/**
 * Prisma Module
 * Provides PrismaService (applicazione) e PrismaSistemaService (job di sistema) globalmente
 */

import { Module, Global } from '@nestjs/common'
import { PrismaService, creaPrismaServiceApplicativo } from './prisma.service'
import { PrismaSistemaService } from './prisma-sistema.service'

@Global()
@Module({
  providers: [
    // Client esteso con il tenant per transazione (vedi creaPrismaServiceApplicativo)
    { provide: PrismaService, useFactory: creaPrismaServiceApplicativo },
    PrismaSistemaService,
  ],
  exports: [PrismaService, PrismaSistemaService],
})
export class PrismaModule {}
