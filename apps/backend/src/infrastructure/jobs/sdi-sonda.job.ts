import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { ABBONAMENTO_OPERATIVO_DEL_GRUPPO } from '../../application/billing/contratto-gruppo.service'
import { SondaSdiService } from '../../application/sdi/sonda-sdi.service'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'

export interface EsitoGiroGlobaleSondaSdi {
  aziende: number
  aziendeInErrore: number
  problemi: number
  avvisiCreati: number
}

/**
 * Sonda delle trasmissioni SDI (4.5f T1), ogni 10 minuti, sul modello di `SdiRiconciliazioneJob`: il
 * client di sistema serve SOLO a elencare le aziende con trasmissioni da guardare (`INCERTA`, `SCARTATA`,
 * `ERRORE_INVIO`, col modulo `sdi`); gli avvisi in-app agli ADMIN li crea `SondaSdiService` nel contesto
 * dell'azienda. Non chiama nessun provider e non ha un interruttore proprio: senza trasmissioni (invii
 * spenti, `SDI_INVII_ATTIVI`) non trova nulla. Un errore su un'azienda non ferma le altre; nei log solo
 * id e conteggi.
 */
@Injectable()
export class SdiSondaJob {
  private readonly logger = new Logger(SdiSondaJob.name)
  private inEsecuzione = false
  /** Sostituibile nei test. */
  orologio: () => Date = () => new Date()

  constructor(
    private readonly sistema: PrismaSistemaService,
    private readonly moduli: ModuliAttiviService,
    private readonly sonda: SondaSdiService
  ) {}

  @Cron('0 */10 * * * *')
  async eseguiSonda(): Promise<EsitoGiroGlobaleSondaSdi | null> {
    if (this.inEsecuzione) {
      this.logger.warn('Sonda SDI ancora in corso: salto questo giro')
      return null
    }
    this.inEsecuzione = true
    try {
      return await this.giro()
    } catch (errore: unknown) {
      this.logger.error('Sonda SDI fallita', errore instanceof Error ? errore.stack : undefined)
      segnalaErroreJob('eseguiSonda', errore)
      return null
    } finally {
      this.inEsecuzione = false
    }
  }

  private async giro(): Promise<EsitoGiroGlobaleSondaSdi> {
    const candidati = await this.sistema.tenant.findMany({
      where: escludiPiattaforma({
        OR: ABBONAMENTO_OPERATIVO_DEL_GRUPPO,
        trasmissioniSdi: { some: { stato: { in: ['INCERTA', 'SCARTATA', 'ERRORE_INVIO'] } } },
      }),
      select: { id: true },
    })
    const conModulo = await this.moduli.tenantConModulo(
      candidati.map(t => t.id),
      'sdi'
    )
    const tenants = candidati.filter(t => conModulo.has(t.id))
    const totale: EsitoGiroGlobaleSondaSdi = {
      aziende: tenants.length,
      aziendeInErrore: 0,
      problemi: 0,
      avvisiCreati: 0,
    }
    for (const tenant of tenants) {
      try {
        const esito = await this.sonda.giroAzienda(tenant.id, this.orologio())
        totale.problemi += esito.problemi
        totale.avvisiCreati += esito.avvisiCreati
        if (esito.problemi > 0) {
          this.logger.log(
            `Sonda SDI azienda ${tenant.id}: ${esito.problemi} trasmissioni da guardare, ${esito.avvisiCreati} avvisi`
          )
        }
      } catch (errore: unknown) {
        totale.aziendeInErrore++
        this.logger.error(
          `Sonda SDI fallita per l'azienda ${tenant.id}`,
          errore instanceof Error ? errore.stack : undefined
        )
        segnalaErroreJob('eseguiSonda', errore, { tenantId: tenant.id })
      }
    }
    return totale
  }
}
