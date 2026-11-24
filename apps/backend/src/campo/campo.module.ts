import { Module } from '@nestjs/common'
import { PrismaModule } from '../infrastructure/persistence/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { RuoloEffettivoModule } from '../api/me/ruolo-effettivo.module'
import { AutistiController } from '../api/campo/autisti.controller'
import { CampoController } from '../api/campo/campo.controller'
import { EsitiCampoController } from '../api/campo/esiti-campo.controller'
import { AllegatiCampoService } from '../application/campo/allegati-campo.service'
import { AutistiService } from '../application/campo/autisti.service'
import { EventiCampoService } from '../application/campo/eventi-campo.service'
import { GiroService } from '../application/campo/giro.service'
import { RitiriRepository } from '../infrastructure/persistence/ritiri.repository'

/** CampoModule — app campo (P1): anagrafica autisti `/autisti/*` e giro `/campo/giro`, eventi `/campo/eventi` (P4), foto `/campo/eventi/:id/foto` (P5) ed esiti d'ufficio `/esiti-campo` (con le foto). */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [CampoController, AutistiController, EsitiCampoController],
  providers: [
    AutistiService,
    GiroService,
    EventiCampoService,
    AllegatiCampoService,
    RitiriRepository,
  ],
  exports: [AutistiService],
})
export class CampoModule {}
