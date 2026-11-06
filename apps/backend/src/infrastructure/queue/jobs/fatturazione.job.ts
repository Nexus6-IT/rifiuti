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
import { eseguiDefinitiva } from '../../../application/fatturazione/definitiva'
import {
  CODA_FATTURAZIONE,
  type JobFatturazione,
} from '../../../application/fatturazione/elaborazioni.service'
import { TenantContext } from '../../../core/context/tenant-context'
import { segnalaErroreJob } from '../../../core/monitoring/segnala-errore-job'
import { PrismaService } from '../../persistence/prisma.service'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Attesa prima di riprovare quando un'altra elaborazione del tenant e' `IN_CORSO` (Q12). */
export const ATTESA_RINVIO_MS = 30_000
/** Quante volte il job puo' essere rimesso in attesa prima di diventare `FALLITA`. */
export const RINVII_MASSIMI = 10

/**
 * Worker della coda `fatturazione` (spec §9): il lavoro gira nel contesto dell'azienda del job,
 * col ruolo applicativo e la RLS. Senza azienda: `UnrecoverableError` senza toccare il database.
 * Il job `anteprima` ha 2 tentativi; l'ultimo che fallisce porta l'elaborazione a `FALLITA`.
 * Il job `definitiva` ha UN solo tentativo (spec §9): un secondo troverebbe l'impronta cambiata o lo
 * stato non piu' valido, e l'utente rilancia con una versione nuova. Le uscite senza commit
 * riportano l'elaborazione a `ANTEPRIMA_PRONTA` dentro `eseguiDefinitiva`.
 */
@Processor(CODA_FATTURAZIONE, { concurrency: 2 })
export class FatturazioneJobProcessor extends WorkerHost {
  private readonly logger = new Logger(FatturazioneJobProcessor.name)

  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async process(job: Job<JobFatturazione>, token?: string): Promise<void> {
    const { tenantId, elaborazioneId, tipo, versione, utenteId } =
      job.data ?? ({} as JobFatturazione)

    // Un retry non puo' far comparire un tenantId che non c'e': fallimento definitivo, prima di
    // qualunque query (stesso schema di `rentri-sync`).
    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      this.logger.error(`Job fatturazione senza azienda: fallimento definitivo (jobId=${job.id})`)
      throw new UnrecoverableError('Job fatturazione senza azienda (tenantId mancante)')
    }
    const tenant = tenantId.trim()
    // Un id che non e' un UUID fallirebbe il cast di Postgres a ogni tentativo, e all'ultimo
    // anche `segnaFallita` ne coprirebbe l'errore: fallimento definitivo subito.
    if (
      (tipo === 'anteprima' || tipo === 'definitiva') &&
      (typeof elaborazioneId !== 'string' || !UUID.test(elaborazioneId))
    ) {
      throw new UnrecoverableError('Job fatturazione con elaborazioneId non valido')
    }
    if (tipo === 'definitiva' && utenteId !== undefined && !UUID.test(String(utenteId))) {
      throw new UnrecoverableError('Job fatturazione con utenteId non valido')
    }

    await TenantContext.run({ tenantId: tenant }, async () => {
      if (tipo === 'anteprima') {
        await this.anteprima(job, token, tenant, elaborazioneId, versione)
        return
      }
      if (tipo === 'definitiva') {
        await this.definitiva(job, tenant, elaborazioneId, versione, utenteId ?? null)
        return
      }
      throw new UnrecoverableError(`Tipo di job fatturazione non gestito: ${String(tipo)}`)
    })
  }

  /**
   * Un solo tentativo. L'esito (anche negativo) e' gia' nella colonna `esito` dell'elaborazione:
   * il job finisce senza errore. Un errore tecnico ha gia' riportato l'elaborazione a
   * `ANTEPRIMA_PRONTA` con `errore_tecnico`: qui si segnala e si lascia fallire il job.
   */
  private async definitiva(
    job: Job<JobFatturazione>,
    tenantId: string,
    elaborazioneId: string,
    versione: number,
    utenteId: string | null
  ): Promise<void> {
    try {
      const esito = await eseguiDefinitiva(this.prisma, tenantId, elaborazioneId, utenteId, {
        versione,
        jobId: String(job.id),
      })
      this.logger.log(`Definitiva ${esito.esito} (jobId=${job.id})`)
    } catch (err) {
      if (err instanceof ElaborazioneNonTrovataError) {
        // Non e' di questo tenant (o non esiste): niente da scrivere, niente da ritentare.
        throw new UnrecoverableError('Elaborazione non trovata')
      }
      this.logger.error(
        `Definitiva fallita (jobId=${job.id})`,
        err instanceof Error ? err.stack : String(err)
      )
      segnalaErroreJob('fatturazione-definitiva', err, { tenantId })
      throw err
    }
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
