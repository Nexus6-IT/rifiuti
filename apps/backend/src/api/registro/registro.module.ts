import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { RegistroController } from './registro.controller'
import { RegistraMovimentoUseCase } from '../../application/registro/use-cases/registra-movimento.use-case'
import { ListMovimentiHandler } from '../../application/registro/queries/list-movimenti.handler'

/**
 * RegistroModule — registro cronologico di carico/scarico rifiuti.
 * Art. 190 D.Lgs 152/2006, DM 59/2023.
 *
 * Espone:
 *   POST /api/v1/registro    — registra un movimento (CARICO o SCARICO)
 *   GET  /api/v1/registro    — lista paginata con filtri
 */
@Module({
  imports: [PrismaModule, LoggerModule, AuthModule],
  controllers: [RegistroController],
  providers: [RegistraMovimentoUseCase, ListMovimentiHandler],
  exports: [RegistraMovimentoUseCase, ListMovimentiHandler],
})
export class RegistroModule {}
