import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../../api/me/ruolo-effettivo.module'
import { RegistriService } from '../registro/registri.service'
import { AbbinamentiService } from './abbinamenti.service'
import { AbbinamentiController } from './abbinamenti.controller'

/**
 * AbbinamentiModule — abbinamento carico/scarico dello stoccaggio R13/D15 (4.6).
 *
 * Espone:
 *   GET  /abbinamenti?registroId= — vista per registro
 *   GET  /abbinamenti/differenze?registroId=&cerCode= — righe contro FIFO da zero
 *   GET  /abbinamenti/scarichi/:id/proposta
 *   PUT  /abbinamenti/scarichi/:id — override manuale
 *   POST /abbinamenti/ricalcolo
 */
@Module({
  imports: [PrismaModule, LoggerModule, AuthModule, RuoloEffettivoModule],
  controllers: [AbbinamentiController],
  providers: [AbbinamentiService, RegistriService],
  exports: [AbbinamentiService],
})
export class AbbinamentiModule {}
