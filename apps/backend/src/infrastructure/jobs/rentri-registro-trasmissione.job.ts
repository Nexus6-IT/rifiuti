import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { LoggerService } from '../../core/logger/logger.service'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'
import { PrismaService } from '../persistence/prisma.service'
import { TenantContext } from '../../core/context/tenant-context'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'
import { RentriCredentialResolver } from '../rentri/rentri-credential.resolver'
import { TrasmissioniRegistroRepository } from '../../application/rentri/registro/trasmissioni-registro.repository'
import { inviiRegistroAttivi } from '../../application/rentri/registro/invii-registro-attivi'
import { TrasmettiLottoRegistroUseCase } from '../../application/rentri/registro/trasmetti-lotto-registro.use-case'
import { SOGLIA_STALLO_RENTRI_MS } from '../../application/rentri/sync-fir-to-rentri.use-case'

/** Movimenti adottati al massimo per giro e per tipo (D14). */
const LIMITE_ADOZIONE = 1000

/**
 * Trasmette a RENTRI il registro di carico/scarico (F2-9, D14), ogni 10 minuti.
 *
 * Per ogni azienda ACTIVE/TRIAL con certificato RENTRI, nel suo contesto:
 * (1) stalli `IN_INVIO` -> `INCERTA`; (2) ripresa delle attese di esito;
 * (3) adozione dei movimenti (automatici e correzioni); (4) un lotto per
 * ogni registro con identificativo RENTRI (saltato se `RENTRI_REGISTRO_INVII_ATTIVI=false`).
 *
 * Il job chiama solo use case e repository esistenti: nessuna ritrasmissione
 * propria. Un errore su una fase, un registro o un'azienda non ferma gli altri.
 * `GIA_IN_CORSO` (try-lock della prenotazione, altro processo) e' normale.
 * Un flag in memoria evita due giri sovrapposti nello stesso processo; fra
 * processi basta la prenotazione. I log riportano solo id tecnici e conteggi,
 * mai il corpo inviato (D15).
 */
@Injectable()
export class RentriRegistroTrasmissioneJob {
  private inEsecuzione = false

  constructor(
    private readonly sistema: PrismaSistemaService,
    private readonly prisma: PrismaService,
    private readonly credenziali: RentriCredentialResolver,
    private readonly repo: TrasmissioniRegistroRepository,
    private readonly trasmetti: TrasmettiLottoRegistroUseCase,
    private readonly logger: LoggerService
  ) {
    this.logger.setContext(RentriRegistroTrasmissioneJob.name)
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async eseguiTrasmissione(): Promise<void> {
    if (this.inEsecuzione) {
      this.logger.warn('Giro di trasmissione del registro RENTRI ancora in corso: salto questo')
      return
    }
    this.inEsecuzione = true
    try {
      // Interruttore di emergenza: gli invii si saltano, la ripresa degli esiti (GET) prosegue.
      // Un solo avviso per giro, non uno per azienda o registro.
      const invii = inviiRegistroAttivi()
      if (!invii) {
        this.logger.warn(
          'Invii RENTRI sospesi (RENTRI_REGISTRO_INVII_ATTIVI=false): si leggono solo gli esiti'
        )
      }
      const tenants = await this.sistema.tenant.findMany({
        where: escludiPiattaforma({ subscriptionStatus: { in: ['ACTIVE', 'TRIAL'] } }),
        select: { id: true },
      })
      let aziendeInErrore = 0
      for (const tenant of tenants) {
        const ok = await this.giroAzienda(tenant.id, invii)
        if (!ok) aziendeInErrore++
      }
      this.logger.info('Giro di trasmissione del registro RENTRI completato', {
        tenantTotali: tenants.length,
        aziendeInErrore,
      })
    } catch (error: unknown) {
      this.logger.error(
        'Giro di trasmissione del registro RENTRI fallito',
        error instanceof Error ? error : new Error(String(error))
      )
      segnalaErroreJob('eseguiTrasmissione', error)
    } finally {
      this.inEsecuzione = false
    }
  }

  /** @returns false se almeno una fase o un registro dell'azienda ha avuto un errore. */
  private async giroAzienda(tenantId: string, invii: boolean): Promise<boolean> {
    let pulito = true
    const errore = (fase: string, error: unknown) => {
      pulito = false
      this.logger.error(
        `Trasmissione registro RENTRI: fase "${fase}" fallita, si prosegue`,
        error instanceof Error ? error : new Error(String(error)),
        { tenantId }
      )
      segnalaErroreJob('eseguiTrasmissione', error, { tenantId, fase })
    }

    try {
      const haCredenziale = await TenantContext.run(
        { tenantId },
        async () => await this.credenziali.haCredenziale(tenantId)
      )
      if (!haCredenziale) {
        this.logger.debug(`azienda ${tenantId} senza certificato RENTRI: saltata`, { tenantId })
        return true
      }
    } catch (error: unknown) {
      errore('certificato', error)
      return false
    }

    const fasi: Array<[string, () => Promise<unknown>]> = [
      [
        'stalli',
        () => this.repo.stalliInInvio(tenantId, new Date(Date.now() - SOGLIA_STALLO_RENTRI_MS)),
      ],
      ['ripresa', () => this.trasmetti.riprendiAttese(tenantId)],
      ['adozione automatiche', () => this.repo.adottaAutomatiche(tenantId, LIMITE_ADOZIONE)],
      ['adozione correzioni', () => this.repo.adottaCorrezioni(tenantId, LIMITE_ADOZIONE)],
    ]
    for (const [nome, esegui] of fasi) {
      try {
        await TenantContext.run({ tenantId }, async () => await esegui())
      } catch (error: unknown) {
        errore(nome, error)
      }
    }

    if (!invii) return pulito

    let registri: Array<{ id: string }>
    try {
      registri = await TenantContext.run(
        { tenantId },
        async () =>
          await this.prisma.registroRifiuti.findMany({
            where: { tenantId, identificativoRentri: { not: null } },
            select: { id: true },
          })
      )
    } catch (error: unknown) {
      errore('elenco registri', error)
      return false
    }

    for (const registro of registri) {
      try {
        const esito = await TenantContext.run(
          { tenantId },
          async () => await this.trasmetti.trasmettiRegistro(tenantId, registro.id)
        )
        if (esito.esito === 'SENZA_CERTIFICATO') {
          // Certificato sparito durante il giro: non e' un guasto, si salta l'azienda.
          this.logger.debug(`azienda ${tenantId} senza certificato RENTRI: saltata`, { tenantId })
          break
        }
        if (esito.esito !== 'NIENTE' && esito.esito !== 'GIA_IN_CORSO') {
          this.logger.info('Registro RENTRI: lotto elaborato', {
            tenantId,
            registroId: registro.id,
            esito: esito.esito,
            trasmesse: esito.trasmesse,
            rifiutate: esito.rifiutate,
            incerte: esito.incerte ?? 0,
            nonTrasmissibili: esito.nonTrasmissibili,
            inAttesa: esito.inAttesa,
            attesaEsito: esito.attesaEsito,
          })
        }
      } catch (error: unknown) {
        errore('invio', error)
      }
    }
    return pulito
  }
}
