import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { ABBONAMENTO_OPERATIVO_DEL_GRUPPO } from '../../application/billing/contratto-gruppo.service'
import { RiconciliaNotificheSdiService } from '../../application/sdi/riconcilia-notifiche-sdi.service'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'

export interface EsitoGiroGlobaleRiconciliazioneSdi {
  aziende: number
  aziendeInErrore: number
  controllate: number
  aggiornate: number
}

/**
 * Polling di ripiego delle notifiche SDI (4.5c, piano §4.5), ogni 15 minuti, sul modello di
 * `SdiInvioJob`. Il client di sistema serve SOLO a elencare le aziende candidate (con modulo `sdi` e
 * una configurazione); il lavoro passa da `RiconciliaNotificheSdiService` nel contesto dell'azienda.
 * Interroga il provider solo per trasmissioni gia' inviate e senza notifiche da molto tempo: senza
 * nessun invio non fa nulla, quindi non ha un interruttore proprio (quello degli invii,
 * `SDI_INVII_ATTIVI`, resta l'unico: spento di default, nessuna trasmissione esiste). Un errore su
 * un'azienda non ferma le altre. Nei log solo id e conteggi.
 */
@Injectable()
export class SdiRiconciliazioneJob {
  private readonly logger = new Logger(SdiRiconciliazioneJob.name)
  private inEsecuzione = false
  /** Sostituibile nei test. */
  orologio: () => Date = () => new Date()

  constructor(
    private readonly sistema: PrismaSistemaService,
    private readonly moduli: ModuliAttiviService,
    private readonly riconcilia: RiconciliaNotificheSdiService
  ) {}

  @Cron('0 */15 * * * *')
  async eseguiRiconciliazione(): Promise<EsitoGiroGlobaleRiconciliazioneSdi | null> {
    if (this.inEsecuzione) {
      this.logger.warn('Riconciliazione SDI ancora in corso: salto questo giro')
      return null
    }
    this.inEsecuzione = true
    try {
      return await this.giro()
    } catch (errore: unknown) {
      this.logger.error(
        'Riconciliazione SDI fallita',
        errore instanceof Error ? errore.stack : undefined
      )
      segnalaErroreJob('eseguiRiconciliazione', errore)
      return null
    } finally {
      this.inEsecuzione = false
    }
  }

  private async giro(): Promise<EsitoGiroGlobaleRiconciliazioneSdi> {
    const candidati = await this.sistema.tenant.findMany({
      where: escludiPiattaforma({
        OR: ABBONAMENTO_OPERATIVO_DEL_GRUPPO,
        configurazioniSdi: { some: {} },
      }),
      select: { id: true },
    })
    const conModulo = await this.moduli.tenantConModulo(
      candidati.map(t => t.id),
      'sdi'
    )
    const tenants = candidati.filter(t => conModulo.has(t.id))
    const totale: EsitoGiroGlobaleRiconciliazioneSdi = {
      aziende: tenants.length,
      aziendeInErrore: 0,
      controllate: 0,
      aggiornate: 0,
    }
    for (const tenant of tenants) {
      try {
        const esito = await this.riconcilia.giroAzienda(tenant.id, this.orologio())
        totale.controllate += esito.controllate
        totale.aggiornate += esito.aggiornate
        if (esito.errori > 0) totale.aziendeInErrore++
        if (esito.controllate > 0) {
          this.logger.log(
            `Riconciliazione SDI azienda ${tenant.id}: controllate ${esito.controllate}, aggiornate ${esito.aggiornate}`
          )
        }
      } catch (errore: unknown) {
        totale.aziendeInErrore++
        this.logger.error(
          `Riconciliazione SDI fallita per l'azienda ${tenant.id}`,
          errore instanceof Error ? errore.stack : undefined
        )
        segnalaErroreJob('eseguiRiconciliazione', errore, { tenantId: tenant.id })
      }
    }
    return totale
  }
}
