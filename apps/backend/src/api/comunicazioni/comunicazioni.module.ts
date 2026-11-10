import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { COMUNICAZIONI_ORSO_SERVICE } from '../../application/comunicazioni/comunicazioni-orso.port'
import { ComunicazioniOrsoService } from '../../application/comunicazioni/comunicazioni-orso.service'
import { ComunicazioniController } from './comunicazioni.controller'

/**
 * ComunicazioniModule (4.9a): API `/comunicazioni`. Il provider di `COMUNICAZIONI_ORSO_SERVICE`
 * e' `ComunicazioniOrsoService` (49-t4).
 */
@Module({
  imports: [AuthModule, RuoloEffettivoModule],
  controllers: [ComunicazioniController],
  providers: [
    ComunicazioniOrsoService,
    { provide: COMUNICAZIONI_ORSO_SERVICE, useExisting: ComunicazioniOrsoService },
  ],
})
export class ComunicazioniModule {}
