import { Injectable } from '@nestjs/common'
import { FIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { ModuliAttiviService } from '../../admin/moduli-attivi.service'
import { RentriModalitaLegameService } from '../../../infrastructure/rentri/rentri-modalita-legame.service'
import { RentriUnitaLocaleService } from '../../../infrastructure/rentri/rentri-unita-locale.service'
import { RichiestaNumeroVidimato, SorgenteNumeroVidimato } from './numero-vidimato-per-emissione'

/**
 * Un FIR e' soggetto a RENTRI (porta un numero vidimato) quando valgono TUTTE le condizioni con
 * cui l'emissione avvierebbe la trasmissione automatica (`TrasmettiFIRSecondoModalitaUseCase`):
 * modulo `rentri` attivo, modalita' AUTOMATICA o IBRIDA, certificato configurato, FIR non
 * bloccato all'invio (importato). In MANUALE nulla parte da solo e il numero lo assegna l'ente
 * alla trasmissione manuale (il contratto lo ammette: `numero_fir` e' opzionale), quindi non si
 * consuma scorta.
 *
 * La sede e' la principale del tenant, il blocco e' `codiceBloccoPredefinito` se configurato
 * (valore dichiarato una volta, mai indovinato). Senza sede principale non c'e' da dove
 * consumare: nessun consumo, e sara' la trasmissione a segnalare il dato mancante.
 */
@Injectable()
export class RisolviNumeroVidimatoPerEmissione extends SorgenteNumeroVidimato {
  constructor(
    private readonly moduli: ModuliAttiviService,
    private readonly modalitaLegame: RentriModalitaLegameService,
    private readonly unitaLocale: RentriUnitaLocaleService
  ) {
    super()
  }

  async perEmissione(fir: FIR, tenantId: string): Promise<RichiestaNumeroVidimato | null> {
    if (fir.bloccatoInvio) return null
    return this.perTenant(tenantId)
  }

  /**
   * Le stesse condizioni senza un FIR in mano: serve all'avviso preventivo nel form («questa
   * emissione consumera' la scorta?»), che non deve mai promettere un blocco che l'emissione
   * non applica (in MANUALE nessun consumo, quindi nessun avviso).
   */
  async perTenant(tenantId: string): Promise<RichiestaNumeroVidimato | null> {
    const attivi = await this.moduli.moduliAttivi(tenantId)
    if (!attivi.includes('rentri')) return null

    const { modalitaLegame, certificatoConfigurato } =
      await this.modalitaLegame.getForTenant(tenantId)
    if (modalitaLegame === 'MANUALE' || !certificatoConfigurato) return null

    const sede = await this.unitaLocale.getPrincipale(tenantId)
    if (!sede?.numIscrSito) return null

    return {
      numIscrSito: sede.numIscrSito,
      ...(sede.codiceBloccoPredefinito ? { codiceBlocco: sede.codiceBloccoPredefinito } : {}),
    }
  }
}
