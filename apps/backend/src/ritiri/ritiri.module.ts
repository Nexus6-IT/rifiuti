import { Module, NotImplementedException } from '@nestjs/common'
import { PrismaModule } from '../infrastructure/persistence/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { RuoloEffettivoModule } from '../api/me/ruolo-effettivo.module'
import { RitiriController } from '../api/ritiri/ritiri.controller'
import { GENERA_FIR_DA_RITIRI, type GeneraFirDaRitiriPorta } from '../api/ritiri/genera-fir.porta'
import { RitiriService } from '../application/ritiri/ritiri.service'
import { RitiriRepository } from '../infrastructure/persistence/ritiri.repository'
import { CERPrismaRepository } from '../infrastructure/persistence/cer-prisma.repository'

/**
 * SEGNAPOSTO (T13): il servizio di generazione in serie e' di T12. All'integrazione si sostituisce
 * con `{ provide: GENERA_FIR_DA_RITIRI, useExisting: GeneraFirDaRitiriService }` (e il servizio nei
 * `providers`). Fino ad allora `POST /ritiri/genera-fir` risponde 501.
 */
const GENERAZIONE_NON_DISPONIBILE: GeneraFirDaRitiriPorta = {
  genera: () => {
    throw new NotImplementedException('Generazione dei FIR dai ritiri non ancora disponibile.')
  },
}

/** RitiriModule — ritiri programmati (4.7): `/ritiri/*`. */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [RitiriController],
  providers: [
    RitiriService,
    RitiriRepository,
    { provide: 'ICERRepository', useClass: CERPrismaRepository },
    { provide: GENERA_FIR_DA_RITIRI, useValue: GENERAZIONE_NON_DISPONIBILE },
  ],
  exports: [RitiriService, RitiriRepository],
})
export class RitiriModule {}
