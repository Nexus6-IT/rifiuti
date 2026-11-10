import { Module } from '@nestjs/common'
import { PrismaModule } from '../infrastructure/persistence/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { RuoloEffettivoModule } from '../api/me/ruolo-effettivo.module'
import { RitiriController } from '../api/ritiri/ritiri.controller'
import { GENERA_FIR_DA_RITIRI } from '../api/ritiri/genera-fir.porta'
import { FIRModule } from '../fir/fir.module'
import { GeneraFirDaRitiriService } from '../application/ritiri/genera-fir-da-ritiri.service'
import { RitiriService } from '../application/ritiri/ritiri.service'
import { RitiriRepository } from '../infrastructure/persistence/ritiri.repository'
import { CERPrismaRepository } from '../infrastructure/persistence/cer-prisma.repository'

/** RitiriModule — ritiri programmati (4.7): `/ritiri/*`. */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule, FIRModule],
  controllers: [RitiriController],
  providers: [
    RitiriService,
    RitiriRepository,
    GeneraFirDaRitiriService,
    { provide: 'ICERRepository', useClass: CERPrismaRepository },
    { provide: GENERA_FIR_DA_RITIRI, useExisting: GeneraFirDaRitiriService },
  ],
  exports: [RitiriService, RitiriRepository],
})
export class RitiriModule {}
