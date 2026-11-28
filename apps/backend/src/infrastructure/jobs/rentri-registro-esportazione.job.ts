import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { ABBONAMENTO_OPERATIVO_DEL_GRUPPO } from '../../application/billing/contratto-gruppo.service'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import {
  CatenaEsportazioniNonCoerenteError,
  EsportazioneRifiutataInCatenaError,
} from '../../application/rentri/registro/errori-esportazioni-registro-rentri'
import { esportazioniAutomaticheAttive } from '../../application/rentri/registro/esportazioni-automatiche-attive'
import { GeneraEsportazioneRegistroRentriUseCase } from '../../application/rentri/registro/genera-esportazione-registro-rentri.use-case'
import { inviiRegistroAttivi } from '../../application/rentri/registro/invii-registro-attivi'
import {
  inizioMeseItaliano,
  limiteEsportazioneMensile,
  piuVecchiaNonConfermataPerRegistro,
} from '../../application/rentri/registro/limite-esportazione-mensile'
import { ValidaEsportazioneRegistroRentriUseCase } from '../../application/rentri/registro/valida-esportazione-registro-rentri.use-case'
import { giornoItaliano } from '../../core/time/anno-italiano'
import { escludiPiattaforma } from '../../core/context/azienda-piattaforma'
import { TenantContext } from '../../core/context/tenant-context'
import { LoggerService } from '../../core/logger/logger.service'
import { segnalaErroreJob } from '../../core/monitoring/segnala-errore-job'
import { PrismaSistemaService } from '../persistence/prisma-sistema.service'
import { PrismaService } from '../persistence/prisma.service'
import { RentriCredentialResolver } from '../rentri/rentri-credential.resolver'

/** Stati di un'esportazione che hanno ancora bisogno di un esito da RENTRI. */
const STATI_SENZA_ESITO = ['GENERATA', 'IN_VALIDAZIONE', 'VALIDAZIONE_NON_DISPONIBILE'] as const
/** Stati dell'ultima esportazione che permettono di generare la successiva. */
const STATI_CONFERMATI = ['VALIDATA', 'VALIDATA_CON_AVVISI']

/**
 * Esportazione XML mensile AUTOMATICA del registro (eREGI E7, piano Q4). Una volta al giorno.
 *
 * SPENTA di predefinito: gira solo con `RENTRI_ESPORTAZIONI_AUTOMATICHE_ATTIVE=true` (testo esatto)
 * e con gli invii del registro attivi. L'accensione resta bloccata dalla prova della catena dei
 * digest sull'ambiente demo RENTRI (piano eREGI Q6, rischi R1-R3): in produzione resta spenta.
 *
 * Per ogni azienda col modulo `rentri` e il certificato, nel suo contesto:
 * (1) rivalida le esportazioni senza esito (`GENERATA` con `valida`, le altre con `rivalida`);
 * (2) per ogni registro collegato, non chiuso e non in chiusura genera il file dei mesi gia'
 *     chiusi: le annotazioni con data anteriore all'inizio del mese corrente o del mese della piu'
 *     vecchia annotazione non ancora confermata da RENTRI (`limiteEsportazioneMensile`).
 *
 * Prudenza: UN solo file per registro e per giro, e solo se l'ultima esportazione viva ha esito
 * `VALIDATA`/`VALIDATA_CON_AVVISI` (o non ce ne sono): non si impilano anelli senza esito, perche'
 * un rifiuto di RENTRI blocca tutta la catena successiva. Una esportazione `RIFIUTATA` richiede una
 * persona («Sostituisci da qui», solo ADMIN): il job lo scrive nel log e non fa altro.
 * Nessuna chiusura del registro dal job. Niente doppioni: il cursore e il vincolo sul progressivo
 * rendono la generazione idempotente. I log riportano solo id tecnici e conteggi (mai XML, digest,
 * motivi con dati delle annotazioni).
 */
@Injectable()
export class RentriRegistroEsportazioneJob {
  private inEsecuzione = false

  constructor(
    private readonly sistema: PrismaSistemaService,
    private readonly prisma: PrismaService,
    private readonly credenziali: RentriCredentialResolver,
    private readonly genera: GeneraEsportazioneRegistroRentriUseCase,
    private readonly valida: ValidaEsportazioneRegistroRentriUseCase,
    private readonly logger: LoggerService,
    private readonly moduli: ModuliAttiviService
  ) {
    this.logger.setContext(RentriRegistroEsportazioneJob.name)
  }

  /** Istante del giro (separato per i test). */
  protected adesso(): Date {
    return new Date()
  }

  @Cron(CronExpression.EVERY_DAY_AT_5AM)
  async eseguiEsportazione(): Promise<void> {
    // Interruttore spento (predefinito): nessuna lettura, nessun log di rumore.
    if (!esportazioniAutomaticheAttive()) return
    if (!inviiRegistroAttivi()) {
      this.logger.warn(
        'Esportazione automatica del registro RENTRI sospesa: gli invii sono sospesi (RENTRI_REGISTRO_INVII_ATTIVI=false)'
      )
      return
    }
    if (this.inEsecuzione) {
      this.logger.warn('Giro di esportazione del registro RENTRI ancora in corso: salto questo')
      return
    }
    this.inEsecuzione = true
    try {
      const candidati = await this.sistema.tenant.findMany({
        where: escludiPiattaforma({ OR: ABBONAMENTO_OPERATIVO_DEL_GRUPPO }),
        select: { id: true },
      })
      const conModulo = await this.moduli.tenantConModulo(
        candidati.map(t => t.id),
        'rentri'
      )
      const tenants = candidati.filter(t => conModulo.has(t.id))
      let aziendeInErrore = 0
      for (const tenant of tenants) {
        if (!(await this.giroAzienda(tenant.id))) aziendeInErrore++
      }
      this.logger.info('Giro di esportazione del registro RENTRI completato', {
        tenantTotali: tenants.length,
        aziendeInErrore,
      })
    } catch (error: unknown) {
      this.logger.error(
        'Giro di esportazione del registro RENTRI fallito',
        error instanceof Error ? error : new Error(String(error))
      )
      segnalaErroreJob('eseguiEsportazione', error)
    } finally {
      this.inEsecuzione = false
    }
  }

