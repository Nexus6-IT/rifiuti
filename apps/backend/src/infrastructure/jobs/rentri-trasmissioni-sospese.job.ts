import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { LoggerService } from '../../core/logger/logger.service'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { FIRPrismaRepository } from '../persistence/fir-prisma.repository'
import { RENTRISyncQueue } from '../queue/rentri-sync.queue'
import { SOGLIA_STALLO_RENTRI_MS } from '../../application/rentri/sync-fir-to-rentri.use-case'

/**
 * Riprende le trasmissioni RENTRI rimaste in SYNCING senza che nessun job le
 * stia portando avanti (worker caduto, Redis svuotato, riavvio a metà POST).
 * Ogni 30 minuti cerca, su tutti i tenant, i FIR con la prenotazione più
 * vecchia di `SOGLIA_STALLO_RENTRI_MS` e li riaccoda con priorità low: il use
 * case di sync è idempotente (riprende la transazione già aperta invece di
 * fare una nuova POST) e il jobId per FIR impedisce doppioni in coda.
 *
 * Al massimo 100 FIR per giro: il resto viene ripreso al giro successivo.
 * Un errore su un FIR non ferma gli altri.
 */
@Injectable()
export class RentriTrasmissioniSospeseJob {
  private static readonly LIMITE = 100

  constructor(
    private readonly firRepo: FIRPrismaRepository,
    private readonly queue: RENTRISyncQueue,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RentriTrasmissioniSospeseJob.name)
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async riprendi(): Promise<void> {
    try {
      const sospese = await this.firRepo.elencaTrasmissioniRentriSospese(
        new Date(Date.now() - SOGLIA_STALLO_RENTRI_MS),
        RentriTrasmissioniSospeseJob.LIMITE
      )

      let accodate = 0
      let inErrore = 0
      for (const { firId, tenantId } of sospese) {
        try {
          await this.queue.addSyncJob({ firId, tenantId, priority: 'low' })
          accodate++
        } catch (error: unknown) {
          inErrore++
          this.logger.error(
            'Accodamento della trasmissione RENTRI sospesa fallito, si prosegue con le altre',
            error instanceof Error ? error : new Error(String(error)),
            { firId, tenantId }
          )
          segnalaErroreJob('riprendiTrasmissioniSospese', error, { tenantId })
        }
      }

      this.logger.info('Ripresa trasmissioni RENTRI sospese completata', {
        trovate: sospese.length,
        accodate,
        inErrore,
      })
    } catch (error: unknown) {
      this.logger.error(
        'Ripresa trasmissioni RENTRI sospese fallita',
        error instanceof Error ? error : new Error(String(error))
      )
      segnalaErroreJob('riprendiTrasmissioniSospese', error)
    }
  }
}
