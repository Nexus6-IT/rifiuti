import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { ABBONAMENTO_OPERATIVO_DEL_GRUPPO } from '../../application/billing/contratto-gruppo.service'
import {
  ElaboraInvioSdiService,
  type EsitoGiroSdi,
} from '../../application/sdi/elabora-invio-sdi.service'
import { inviiSdiAttivi } from '../../application/sdi/invii-sdi-attivi'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'

export interface EsitoGiroGlobaleSdi {
  aziende: number
  aziendeInErrore: number
  inviate: number
  rifiutate: number
}

/**
 * Invio delle fatture allo SDI (4.5b, piano §4.4), ogni minuto, sul modello di
 * `RentriRegistroTrasmissioneJob`. Il client di sistema serve SOLO a elencare le aziende candidate
 * (con modulo `sdi` e una configurazione); tutto il resto passa da `ElaboraInvioSdiService` nel
 * contesto dell'azienda. Un flag in memoria evita due giri sovrapposti nello stesso processo; fra
 * processi bastano la prenotazione `FOR UPDATE SKIP LOCKED` e gli UPDATE condizionati.
 *
 * Interruttore d'emergenza: `SDI_INVII_ATTIVI` diverso da `true` (default) = nessun invio; stalli e
 * riconciliazione proseguono. Un errore su un'azienda non ferma le altre. Nei log solo id e conteggi.
 */
@Injectable()
export class SdiInvioJob {
  private readonly logger = new Logger(SdiInvioJob.name)
  private inEsecuzione = false
  /** Sostituibile nei test. */
  orologio: () => Date = () => new Date()

  constructor(
    private readonly sistema: PrismaSistemaService,
    private readonly moduli: ModuliAttiviService,
    private readonly elabora: ElaboraInvioSdiService
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async eseguiInvio(): Promise<EsitoGiroGlobaleSdi | null> {
    if (this.inEsecuzione) {
      this.logger.warn('Giro di invio SDI ancora in corso: salto questo')
      return null
    }
    this.inEsecuzione = true
    try {
      return await this.giro()
    } catch (errore: unknown) {
      this.logger.error(
        'Giro di invio SDI fallito',
        errore instanceof Error ? errore.stack : undefined
      )
      segnalaErroreJob('eseguiInvio', errore)
      return null
    } finally {
      this.inEsecuzione = false
    }
  }

  private async giro(): Promise<EsitoGiroGlobaleSdi> {
    const invii = inviiSdiAttivi()
    const candidati = await this.sistema.tenant.findMany({
      where: escludiPiattaforma({
        OR: ABBONAMENTO_OPERATIVO_DEL_GRUPPO,
        configurazioniSdi: { some: {} },
      }),
      select: { id: true },
    })
    // Solo le aziende col modulo `sdi`: UNA query per tutte, senza N+1.
    const conModulo = await this.moduli.tenantConModulo(
      candidati.map(t => t.id),
      'sdi'
    )
    const tenants = candidati.filter(t => conModulo.has(t.id))
    const totale: EsitoGiroGlobaleSdi = {
      aziende: tenants.length,
      aziendeInErrore: 0,
      inviate: 0,
      rifiutate: 0,
    }
    for (const tenant of tenants) {
      let esito: EsitoGiroSdi
      try {
        esito = await this.elabora.giroAzienda(tenant.id, this.orologio(), { invii })
      } catch (errore: unknown) {
        totale.aziendeInErrore++
        this.logger.error(
          `Giro di invio SDI fallito per l'azienda ${tenant.id}`,
          errore instanceof Error ? errore.stack : undefined
        )
        segnalaErroreJob('eseguiInvio', errore, { tenantId: tenant.id })
        continue
      }
      totale.inviate += esito.inviate
      totale.rifiutate += esito.rifiutate
      if (esito.errori > 0) totale.aziendeInErrore++
      if (esito.inviate + esito.rifiutate + esito.stalli + esito.riconciliate > 0) {
        this.logger.log(
          `Invio SDI azienda ${tenant.id}: inviate ${esito.inviate}, rifiutate ${esito.rifiutate}, ritentate ${esito.ritentate}, incerte ${esito.incerte}, stalli ${esito.stalli}, riconciliate ${esito.riconciliate}`
        )
      }
    }
    if (!invii) {
      this.logger.debug(
        'Invii SDI sospesi (SDI_INVII_ATTIVI diverso da true): solo riconciliazione'
      )
    }
    return totale
  }
}