  /** @returns false se almeno una fase o un registro dell'azienda ha avuto un errore. */
  private async giroAzienda(tenantId: string): Promise<boolean> {
    let pulito = true
    const errore = (fase: string, error: unknown, extra: Record<string, unknown> = {}) => {
      pulito = false
      this.logger.error(
        `Esportazione registro RENTRI: fase "${fase}" fallita, si prosegue`,
        error instanceof Error ? error : new Error(String(error)),
        { tenantId, ...extra }
      )
      segnalaErroreJob('eseguiEsportazione', error, { tenantId, fase })
    }
    // `await` dentro il contesto: le query Prisma sono lazy e partirebbero fuori dal tenant.
    const nelTenant = <R>(fn: () => PromiseLike<R>): Promise<R> =>
      TenantContext.run({ tenantId }, async () => await fn())

    try {
      if (!(await nelTenant(() => this.credenziali.haCredenziale(tenantId)))) {
        this.logger.debug(`azienda ${tenantId} senza certificato RENTRI: saltata`, { tenantId })
        return true
      }
    } catch (error: unknown) {
      errore('certificato', error)
      return false
    }

    // (1) Esiti ancora da leggere: prima, cosi' un file appena validato sblocca il successivo.
    try {
      const pendenti = await nelTenant(() =>
        this.prisma.esportazioneRegistroRentri.findMany({
          where: { tenantId, stato: { in: [...STATI_SENZA_ESITO] } },
          select: { id: true, stato: true },
          orderBy: { createdAt: 'asc' },
          take: 50,
        })
      )
      for (const p of pendenti) {
        try {
          await nelTenant(() =>
            p.stato === 'GENERATA'
              ? this.valida.valida(tenantId, p.id)
              : this.valida.rivalida(tenantId, p.id)
          )
        } catch (error: unknown) {
          errore('rivalidazione', error, { esportazioneId: p.id })
        }
      }
    } catch (error: unknown) {
      errore('elenco esportazioni senza esito', error)
    }

    // (2) Nuovi file.
    let registri: Array<{ id: string }>
    let nonConfermate: Map<string, Date>
    try {
      registri = await nelTenant(() =>
        this.prisma.registroRifiuti.findMany({
          where: {
            tenantId,
            identificativoRentri: { not: null },
            rentriChiusoIl: null,
            rentriChiusuraRichiestaIl: null,
          },
          select: { id: true },
        })
      )
      nonConfermate = await nelTenant(() =>
        this.prisma.$transaction(tx => piuVecchiaNonConfermataPerRegistro(tx, tenantId))
      )
    } catch (error: unknown) {
      errore('elenco registri', error)
      return false
    }

    const oggi = this.adesso()
    for (const registro of registri) {
      try {
        const ultima = await nelTenant(() =>
          this.prisma.esportazioneRegistroRentri.findFirst({
            where: { tenantId, registroId: registro.id, stato: { not: 'SOSTITUITA' } },
            orderBy: { createdAt: 'desc' },
            select: { stato: true },
          })
        )
        if (ultima?.stato === 'RIFIUTATA') {
          this.logger.warn(
            'Esportazione del registro RENTRI rifiutata: serve una persona (Sostituisci da qui, solo ADMIN)',
            { tenantId, registroId: registro.id }
          )
          continue
        }
        // Senza esito (o ancora da leggere): si attende, un anello alla volta.
        if (ultima && !STATI_CONFERMATI.includes(ultima.stato)) continue

        const fino = limiteEsportazioneMensile(nonConfermate.get(registro.id) ?? null, oggi)
        if (fino.getTime() < inizioMeseItaliano(oggi).getTime()) {
          // Il limite e' arretrato: annotazioni non confermate da RENTRI tengono fermo il registro.
          this.logger.warn(
            'Esportazione del registro RENTRI ferma al mese della piu vecchia annotazione non confermata',
            { tenantId, registroId: registro.id, mese: giornoItaliano(fino).slice(0, 7) }
          )
        }
        const esito = await nelTenant(() =>
          this.genera.genera(tenantId, registro.id, {
            creataDa: null,
            fino,
            richiediUltimaConfermata: true,
          })
        )
        if (esito.esito === 'CREATA') {
          this.logger.info('Registro RENTRI: esportazione mensile generata', {
            tenantId,
            registroId: registro.id,
            registrazioni: esito.esportazione.numeroRegistrazioni,
            fermata: esito.fermataA !== null,
          })
        } else if (esito.esito === 'BLOCCATA') {
          this.logger.warn('Registro RENTRI: esportazione bloccata a un numero', {
            tenantId,
            registroId: registro.id,
            anno: esito.anno,
            progressivo: esito.progressivo,
          })
        }
      } catch (error: unknown) {
        if (
          error instanceof EsportazioneRifiutataInCatenaError ||
          error instanceof CatenaEsportazioniNonCoerenteError
        ) {
          // Serve una persona (sostituzione o assistenza): un avviso al giorno, non un errore in Bugsink.
          this.logger.warn('Esportazione del registro RENTRI ferma: serve una decisione', {
            tenantId,
            registroId: registro.id,
            tipo: error.name,
          })
          continue
        }
        errore('generazione', error, { registroId: registro.id })
      }
    }
    return pulito
  }
}
