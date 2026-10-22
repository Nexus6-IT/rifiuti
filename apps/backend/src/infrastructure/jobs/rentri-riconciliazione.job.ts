import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { LoggerService } from '../../core/logger/logger.service'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { PrismaService } from '../persistence/prisma.service'
import { RiconciliaStatoRentriUseCase } from '../../application/rentri/riconcilia-stato-rentri.use-case'
import { EsitoGiroRentri } from './esito-giro-rentri'

/**
 * Job di riconciliazione periodica dello stato RENTRI (R5, Task 4).
 *
 * Frequenza: ogni 6 ore (4 esecuzioni al giorno), per tenant. Le divergenze
 * rilevanti (operazione fatta sul portale, trasmissione persa) nascono da
 * eventi umani o di manutenzione, non da un processo che cambia stato ogni
 * minuto — un ritardo di poche ore prima di rilevarle è accettabile per un
 * dato che oggi non viene riconciliato affatto. Un intervallo più corto (es.
 * ogni 15 minuti, 96 volte/giorno) non cambierebbe l'esperienza utente in
 * modo percepibile ma moltiplicherebbe per 24 il traffico verso l'ente per
 * un beneficio che non esiste finché l'utente non è in una pagina che
 * dipende da quel dato aggiornato — e quella pagina (R5 Task 3, diagnostica)
 * non aspetta comunque la riconciliazione: legge l'ultimo risultato noto.
 *
 * Isolamento per tenant: un tenant con errori (es. credenziale scaduta, già
 * rilevato) non deve bloccare la riconciliazione degli altri — try/catch PER
 * TENANT, non attorno all'intero giro. Pattern di iterazione sui tenant
 * attivi identico a `DeadlineCheckerService`
 * (`application/notifications/deadline-checker.service.ts`).
 */
@Injectable()
export class RentriRiconciliazioneJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riconciliaStatoRentri: RiconciliaStatoRentriUseCase,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RentriRiconciliazioneJob.name)
  }

  /** Handler dello scheduler: non rilancia mai e segnala a Bugsink l'errore generale. */
  @Cron(CronExpression.EVERY_6_HOURS)
  async eseguiRiconciliazione(): Promise<void> {
    try {
      await this.riconcilia()
    } catch (error: unknown) {
      segnalaErroreJob('eseguiRiconciliazione', error)
    }
  }

  /**
   * Il giro vero e proprio, chiamabile anche dal rilancio manuale. Un errore
   * generale (es. lettura dei tenant) si logga e si rilancia: lo registra
   * l'audit come fallito; la segnalazione a Bugsink spetta all'handler @Cron.
   */
  async riconcilia(): Promise<EsitoGiroRentri> {
    this.logger.info('Avvio riconciliazione periodica stato RENTRI')

    try {
      const tenants = await this.prisma.tenant.findMany({
        where: {
          subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] },
        },
        select: { id: true },
      })

      let tenantConSuccesso = 0
      let tenantConErrore = 0

      for (const tenant of tenants) {
        try {
          const risultato = await this.riconciliaStatoRentri.execute(tenant.id)
          tenantConSuccesso++

          this.logger.info('Riconciliazione RENTRI completata per il tenant', {
            tenantId: tenant.id,
            controllati: risultato.controllati,
            corretti: risultato.corretti,
            segnalati: risultato.segnalati,
            nessunaDivergenza: risultato.nessunaDivergenza,
          })
        } catch (error: unknown) {
          // Isolamento per tenant: un errore (es. credenziale scaduta,
          // certificato revocato) NON deve interrompere il giro per gli altri
          // tenant. Loggato e basta — il giro successivo (fra 6 ore) riprova
          // da solo, e il tenant vede comunque il proprio stato di errore
          // nella diagnostica (R5 Task 3), che legge dati locali già esistenti
          // e non dipende da questo job per essere popolata.
          tenantConErrore++
          this.logger.error(
            'Riconciliazione RENTRI fallita per il tenant, si prosegue con gli altri',
            error instanceof Error ? error : new Error(String(error)),
            { tenantId: tenant.id }
          )
          segnalaErroreJob('eseguiRiconciliazione', error, { tenantId: tenant.id })
        }
      }

      this.logger.info('Riconciliazione periodica stato RENTRI completata', {
        tenantTotali: tenants.length,
        tenantConSuccesso,
        tenantConErrore,
      })

      return { tenantTotali: tenants.length, tenantConErrore }
    } catch (error: unknown) {
      this.logger.error(
        'Riconciliazione periodica stato RENTRI fallita',
        error instanceof Error ? error : new Error(String(error))
      )
      throw error
    }
  }
}
