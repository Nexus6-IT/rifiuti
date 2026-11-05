import { Module } from '@nestjs/common'
import { CedenteService } from '../../application/fatturazione/cedente.service'
import { DocumentiFatturaService } from '../../application/fatturazione/documenti-fattura.service'
import { NumerazioniService } from '../../application/fatturazione/numerazioni.service'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { CedenteController } from './cedente.controller'
import { NumerazioniController } from './numerazioni.controller'

/** FatturazioneModule — valorizzazione per periodo ed export (4.4): cedente e numerazione. */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [CedenteController, NumerazioniController],
  providers: [CedenteService, NumerazioniService, DocumentiFatturaService],
  exports: [CedenteService, NumerazioniService, DocumentiFatturaService],
})
export class FatturazioneModule {}
