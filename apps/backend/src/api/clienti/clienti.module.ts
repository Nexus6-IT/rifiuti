import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { CondizioniPagamentoService } from '../../application/clienti/condizioni-pagamento.service'
import { CondizioniPagamentoController } from './condizioni-pagamento.controller'

/**
 * ClientiModule — clienti, contratti verso i clienti e relative tabelle di fatturazione (4.1).
 * Per ora le condizioni di pagamento (4.1a); i task successivi aggiungono provider e controller.
 */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [CondizioniPagamentoController],
  providers: [CondizioniPagamentoService],
  exports: [CondizioniPagamentoService],
})
export class ClientiModule {}
