import { Module } from '@nestjs/common'
import { PrismaModule } from '../infrastructure/persistence/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { RuoloEffettivoModule } from '../api/me/ruolo-effettivo.module'
import { AutistiController } from '../api/campo/autisti.controller'
import { CampoController } from '../api/campo/campo.controller'
import { PushController } from '../api/campo/push.controller'
import { EsitiCampoController } from '../api/campo/esiti-campo.controller'
import { AllegatiCampoService } from '../application/campo/allegati-campo.service'
import { AutistiService } from '../application/campo/autisti.service'
import { EventiCampoService } from '../application/campo/eventi-campo.service'
import { PushCampoService } from '../application/campo/push-campo.service'
import { GiroService } from '../application/campo/giro.service'
import { RicevuteRitiroService } from '../application/campo/ricevute-ritiro.service'
import { EmailService } from '../infrastructure/email/email.service'
import { RitiriRepository } from '../infrastructure/persistence/ritiri.repository'

/** CampoModule — app campo (P1): anagrafica autisti `/autisti/*` e giro `/campo/giro`, eventi `/campo/eventi` (P4), foto `/campo/eventi/:id/foto` (P5), esiti d'ufficio `/esiti-campo` (con le foto), ricevute di ritiro `/campo/ricevute` (P6) e web push `/push/*` (P7). */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [CampoController, AutistiController, EsitiCampoController, PushController],
  providers: [
    AutistiService,
    GiroService,
    EventiCampoService,
    RicevuteRitiroService,
    AllegatiCampoService,
    PushCampoService,
    RitiriRepository,
    EmailService,
  ],
  exports: [AutistiService, PushCampoService],
})
export class CampoModule {}
