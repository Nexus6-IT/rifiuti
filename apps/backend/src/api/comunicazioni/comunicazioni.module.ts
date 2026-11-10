import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import { COMUNICAZIONI_ORSO_SERVICE } from '../../application/comunicazioni/comunicazioni-orso.port'
import { ComunicazioniOrsoService } from '../../application/comunicazioni/comunicazioni-orso.service'
import {
  ESTRATTO_CONSORZI_SERVICE,
  MARCATURA_CONSORZI_SERVICE,
} from '../../application/comunicazioni/marcatura-consorzi.port'
import { MarcaturaConsorziService } from '../../application/comunicazioni/marcatura-consorzi.service'
import { EstrattoConsorziService } from '../../application/comunicazioni/estratto-consorzi.service'
import { ComunicazioniController } from './comunicazioni.controller'
import { MarcaturaConsorziController } from './marcatura-consorzi.controller'

/**
 * ComunicazioniModule (4.9a): API `/comunicazioni`. Il provider di `COMUNICAZIONI_ORSO_SERVICE`
 * e' `ComunicazioniOrsoService` (49-t4).
 */
@Module({
  imports: [AuthModule, RuoloEffettivoModule],
  controllers: [ComunicazioniController, MarcaturaConsorziController],
  providers: [
    ComunicazioniOrsoService,
    { provide: COMUNICAZIONI_ORSO_SERVICE, useExisting: ComunicazioniOrsoService },
    MarcaturaConsorziService,
    EstrattoConsorziService,
    { provide: MARCATURA_CONSORZI_SERVICE, useExisting: MarcaturaConsorziService },
    { provide: ESTRATTO_CONSORZI_SERVICE, useExisting: EstrattoConsorziService },
  ],
})
export class ComunicazioniModule {}
