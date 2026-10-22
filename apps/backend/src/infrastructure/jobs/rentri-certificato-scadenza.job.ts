import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { LoggerService } from '../../core/logger/logger.service'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { MetricsService } from '../../core/metrics/metrics.service'
import { PrismaService } from '../persistence/prisma.service'
import { calcolaGiorniAllaScadenzaCertificato } from '../rentri/rentri-certificato-scadenza.util'

/** Esito di un giro per tenant: serve al rilancio manuale per distinguere completato e parziale. */
export interface EsitoGiroRentri {
  tenantTotali: number
  tenantConErrore: number
}

/**
 * Job giornaliero di scadenza del certificato RENTRI (R5, Task 5).
 *
 * Alimenta il gauge Prometheus `wasteflow_rentri_certificate_expiry_days`
 * (label `tenant_id`), letto dalla regola di allarme
 * `monitoring/alerts/rentri.yml` (soglia 30 giorni, stessa soglia — non
 * re-inventata — di `RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_30` in
 * `get-rentri-diagnostica.use-case.ts`).
 *
 * Frequenza: una volta al giorno. Un controllo più frequente non ha senso:
 * la scadenza di un certificato si muove di giorni (la data `notAfter` non
 * cambia mai da un'esecuzione all'altra finché il tenant non carica un
 * certificato nuovo), non di minuti — un cron orario o più fitto
 * moltiplicherebbe le esecuzioni senza produrre alcun dato più fresco.
 *
 * Isolamento per tenant: stesso pattern di `RentriRiconciliazioneJob`
 * (try/catch PER TENANT, mai per l'intero giro) — un certificato non
 * analizzabile per un tenant non deve impedire l'aggiornamento del gauge
 * degli altri.
 */
@Injectable()
export class RentriCertificatoScadenzaJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RentriCertificatoScadenzaJob.name)
  }

  /** Handler dello scheduler: non rilancia mai e segnala a Bugsink l'errore generale. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async eseguiControlloScadenza(): Promise<void> {
    try {
      await this.controllaScadenze()
    } catch (error: unknown) {
      segnalaErroreJob('eseguiControlloScadenza', error)
    }
  }

  /**
   * Il giro vero e proprio, chiamabile anche dal rilancio manuale. Un errore
   * generale si logga e si rilancia: lo registra l'audit come fallito; la
   * segnalazione a Bugsink spetta all'handler @Cron.
   */
  async controllaScadenze(): Promise<EsitoGiroRentri> {
    this.logger.info('Avvio controllo giornaliero scadenza certificati RENTRI')

    try {
      // `RentriCredential` non dichiara una relazione Prisma verso `Tenant`
      // (solo `tenantId` come colonna, v. schema.prisma): niente `where:
      // { tenant: {...} }` innestato, si filtra in due passi — prima i tenant
      // ACTIVE/TRIAL, poi le credenziali di quei soli tenant.
      const tenantsAttivi = await this.prisma.tenant.findMany({
        where: { subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] } },
        select: { id: true },
      })
      const credenziali = await this.prisma.rentriCredential.findMany({
        where: { tenantId: { in: tenantsAttivi.map(t => t.id) } },
        select: { tenantId: true, certificatePem: true },
      })

      let tenantConSuccesso = 0
      let tenantConErrore = 0

      for (const credenziale of credenziali) {
        try {
          const giorni = calcolaGiorniAllaScadenzaCertificato(credenziale.certificatePem)
          if (giorni === null) {
            this.logger.warn('Certificato RENTRI non analizzabile: gauge non aggiornato', {
              tenantId: credenziale.tenantId,
            })
            continue
          }

          this.metrics.rentriCertificateExpiryDays.set({ tenant_id: credenziale.tenantId }, giorni)
          tenantConSuccesso++
        } catch (error: unknown) {
          // Isolamento per tenant: un errore inatteso su UN certificato non
          // deve impedire l'aggiornamento del gauge per gli altri tenant.
          tenantConErrore++
          this.logger.error(
            'Controllo scadenza certificato RENTRI fallito per il tenant, si prosegue con gli altri',
            error instanceof Error ? error : new Error(String(error)),
            { tenantId: credenziale.tenantId }
          )
          segnalaErroreJob('eseguiControlloScadenza', error, { tenantId: credenziale.tenantId })
        }
      }

      this.logger.info('Controllo giornaliero scadenza certificati RENTRI completato', {
        tenantTotali: credenziali.length,
        tenantConSuccesso,
        tenantConErrore,
      })

      return { tenantTotali: credenziali.length, tenantConErrore }
    } catch (error: unknown) {
      this.logger.error(
        'Controllo giornaliero scadenza certificati RENTRI fallito',
        error instanceof Error ? error : new Error(String(error))
      )
      throw error
    }
  }
}
