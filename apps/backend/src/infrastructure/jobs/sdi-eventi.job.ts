import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ElaboraEventiSdiService } from '../../application/sdi/elabora-eventi-sdi.service'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'

export interface EsitoGiroGlobaleEventiSdi {
  aziende: number
  aziendeInErrore: number
  elaborati: number
}

/** Aziende elaborate al massimo per giro (le altre al giro dopo). */
const LIMITE_AZIENDE_PER_GIRO = 200

/**
 * Elaborazione degli eventi del webhook SDI (4.5c, piano §4.5), ogni 30 secondi. Il client di sistema
 * serve SOLO a elencare le aziende che hanno eventi da elaborare (una query leggera); tutto il resto
 * passa da `ElaboraEventiSdiService` nel contesto dell'azienda. Non chiama nessun provider: sposta
 * dati gia' ricevuti. Senza webhook ricevuti (cioe' senza nessuna azienda con il modulo acceso e un
 * provider che chiama) non fa nulla. Un flag in memoria evita giri sovrapposti nello stesso processo.
 */
@Injectable()
export class SdiEventiJob {
  private readonly logger = new Logger(SdiEventiJob.name)
  private inEsecuzione = false
  /** Sostituibile nei test. */
  orologio: () => Date = () => new Date()

  constructor(
    private readonly sistema: PrismaSistemaService,
    private readonly elabora: ElaboraEventiSdiService
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async eseguiEventi(): Promise<EsitoGiroGlobaleEventiSdi | null> {
    if (this.inEsecuzione) {
      this.logger.warn('Giro degli eventi SDI ancora in corso: salto questo')
      return null
    }
    this.inEsecuzione = true
    try {
      return await this.giro()
    } catch (errore: unknown) {
      this.logger.error(
        'Giro degli eventi SDI fallito',
        errore instanceof Error ? errore.stack : undefined
      )
      segnalaErroreJob('eseguiEventi', errore)
      return null
    } finally {
      this.inEsecuzione = false
    }
  }

  private async giro(): Promise<EsitoGiroGlobaleEventiSdi> {
    const candidati = await this.sistema.eventoSdiRicevuto.findMany({
      where: { elaboratoIl: null },
      distinct: ['tenantId'],
      select: { tenantId: true },
      take: LIMITE_AZIENDE_PER_GIRO,
    })
    const totale: EsitoGiroGlobaleEventiSdi = {
      aziende: candidati.length,
      aziendeInErrore: 0,
      elaborati: 0,
    }
    for (const { tenantId } of candidati) {
      try {
        const esito = await this.elabora.giroAzienda(tenantId, this.orologio())
        totale.elaborati += esito.elaborati
        if (esito.errori > 0) totale.aziendeInErrore++
        if (esito.elaborati + esito.scartati > 0) {
          this.logger.log(
            `Eventi SDI azienda ${tenantId}: elaborati ${esito.elaborati}, in attesa ${esito.inAttesa}, scartati ${esito.scartati}`
          )
        }
      } catch (errore: unknown) {
        totale.aziendeInErrore++
        this.logger.error(
          `Giro degli eventi SDI fallito per l'azienda ${tenantId}`,
          errore instanceof Error ? errore.stack : undefined
        )
        segnalaErroreJob('eseguiEventi', errore, { tenantId })
      }
    }
    return totale
  }
}
