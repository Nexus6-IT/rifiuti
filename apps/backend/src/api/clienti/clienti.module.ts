import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { CondizioniPagamentoService } from '../../application/clienti/condizioni-pagamento.service'
import { ContiCorrentiService } from '../../application/clienti/conti-correnti.service'
import { SpeseAccessorieService } from '../../application/clienti/spese-accessorie.service'
import { CondizioniPagamentoController } from './condizioni-pagamento.controller'
import { ContiCorrentiController } from './conti-correnti.controller'
import { SpeseAccessorieController } from './spese-accessorie.controller'

/**
 * ClientiModule — clienti, contratti verso i clienti e relative tabelle di fatturazione (4.1).
 * Per ora condizioni di pagamento, conti correnti e spese accessorie (4.1a); i task successivi aggiungono provider e controller.
 */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [CondizioniPagamentoController, ContiCorrentiController, SpeseAccessorieController],
  providers: [CondizioniPagamentoService, ContiCorrentiService, SpeseAccessorieService],
  exports: [CondizioniPagamentoService, ContiCorrentiService, SpeseAccessorieService],
})
export class ClientiModule {}
