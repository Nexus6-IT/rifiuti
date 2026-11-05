import { Module } from '@nestjs/common'
import { CedenteService } from '../../application/fatturazione/cedente.service'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { CedenteController } from './cedente.controller'

/** FatturazioneModule — valorizzazione per periodo ed export (4.4): per ora i dati del cedente. */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [CedenteController],
  providers: [CedenteService],
  exports: [CedenteService],
})
export class FatturazioneModule {}
