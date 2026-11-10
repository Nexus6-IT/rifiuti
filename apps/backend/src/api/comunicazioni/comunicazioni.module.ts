import { Module, NotImplementedException } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { RuoloEffettivoModule } from '../me/ruolo-effettivo.module'
import {
  COMUNICAZIONI_ORSO_SERVICE,
  ComunicazioniOrsoPort,
} from '../../application/comunicazioni/comunicazioni-orso.port'
import { ComunicazioniController } from './comunicazioni.controller'

/** Segnaposto finche' 49-t4 non fornisce il servizio vero: ogni chiamata risponde 501. */
const SERVIZIO_NON_COLLEGATO: ComunicazioniOrsoPort = new Proxy({} as ComunicazioniOrsoPort, {
  get: () => () => {
    throw new NotImplementedException('Servizio O.R.SO. non ancora collegato.')
  },
})

/**
 * ComunicazioniModule (4.9a): API `/comunicazioni`. Il provider di `COMUNICAZIONI_ORSO_SERVICE`
 * e' un segnaposto: l'integrazione con 49-t4 lo sostituisce con `ComunicazioniOrsoService`.
 */
@Module({
  imports: [AuthModule, RuoloEffettivoModule],
  controllers: [ComunicazioniController],
  providers: [{ provide: COMUNICAZIONI_ORSO_SERVICE, useValue: SERVIZIO_NON_COLLEGATO }],
})
export class ComunicazioniModule {}
