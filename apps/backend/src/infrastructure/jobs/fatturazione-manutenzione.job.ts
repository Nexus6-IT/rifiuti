import { ABBONAMENTO_OPERATIVO_DEL_GRUPPO } from '../../application/billing/contratto-gruppo.service'
import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import type { Queue } from 'bullmq'
import {
  CODA_FATTURAZIONE,
  ORFANA_DOPO_MINUTI,
} from '../../application/fatturazione/elaborazioni.service'
import {
  pulisciBozzeTenant,
  recuperaOrfaniTenant,
} from '../../application/fatturazione/manutenzione-fatturazione'
import { nelContestoTenant } from '../../application/pese/nel-contesto-tenant'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'
import { PrismaService } from '../persistence/prisma.service'

/** Una transazione per tenant: la pulizia di molte bozze puo' durare piu' dei 15 s delle scritture interattive. */
const OPZIONI_TRANSAZIONE_MANUTENZIONE = { timeout: 60_000, maxWait: 10_000 } as const

export const TIMEOUT_JOB_VIVI_MS = 10_000

/** Stati della coda in cui un job e' ancora «vivo»: lo lavora qualcuno o lo lavorera'. */
const STATI_JOB_VIVI = ['active', 'waiting', 'delayed', 'prioritized', 'paused'] as const

export interface EsitoPulizia {
  tenantTotali: number
  tenantConErrore: number
  bozzeCancellate: number
}
export interface EsitoRecupero {
  tenantTotali: number
  tenantConErrore: number
  recuperate: number
}

/**
 * Manutenzione della fatturazione (4.4b1, Task 22). Due cron: gli orfani ogni 10 minuti (Q25) e
 * la pulizia delle bozze una volta al giorno. Gli orfani si controllano anche all'avvio del modulo.
 *
 * I tenant vengono dal client di sistema (come `RentriRiconciliazioneJob`), ma OGNI scrittura gira
 * nel contesto del suo tenant, col ruolo applicativo e la RLS, in una transazione per tenant. Un
 * errore su un tenant si segnala e non ferma gli altri. Mai un DELETE fra tenant.
 *
 * Senza l'elenco dei job vivi (Redis non risponde) il giro degli orfani NON parte: tutte le
 * elaborazioni attive sembrerebbero orfane e verrebbero fatte fallire mentre girano.
 */
@Injectable()
export class FatturazioneManutenzioneJob implements OnModuleInit {
  private readonly logger = new Logger(FatturazioneManutenzioneJob.name)
  /** Sostituibile nei test. */
  orologio: () => Date = () => new Date()
  /** Attesa massima per l'elenco dei job vivi; oltre, il giro degli orfani salta. */
  timeoutJobViviMs = TIMEOUT_JOB_VIVI_MS

  constructor(
    private readonly prisma: PrismaService,
    private readonly sistema: PrismaSistemaService,
    @InjectQueue(CODA_FATTURAZIONE) private readonly coda: Queue
  ) {}

  /**
   * Un'elaborazione appesa da prima del riavvio non deve aspettare il cron: bloccherebbe il tenant.
   * Il giro parte SENZA essere atteso: con Redis lento o giu' l'avvio dell'applicazione non resta
   * appeso. L'errore si logga e si segnala, cosi' non nasce una unhandled rejection.
   */
  onModuleInit(): void {
    void this.recuperaOrfani().catch((errore: unknown) => {
      this.logger.error("Controllo degli orfani all'avvio fallito", errore as Error)
      segnalaErroreJob('eseguiRecuperoOrfani', errore)
    })
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async eseguiRecuperoOrfani(): Promise<void> {
    try {
      await this.recuperaOrfani()
    } catch (errore: unknown) {
      segnalaErroreJob('eseguiRecuperoOrfani', errore)
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async eseguiPulizia(): Promise<void> {
    try {
      await this.pulisciBozze()
    } catch (errore: unknown) {
      segnalaErroreJob('eseguiPulizia', errore)
    }
  }

  async recuperaOrfani(): Promise<EsitoRecupero> {
    // Prima la coda: se non risponde si esce senza toccare il database.
    const jobVivi = await this.jobVivi()
    const ora = this.orologio()
    let recuperate = 0
    const { tenantTotali, tenantConErrore } = await this.perOgniTenant(
      'eseguiRecuperoOrfani',
      tenantId =>
        this.inTransazione(tenantId, async tx => {
          recuperate += await recuperaOrfaniTenant(tx, tenantId, jobVivi, ora)
        })
    )
    this.logger.log(
      `Orfani della fatturazione: ${recuperate} recuperate (soglia IN_CODA ${ORFANA_DOPO_MINUTI} min), ` +
        `${tenantConErrore}/${tenantTotali} aziende con errore`
    )
    return { tenantTotali, tenantConErrore, recuperate }
  }

  async pulisciBozze(): Promise<EsitoPulizia> {
    const ora = this.orologio()
    let bozzeCancellate = 0
    const { tenantTotali, tenantConErrore } = await this.perOgniTenant('eseguiPulizia', tenantId =>
      this.inTransazione(tenantId, async tx => {
        bozzeCancellate += await pulisciBozzeTenant(tx, tenantId, ora)
      })
    )
    this.logger.log(
      `Pulizia bozze della fatturazione: ${bozzeCancellate} cancellate, ` +
        `${tenantConErrore}/${tenantTotali} aziende con errore`
    )
    return { tenantTotali, tenantConErrore, bozzeCancellate }
  }

  private async jobVivi(): Promise<ReadonlySet<string>> {
    let timer: NodeJS.Timeout | undefined
    const scadenza = new Promise<never>((_, rifiuta) => {
      timer = setTimeout(
        () => rifiuta(new Error("Timeout sull'elenco dei job vivi della coda fatturazione")),
        this.timeoutJobViviMs
      )
    })
    let job: Awaited<ReturnType<Queue['getJobs']>>
    try {
      job = await Promise.race([this.coda.getJobs([...STATI_JOB_VIVI]), scadenza])
    } finally {
      clearTimeout(timer)
    }
    const ids = new Set<string>()
    for (const j of job) if (j?.id) ids.add(String(j.id))
    return ids
  }

  private inTransazione(
    tenantId: string,
    fn: (tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0]) => Promise<void>
  ): Promise<void> {
    return nelContestoTenant(tenantId, () =>
      this.prisma.$transaction(tx => fn(tx), OPZIONI_TRANSAZIONE_MANUTENZIONE)
    )
  }

  private async perOgniTenant(
    nomeJob: string,
    lavoro: (tenantId: string) => Promise<void>
  ): Promise<{ tenantTotali: number; tenantConErrore: number }> {
    const tenants = await this.sistema.tenant.findMany({
      where: escludiPiattaforma({ OR: ABBONAMENTO_OPERATIVO_DEL_GRUPPO }),
      select: { id: true },
    })
    let tenantConErrore = 0
    for (const tenant of tenants) {
      try {
        await lavoro(tenant.id)
      } catch (errore: unknown) {
        tenantConErrore += 1
        this.logger.error(
          `${nomeJob} fallito per l'azienda ${tenant.id}, si prosegue con le altre`,
          errore as Error
        )
        segnalaErroreJob(nomeJob, errore, { tenantId: tenant.id })
      }
    }
    return { tenantTotali: tenants.length, tenantConErrore }
  }
}
