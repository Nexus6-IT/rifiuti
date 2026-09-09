import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { RentriRiconciliazioneJob } from '../../../infrastructure/jobs/rentri-riconciliazione.job'
import { RentriCertificatoScadenzaJob } from '../../../infrastructure/jobs/rentri-certificato-scadenza.job'
import { RentriCodificheSyncService } from '../../reference-data/rentri-codifiche-sync.service'
import { ReferenceDataSeederService } from '../../reference-data/reference-data-seeder.service'

/**
 * Rilancio manuale dei job dalla pagina «Stato del sistema».
 *
 * TRE REGOLE CHE DECIDONO QUESTO SERVIZIO:
 *
 * 1. **Solo cio' che e' davvero rilanciabile.** Una chiave qui esiste solo se
 *    corrisponde a un metodo pubblico, idempotente, che fa esattamente cio'
 *    che farebbe il cron. Le voci non azionabili della pagina non hanno
 *    pulsante: mai un bottone che finge di poter fare qualcosa.
 *
 * 2. **Risponde AVVIATO, non ESEGUITO.** Alcuni di questi giri durano minuti
 *    (riconciliazione su tutte le aziende, allineamento codifiche): tenere
 *    aperta la richiesta HTTP fino alla fine significherebbe un timeout del
 *    proxy scambiato per un fallimento del job. La chiamata risponde 202 e
 *    l'esito si legge nell'audit e, al giro dopo, nella pagina stessa.
 *
 * 3. **Un giro alla volta per chiave.** Due click ravvicinati non devono
 *    lanciare due riconciliazioni parallele sugli stessi dati: la seconda
 *    riceve 409. Il lucchetto e' in memoria di processo — abbastanza per il
 *    doppio click, che e' il caso reale; con piu' repliche del backend resta
 *    la protezione propria dei job che ne hanno una (l'allineamento codifiche
 *    ha il suo lucchetto interno e risponde comunque «gia' in corso»).
 */

export interface EsitoAvvioJob {
  jobKey: string
  stato: 'avviato'
  messaggio: string
  avviatoAl: string
}

export interface EventoAuditJob {
  jobKey: string
  esito: string
  descrizione: string
  utente: string | null
  al: string
}

export interface UtenteAzione {
  id: string
  email: string
  tenantId: string
}

/** Azione registrata su `ActivityLog`: un solo valore, per poterla ritrovare. */
export const AZIONE_AUDIT = 'SYSTEM_HEALTH_JOB_RUN'

@Injectable()
export class JobActionsService {
  private readonly logger = new Logger(JobActionsService.name)
  private readonly inCorso = new Set<string>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly riconciliazione: RentriRiconciliazioneJob,
    private readonly certificati: RentriCertificatoScadenzaJob,
    private readonly codifiche: RentriCodificheSyncService,
    private readonly datiRiferimento: ReferenceDataSeederService
  ) {}

  /** Le chiavi rilanciabili, con la descrizione mostrata nell'audit. */
  private get azioni(): Record<string, { descrizione: string; esegui: () => Promise<void> }> {
    return {
      'rentri-riconciliazione': {
        descrizione: 'Riconciliazione periodica RENTRI',
        esegui: () => this.riconciliazione.eseguiRiconciliazione(),
      },
      'rentri-certificato-scadenza': {
        descrizione: 'Controllo scadenza certificati RENTRI',
        esegui: () => this.certificati.eseguiControlloScadenza(),
      },
      'codifiche-rentri': {
        descrizione: 'Allineamento codifiche RENTRI',
        esegui: () => this.codifiche.allineaTutto(),
      },
      'dati-riferimento': {
        descrizione: 'Refresh dei dati di riferimento',
        esegui: () => this.datiRiferimento.reseedAll(),
      },
    }
  }

  /** Chiavi note: usata dal controller e dai test per restare allineati. */
  chiaviDisponibili(): string[] {
    return Object.keys(this.azioni)
  }

  async avvia(jobKey: string, utente: UtenteAzione): Promise<EsitoAvvioJob> {
    const azione = this.azioni[jobKey]
    if (!azione) {
      throw new BadRequestException(
        `Job "${jobKey}" non rilanciabile a mano. Rilanciabili: ${this.chiaviDisponibili().join(', ')}.`
      )
    }

    if (this.inCorso.has(jobKey)) {
      throw new ConflictException(`Il job "${jobKey}" e' gia' in corso: attendere che finisca.`)
    }

    this.inCorso.add(jobKey)
    const avviatoAl = new Date()

    await this.registra(utente, jobKey, 'avviato', `${azione.descrizione}: avvio manuale`)

    // Deliberatamente NON atteso: v. regola 2 nell'intestazione. L'esito
    // finisce nell'audit, mai in un errore non gestito che abbatterebbe il
    // processo.
    void azione
      .esegui()
      .then(() => this.registra(utente, jobKey, 'completato', `${azione.descrizione}: completato`))
      .catch((errore: Error) => {
        this.logger.error(`Rilancio manuale di "${jobKey}" fallito`, errore)
        return this.registra(
          utente,
          jobKey,
          'fallito',
          `${azione.descrizione}: fallito — ${errore.message}`
        )
      })
      .finally(() => this.inCorso.delete(jobKey))

    return {
      jobKey,
      stato: 'avviato',
      messaggio: `${azione.descrizione}: avviato. L'esito comparira' nello storico.`,
      avviatoAl: avviatoAl.toISOString(),
    }
  }

  /** Storico dei rilanci manuali: chi, quando, quale job, con quale esito. */
  async storico(limite = 50): Promise<EventoAuditJob[]> {
    const righe = await this.prisma.activityLog.findMany({
      where: { action: AZIONE_AUDIT },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limite, 1), 200),
      select: {
        createdAt: true,
        description: true,
        metadata: true,
        user: { select: { email: true } },
      },
    })

    return righe.map(riga => {
      const metadata = (riga.metadata ?? {}) as { jobKey?: string; esito?: string }
      return {
        jobKey: metadata.jobKey ?? 'sconosciuto',
        esito: metadata.esito ?? 'sconosciuto',
        descrizione: riga.description,
        utente: riga.user?.email ?? null,
        al: riga.createdAt.toISOString(),
      }
    })
  }

  /**
   * L'audit riusa `ActivityLog` invece di introdurre una tabella dedicata:
   * e' gia' il registro di «chi ha fatto cosa» di questo sistema, ha gia' la
   * ritenzione e l'archiviazione previste, e una seconda tabella con lo
   * stesso scopo avrebbe diviso in due la risposta alla stessa domanda.
   *
   * La scrittura dell'audit non deve MAI far fallire l'avvio del job: un
   * registro che non riesce a scrivere e' un problema, ma trasformarlo in un
   * 500 impedirebbe l'operazione che l'operatore stava tentando proprio
   * mentre qualcosa non va.
   */
  private async registra(
    utente: UtenteAzione,
    jobKey: string,
    esito: string,
    descrizione: string
  ): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          tenantId: utente.tenantId,
          userId: utente.id,
          action: AZIONE_AUDIT,
          description: descrizione,
          metadata: { jobKey, esito, utente: utente.email },
        },
      })
    } catch (errore) {
      this.logger.error(`Audit del rilancio manuale di "${jobKey}" non registrato`, errore as Error)
    }
  }
}
