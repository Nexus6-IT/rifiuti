import { Injectable } from '@nestjs/common'
import type { RentriModalitaLegame } from '@prisma/client'
import { Cron, CronExpression } from '@nestjs/schedule'
import { LoggerService } from '../../core/logger/logger.service'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { TenantContext } from '../../core/context/tenant-context'
import { FIRPrismaRepository } from '../persistence/fir-prisma.repository'
import { RENTRISyncQueue } from '../queue/rentri-sync.queue'
import { RentriModalitaLegameService } from '../rentri/rentri-modalita-legame.service'
import {
  ETA_MASSIMA_PENDING_RENTRI_MS,
  SOGLIA_STALLO_RENTRI_MS,
} from '../../application/rentri/sync-fir-to-rentri.use-case'

/**
 * Riprende le trasmissioni RENTRI rimaste in SYNCING senza che nessun job le
 * stia portando avanti (worker caduto, Redis svuotato, riavvio a metà POST).
 * Ogni 30 minuti cerca, su tutti i tenant, i FIR con la prenotazione più
 * vecchia di `SOGLIA_STALLO_RENTRI_MS` e li riaccoda con priorità low: il use
 * case di sync è idempotente (riprende la transazione già aperta invece di
 * fare una nuova POST) e il jobId per FIR impedisce doppioni in coda.
 *
 * In un tenant IBRIDA la ripresa accoda con `richiedeConferma`, come la
 * trasmissione partita all'emissione: un esito positivo resta una proposta di
 * legame da confermare, non un legame chiuso in silenzio. La modalità si legge
 * con lo stesso servizio di `TrasmettiFIRSecondoModalitaUseCase`, una volta
 * per tenant e per giro; se non si legge, quel FIR resta al giro successivo.
 *
 * Riprende anche i FIR PENDING mai avviati (nessun job li sta portando avanti:
 * es. riaperti mentre Redis era giu') delle aziende in AUTOMATICA o IBRIDA; in
 * MANUALE restano fermi. Il jobId `sync-<firId>` e' deterministico, quindi un
 * FIR gia' in coda non si duplica.
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
    private readonly logger: LoggerService,
    private readonly modalitaLegame: RentriModalitaLegameService
  ) {
    this.logger.setContext(RentriTrasmissioniSospeseJob.name)
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async riprendi(): Promise<void> {
    try {
      const sospese = await this.firRepo.elencaTrasmissioniRentriSospese(
        new Date(Date.now() - SOGLIA_STALLO_RENTRI_MS),
        RentriTrasmissioniSospeseJob.LIMITE,
        new Date(Date.now() - ETA_MASSIMA_PENDING_RENTRI_MS)
      )

      let accodate = 0
      let inErrore = 0
      const modalitaPerTenant = new Map<string, Promise<RentriModalitaLegame>>()
      for (const { firId, tenantId, stato } of sospese) {
        try {
          if (!modalitaPerTenant.has(tenantId)) {
            modalitaPerTenant.set(
              tenantId,
              // Lettura per azienda: nel suo contesto (l'elenco dei FIR e' sul client di sistema)
              TenantContext.run({ tenantId }, async () => {
                const { modalitaLegame } = await this.modalitaLegame.getForTenant(tenantId)
                return modalitaLegame
              })
            )
          }
          const modalita = await modalitaPerTenant.get(tenantId)!
          // Un PENDING mai avviato si riprende solo dove la trasmissione e' automatica:
          // in MANUALE parte solo a mano.
          if (stato === 'PENDING' && modalita === 'MANUALE') continue
          const richiedeConferma = modalita === 'IBRIDA'
          await this.queue.addSyncJob({ firId, tenantId, priority: 'low', richiedeConferma })
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
