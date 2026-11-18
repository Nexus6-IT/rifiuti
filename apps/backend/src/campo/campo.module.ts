import { Module } from '@nestjs/common'
import { PrismaModule } from '../infrastructure/persistence/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { RuoloEffettivoModule } from '../api/me/ruolo-effettivo.module'
import { AutistiController } from '../api/campo/autisti.controller'
import { CampoController } from '../api/campo/campo.controller'
import { AutistiService } from '../application/campo/autisti.service'
import { GiroService } from '../application/campo/giro.service'
import { RitiriRepository } from '../infrastructure/persistence/ritiri.repository'

/** CampoModule — app campo (P1): anagrafica autisti `/autisti/*` e giro `/campo/giro`. */
@Module({
  imports: [PrismaModule, AuthModule, RuoloEffettivoModule],
  controllers: [CampoController, AutistiController],
  providers: [AutistiService, GiroService, RitiriRepository],
  exports: [AutistiService],
})
export class CampoModule {}
