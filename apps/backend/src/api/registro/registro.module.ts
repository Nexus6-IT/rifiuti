import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { RegistroController } from './registro.controller'
import { RegistraMovimentoUseCase } from '../../application/registro/use-cases/registra-movimento.use-case'
import { ListMovimentiHandler } from '../../application/registro/queries/list-movimenti.handler'
import { ProgressivoInizialeService } from '../../application/registro/progressivo-iniziale.service'
import { GiacenzeInizialiService } from '../../application/registro/giacenze-iniziali.service'
import { RegistriService } from '../../application/registro/registri.service'
import { VerificaCatenaRegistroService } from '../../application/registro/verifica-catena-registro.service'

/**
 * RegistroModule — registro cronologico di carico/scarico rifiuti.
 * Art. 190 D.Lgs 152/2006, DM 59/2023.
 *
 * Espone:
 *   POST /api/v1/registro    — registra un movimento (CARICO o SCARICO)
 *   GET  /api/v1/registro    — lista paginata con filtri
 *   GET  /api/v1/registro/registri — registri dell'azienda (sola lettura)
 *   POST /api/v1/registro/registri/assicura — crea i registri mancanti (ruoli di scrittura)
 *   GET  /api/v1/registro/progressivo-iniziale/:anno — progressivo iniziale dell'anno
 *   PUT  /api/v1/registro/progressivo-iniziale/:anno — lo imposta (una volta sola)
 */
@Module({
  imports: [PrismaModule, LoggerModule, AuthModule, RuoloEffettivoModule],
  controllers: [RegistroController],
  providers: [
    RegistraMovimentoUseCase,
    ListMovimentiHandler,
    ProgressivoInizialeService,
    GiacenzeInizialiService,
    RegistriService,
    VerificaCatenaRegistroService,
  ],
  exports: [RegistraMovimentoUseCase, ListMovimentiHandler, RegistriService],
})
export class RegistroModule {}
