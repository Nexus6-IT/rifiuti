import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../../api/me/ruolo-effettivo.module'
import { GiacenzeService } from './giacenze.service'
import { GiacenzeController } from './giacenze.controller'
import { SoglieDepositoService } from './soglie-deposito.service'

/**
 * GiacenzeModule — giacenze per CER, deposito temporaneo per registro (art. 185-bis D.Lgs.
 * 152/2006) e relative soglie, dal registro cronologico carico/scarico (WasteMovement).
 *
 * Espone:
 *   GET    /giacenze
 *   GET    /giacenze/deposito-temporaneo — lotti, scadenze e avvisi per registro
 *   GET    /giacenze/deposito-temporaneo/alerts — avvisi in elenco piatto
 *   GET    /giacenze/deposito-temporaneo/soglie — soglie predefinite, azienda e registri
 *   PUT|DELETE /giacenze/deposito-temporaneo/soglie — soglie dell'azienda (amministratori)
 *   PUT|DELETE /giacenze/deposito-temporaneo/soglie/registri/:registroId — di un registro
 */
@Module({
  imports: [PrismaModule, LoggerModule, AuthModule, RuoloEffettivoModule],
  controllers: [GiacenzeController],
  providers: [GiacenzeService, SoglieDepositoService],
  exports: [GiacenzeService, SoglieDepositoService],
})
export class GiacenzeModule {}
