import { Module } from '@nestjs/common'
import { ModelliStampaService } from '../../application/modelli-stampa/modelli-stampa.service'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { ModelliStampaController } from './modelli-stampa.controller'

/** ModelliStampaModule (4.7, T6): CRUD dei modelli di stampa; il servizio e' esportato per il PDF (T7). */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [ModelliStampaController],
  providers: [ModelliStampaService],
  exports: [ModelliStampaService],
})
export class ModelliStampaModule {}
