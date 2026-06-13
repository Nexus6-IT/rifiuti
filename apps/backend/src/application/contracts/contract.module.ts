import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infrastructure/database/prisma.module'
import { LoggerModule } from '../../core/logger/logger.module'
import { AuthModule } from '../../auth/auth.module'
import { ContractService } from './contract.service'
import { ContractController } from './contract.controller'

/**
 * ContractModule — gestione contratti (MVP): CRUD, workflow stati,
 * auto-compilazione FIR. Esporta ContractService per l'integrazione col FIR.
 */
@Module({
  imports: [PrismaModule, LoggerModule, AuthModule],
  controllers: [ContractController],
  providers: [ContractService],
  exports: [ContractService],
})
export class ContractModule {}
