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
import { ANAGRAFICA_COMUNICAZIONI_SERVICE } from '../../application/comunicazioni/anagrafica-comunicazioni.port'
import { AnagraficaComunicazioniService } from '../../application/comunicazioni/anagrafica-comunicazioni.service'
import {
  COMUNICAZIONI_TRACCIATO_SERVICE,
  PREPARATORI_TRACCIATO,
  REGISTRO_TRACCIATI,
} from '../../application/comunicazioni/comunicazioni-tracciato.port'
import { ComunicazioniTracciatoService } from '../../application/comunicazioni/comunicazioni-tracciato.service'
import { CONFIGURAZIONE_COMUNICAZIONI_SERVICE } from '../../application/comunicazioni/configurazione-comunicazioni.port'
import { ConfigurazioneComunicazioniService } from '../../application/comunicazioni/configurazione-comunicazioni.service'
import { PreparatoreCobat } from '../../application/comunicazioni/preparatore-cobat'
import { PreparatoreConou } from '../../application/comunicazioni/preparatore-conou'
import { DATI_TRACCIATO_SERVICE } from '../../application/comunicazioni/dati-tracciato.port'
import { DatiTracciatoService } from '../../application/comunicazioni/dati-tracciato.service'
import { registroTracciati } from '../../domain/comunicazioni/registro-tracciati'
import { ComunicazioniController } from './comunicazioni.controller'
import { DatiComunicazioniController } from './dati-comunicazioni.controller'
import { MarcaturaConsorziController } from './marcatura-consorzi.controller'

/**
 * ComunicazioniModule (4.9a, esteso da 4.9c-f): API `/comunicazioni`. Il provider di `COMUNICAZIONI_ORSO_SERVICE`
 * e' `ComunicazioniOrsoService` (49-t4).
 */
@Module({
  imports: [AuthModule, RuoloEffettivoModule],
  controllers: [ComunicazioniController, MarcaturaConsorziController, DatiComunicazioniController],
  providers: [
    ComunicazioniOrsoService,
    { provide: COMUNICAZIONI_ORSO_SERVICE, useExisting: ComunicazioniOrsoService },
    MarcaturaConsorziService,
    EstrattoConsorziService,
    { provide: MARCATURA_CONSORZI_SERVICE, useExisting: MarcaturaConsorziService },
    { provide: ESTRATTO_CONSORZI_SERVICE, useExisting: EstrattoConsorziService },
    DatiTracciatoService,
    AnagraficaComunicazioniService,
    ConfigurazioneComunicazioniService,
    { provide: DATI_TRACCIATO_SERVICE, useExisting: DatiTracciatoService },
    { provide: ANAGRAFICA_COMUNICAZIONI_SERVICE, useExisting: AnagraficaComunicazioniService },
    {
      provide: CONFIGURAZIONE_COMUNICAZIONI_SERVICE,
      useExisting: ConfigurazioneComunicazioniService,
    },
    // Un tracciato nuovo = un preparatore qui (PR B, C, D) e una riga in `registro-tracciati.ts`.
    PreparatoreConou,
    PreparatoreCobat,
    {
      provide: PREPARATORI_TRACCIATO,
      useFactory: (conou: PreparatoreConou, cobat: PreparatoreCobat) => [conou, cobat],
      inject: [PreparatoreConou, PreparatoreCobat],
    },
    { provide: REGISTRO_TRACCIATI, useValue: registroTracciati },
    ComunicazioniTracciatoService,
    { provide: COMUNICAZIONI_TRACCIATO_SERVICE, useExisting: ComunicazioniTracciatoService },
  ],
})
export class ComunicazioniModule {}
