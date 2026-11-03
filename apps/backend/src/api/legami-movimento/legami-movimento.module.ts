import { Module } from '@nestjs/common'
import { ImpostazioniFatturazioneService } from '../../application/legami-movimento/impostazioni-fatturazione.service'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { ImpostazioniFatturazioneController } from './impostazioni-fatturazione.controller'

/** LegamiMovimentoModule — legame movimento-cliente-prezzo (4.3). Per ora: «fatturazione da». */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [ImpostazioniFatturazioneController],
  providers: [ImpostazioniFatturazioneService],
  exports: [ImpostazioniFatturazioneService],
})
export class LegamiMovimentoModule {}
