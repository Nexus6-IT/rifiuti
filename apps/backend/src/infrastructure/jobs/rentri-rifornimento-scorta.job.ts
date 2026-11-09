import { ABBONAMENTO_OPERATIVO_DEL_GRUPPO } from '../../application/billing/contratto-gruppo.service'
import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { LoggerService } from '../../core/logger/logger.service'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'
import { TenantContext } from '../../core/context/tenant-context'
import { RentriCredentialResolver } from '../rentri/rentri-credential.resolver'
import { RentriUnitaLocaleService } from '../rentri/rentri-unita-locale.service'
import { RentriScortaRepository } from '../persistence/rentri-scorta.repository'
import { AvviaVidimazioneScortaUseCase } from '../../application/rentri/scorta/avvia-vidimazione-scorta.use-case'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'

/**
 * Rifornisce periodicamente la scorta di numeri FIR pre-vidimati (R6): per
 * ogni unità locale con una soglia (`dimensioneScortaDesiderata`) e un
 * blocco predefinito (`codiceBloccoPredefinito`) configurati, se i
 * DISPONIBILI sono sotto soglia vidima la differenza.
 *
 * **Nessuna soglia inventata**: se `dimensioneScortaDesiderata` è null il
 * job non fa nulla per quella sede e lo scrive nel log a livello debug — è
 * il comportamento richiesto esplicitamente ("non inventare una soglia").
 * Stessa cautela per il blocco: senza `codiceBloccoPredefinito` non c'è modo
 * di sapere DOVE vidimare, e indovinare (es. "il primo blocco attivo
 * trovato") violerebbe fail-closed.
 *
 * Frequenza: ogni 30 minuti. Più frequente della riconciliazione (6 ore,
 * `RentriRiconciliazioneJob`) perché qui il costo di un ritardo è diretto —
 * un'emissione che trova la scorta vuota è bloccata subito, non fra ore —
 * ma non così frequente da sommergere l'ente di vidimazioni per una scorta
 * che scende di poche unità al giorno in un tenant tipico.
 *
 * Isolamento per tenant, stesso pattern di `RentriRiconciliazioneJob`: un
 * tenant che fallisce (credenziale scaduta, ente irraggiungibile) non deve
 * bloccare il rifornimento degli altri.
 */
@Injectable()
export class RentriRifornimentoScortaJob {
  constructor(
    private readonly sistema: PrismaSistemaService,
    private readonly unitaLocaleService: RentriUnitaLocaleService,
    private readonly scortaRepo: RentriScortaRepository,
    private readonly avviaVidimazione: AvviaVidimazioneScortaUseCase,
    private readonly logger: LoggerService,
    private readonly credenziali: RentriCredentialResolver,
    private readonly moduli: ModuliAttiviService
  ) {
    this.logger.setContext(RentriRifornimentoScortaJob.name)
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async eseguiRifornimento(): Promise<void> {
    this.logger.info('Avvio rifornimento periodico scorta RENTRI')

    try {
      // Sistema: elenco di tutte le aziende attive, senza un'azienda nota in partenza
      const candidati = await this.sistema.tenant.findMany({
        where: escludiPiattaforma({ OR: ABBONAMENTO_OPERATIVO_DEL_GRUPPO }),
        select: { id: true },
      })

      // Solo le aziende col modulo rentri (D4b): UNA query per tutte, senza N+1.
      const conModulo = await this.moduli.tenantConModulo(
        candidati.map(t => t.id),
        'rentri'
      )
      const tenants = candidati.filter(t => conModulo.has(t.id))

      let sediRifornite = 0
      let sediInErrore = 0

      for (const tenant of tenants) {
        let unitaLocali: Awaited<ReturnType<RentriUnitaLocaleService['listForTenant']>>
        try {
          // Azienda senza certificato RENTRI (e non legata all'env): non e' un guasto,
          // si salta con un info e senza segnalazione a Bugsink.
          // Da qui in poi l'azienda e' nota: letture nel suo contesto
          const haCredenziale = await TenantContext.run(
            { tenantId: tenant.id },
            async () => await this.credenziali.haCredenziale(tenant.id)
          )
          if (!haCredenziale) {
            this.logger.info(`azienda ${tenant.id} senza certificato RENTRI: saltata`, {
              tenantId: tenant.id,
            })
            continue
          }
          unitaLocali = await TenantContext.run(
            { tenantId: tenant.id },
            async () => await this.unitaLocaleService.listForTenant(tenant.id)
          )
        } catch (error: unknown) {
          sediInErrore++
          this.logger.error(
            'Elenco sedi RENTRI non disponibile per il tenant, si prosegue con gli altri',
            error instanceof Error ? error : new Error(String(error)),
            { tenantId: tenant.id }
          )
          segnalaErroreJob('eseguiRifornimento', error, { tenantId: tenant.id })
          continue
        }

        for (const sede of unitaLocali) {
          if (!sede.dimensioneScortaDesiderata) {
            this.logger.debug(
              'Nessuna soglia di scorta configurata per questa sede, nessun rifornimento',
              {
                tenantId: tenant.id,
                numIscrSito: sede.numIscrSito,
              }
            )
            continue
          }

          if (!sede.codiceBloccoPredefinito) {
            this.logger.debug(
              'Nessun blocco predefinito configurato per questa sede: nessun rifornimento (fail-closed, mai un blocco indovinato)',
              { tenantId: tenant.id, numIscrSito: sede.numIscrSito }
            )
            continue
          }

          try {
            // Valori gia' verificati dai guard sopra, fissati prima della closure
            const soglia = sede.dimensioneScortaDesiderata
            const codiceBlocco = sede.codiceBloccoPredefinito
            const esito = await TenantContext.run({ tenantId: tenant.id }, async () => {
              const disponibili = await this.scortaRepo.contaTotaleDisponibili(
                tenant.id,
                sede.numIscrSito
              )
              const mancanti = soglia - disponibili

              if (mancanti <= 0) {
                return null
              }

              return await this.avviaVidimazione.execute(tenant.id, codiceBlocco, mancanti)
            })
            if (!esito) {
              continue
            }
            sediRifornite++
            this.logger.info('Rifornimento scorta RENTRI eseguito per la sede', {
              tenantId: tenant.id,
              numIscrSito: sede.numIscrSito,
              codiceBlocco: sede.codiceBloccoPredefinito,
              ...esito,
            })
          } catch (error: unknown) {
            sediInErrore++
            this.logger.error(
              'Rifornimento scorta RENTRI fallito per la sede, si prosegue con le altre',
              error instanceof Error ? error : new Error(String(error)),
              { tenantId: tenant.id, numIscrSito: sede.numIscrSito }
            )
            segnalaErroreJob('eseguiRifornimento', error, { tenantId: tenant.id })
          }
        }
      }

      this.logger.info('Rifornimento periodico scorta RENTRI completato', {
        tenantTotali: tenants.length,
        sediRifornite,
        sediInErrore,
      })
    } catch (error: unknown) {
      this.logger.error(
        'Rifornimento periodico scorta RENTRI fallito',
        error instanceof Error ? error : new Error(String(error))
      )
      segnalaErroreJob('eseguiRifornimento', error)
    }
  }
}
