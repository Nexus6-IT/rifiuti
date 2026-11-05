import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Logger } from '@nestjs/common'
import { DelayedError, Job, UnrecoverableError } from 'bullmq'
import {
  ElaborazioneAttivaError,
  ElaborazioneNonTrovataError,
  MESSAGGIO_ALTRA_ELABORAZIONE,
  MESSAGGIO_ERRORE_TECNICO_ANTEPRIMA,
  eseguiAnteprima,
  segnaFallita,
} from '../../../application/fatturazione/anteprima'
import {
  CODA_FATTURAZIONE,
  type JobFatturazione,
} from '../../../application/fatturazione/elaborazioni.service'
import { TenantContext } from '../../../core/context/tenant-context'
import { segnalaErroreJob } from '../../../core/monitoring/segnala-errore-job'
import { PrismaService } from '../../persistence/prisma.service'

/** Attesa prima di riprovare quando un'altra elaborazione del tenant e' `IN_CORSO` (Q12). */
export const ATTESA_RINVIO_MS = 30_000
/** Quante volte il job puo' essere rimesso in attesa prima di diventare `FALLITA`. */
export const RINVII_MASSIMI = 10

/**
 * Worker della coda `fatturazione` (spec §9): il lavoro gira nel contesto dell'azienda del job,
 * col ruolo applicativo e la RLS. Senza azienda: `UnrecoverableError` senza toccare il database.
 * Il job `anteprima` ha 2 tentativi; l'ultimo che fallisce porta l'elaborazione a `FALLITA`.
 * La definitiva e' del Task 19.
 */
@Processor(CODA_FATTURAZIONE, { concurrency: 2 })
export class FatturazioneJobProcessor extends WorkerHost {
  private readonly logger = new Logger(FatturazioneJobProcessor.name)

  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async process(job: Job<JobFatturazione>, token?: string): Promise<void> {
    const { tenantId, elaborazioneId, tipo, versione } = job.data ?? ({} as JobFatturazione)

    // Un retry non puo' far comparire un tenantId che non c'e': fallimento definitivo, prima di
    // qualunque query (stesso schema di `rentri-sync`).
    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      this.logger.error(`Job fatturazione senza azienda: fallimento definitivo (jobId=${job.id})`)
      throw new UnrecoverableError('Job fatturazione senza azienda (tenantId mancante)')
    }
    const tenant = tenantId.trim()

    await TenantContext.run({ tenantId: tenant }, async () => {
      if (tipo === 'anteprima') {
        await this.anteprima(job, token, tenant, elaborazioneId, versione)
        return
      }
      throw new UnrecoverableError(`Tipo di job fatturazione non gestito: ${String(tipo)}`)
    })
  }

  private async anteprima(
    job: Job<JobFatturazione>,
    token: string | undefined,
    tenantId: string,
    elaborazioneId: string,
    versione: number
  ): Promise<void> {
    try {
      await eseguiAnteprima(this.prisma, tenantId, elaborazioneId, versione)
    } catch (err) {
      if (err instanceof ElaborazioneNonTrovataError) {
        // Non e' di questo tenant (o non esiste): niente da scrivere, niente da ritentare.
        throw new UnrecoverableError('Elaborazione non trovata')
      }
      if (err instanceof ElaborazioneAttivaError) {
        const rinvii = job.data.rinvii ?? 0
        if (rinvii >= RINVII_MASSIMI) {
          await segnaFallita(
            this.prisma,
            tenantId,
            elaborazioneId,
            MESSAGGIO_ALTRA_ELABORAZIONE,
            versione
          )
          throw new UnrecoverableError(MESSAGGIO_ALTRA_ELABORAZIONE)
        }
        await job.updateData({ ...job.data, rinvii: rinvii + 1 })
        await job.moveToDelayed(Date.now() + ATTESA_RINVIO_MS, token)
        throw new DelayedError()
      }
      const tentativi = job.opts?.attempts ?? 1
      const ultimo = job.attemptsMade + 1 >= tentativi
      this.logger.error(
        `Anteprima fallita (jobId=${job.id}, tentativo=${job.attemptsMade + 1}/${tentativi})`,
        err instanceof Error ? err.stack : String(err)
      )
      if (ultimo) {
        await segnaFallita(
          this.prisma,
          tenantId,
          elaborazioneId,
          MESSAGGIO_ERRORE_TECNICO_ANTEPRIMA,
          versione
        )
        segnalaErroreJob('fatturazione-anteprima', err, { tenantId })
      }
      throw err
    }
  }
}
