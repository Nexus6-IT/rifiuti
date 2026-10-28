import { Module } from '@nestjs/common'
import { PiazzaleController } from '../../api/piazzale/piazzale.controller'
import { RuoloEffettivoModule } from '../../api/me/ruolo-effettivo.module'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { PrismaModule } from '../../infrastructure/persistence/prisma.module'
import { MUDModule } from '../mud/mud.module'
import { ArriviPiazzaleService } from './arrivi-piazzale.service'

/** Piazzale: elenco dei FIR in arrivo all'impianto di destino. */
@Module({
  imports: [PrismaModule, MUDModule, RuoloEffettivoModule],
  controllers: [PiazzaleController],
  providers: [FIRPrismaRepository, ArriviPiazzaleService],
})
export class PiazzaleModule {}
