import { Inject, Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { HttpService } from '@nestjs/axios'
import { SchedulerRegistry } from '@nestjs/schedule'
import { firstValueFrom } from 'rxjs'
import type { Queue } from 'bullmq'

import { HealthItem, SystemHealth } from './health-item'
import { EvidenzeDbService } from './evidenze-db.service'
import { CodeProbe } from './probes/code.probe'
import { CronRegistrato, JobSchedulatiProbe } from './probes/job-schedulati.probe'
import { InfrastrutturaProbe, ControlloInfrastruttura } from './probes/infrastruttura.probe'
import { FreschezzaProbe } from './probes/freschezza.probe'
import { CredenzialiProbe } from './probes/credenziali.probe'
import { FlagProbe } from './probes/flag.probe'
import { EmailService } from '../../../infrastructure/email/email.service'

/** Token del dizionario delle code, popolato dal modulo (v. modulo). */
export const CODE_SYSTEM_HEALTH = 'CODE_SYSTEM_HEALTH'

/**
 * Durata della cache in memoria della pagina.
 *
 * La pagina contatta cinque dipendenze esterne e interroga Redis: aprirla in
 * due schede, o tenerla aperta con un aggiornamento nervoso, non deve
 * moltiplicare quel costo. 60 secondi sono abbastanza per non pesare e
 * abbastanza poco perche' un guasto appena risolto si veda quasi subito —
 * e la risposta dichiara sempre se e' cache e di che eta', cosi' chi guarda
 * sa cosa sta guardando.
 */
export const DURATA_CACHE_MS = 60_000

@Injectable()
export class SystemHealthService {
  private readonly logger = new Logger(SystemHealthService.name)
  private cache: { valore: SystemHealth; generataAl: number } | null = null

  constructor(
    private readonly evidenze: EvidenzeDbService,
    private readonly scheduler: SchedulerRegistry,
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly email: EmailService,
    private readonly codeProbe: CodeProbe,
    private readonly jobProbe: JobSchedulatiProbe,
    private readonly infraProbe: InfrastrutturaProbe,
    private readonly freschezzaProbe: FreschezzaProbe,
    private readonly credenzialiProbe: CredenzialiProbe,
    private readonly flagProbe: FlagProbe,
    @Inject(CODE_SYSTEM_HEALTH) private readonly code: Map<string, Queue>
  ) {}

  async stato(): Promise<SystemHealth> {
    const adesso = Date.now()
    if (this.cache && adesso - this.cache.generataAl < DURATA_CACHE_MS) {
      return {
        ...this.cache.valore,
        cached: true,
        cacheAgeSeconds: Math.round((adesso - this.cache.generataAl) / 1000),
      }
    }

    const valore = await this.raccogli()
    this.cache = { valore, generataAl: Date.now() }
    return valore
  }

  /** Invalida la cache: usata dopo un trigger manuale, il cui effetto va visto. */
  invalidaCache(): void {
    this.cache = null
  }

  private async raccogli(): Promise<SystemHealth> {
    // Le sezioni sono indipendenti: una probe che fallisce non deve svuotare
    // la pagina. `allSettled` + `sezioneNonRaccolta` garantiscono che il
    // fallimento diventi una riga `unknown` visibile, non una pagina bianca
    // ne' un silenzio scambiabile per «tutto bene».
    const [infrastructure, queues, scheduledJobs, freshness, credentials] = await Promise.all([
      this.protetta('Infrastruttura', () => this.infraProbe.raccogli(this.controlli())),
      this.protetta('Code', () => this.codeProbe.raccogli(this.code)),
      this.protetta('Job schedulati', () =>
        this.jobProbe.raccogli(this.cronRegistrati(), this.evidenze)
      ),
      this.protetta('Freschezza', async () =>
        this.freschezzaProbe.raccogli(await this.evidenze.freschezza())
      ),
      this.protetta('Credenziali', async () => [
        this.credenzialiProbe.riepilogo(await this.evidenze.credenziali()),
      ]),
    ])

    return {
      generatedAt: new Date().toISOString(),
      cached: false,
      cacheAgeSeconds: 0,
      infrastructure,
      queues,
      scheduledJobs,
      freshness,
      credentials,
      flags: this.flagProbe.raccogli(),
    }
  }

  private async protetta(
    sezione: string,
    raccolta: () => Promise<HealthItem[]> | HealthItem[]
  ): Promise<HealthItem[]> {
    try {
      return await raccolta()
    } catch (errore) {
      this.logger.error(`Raccolta della sezione "${sezione}" fallita`, errore as Error)
      return [
        {
          key: `sezione.${sezione.toLowerCase().replace(/\s+/g, '-')}`,
          label: sezione,
          state: 'unknown',
          since: null,
          detail: `Sezione non raccolta: ${(errore as Error).message}`,
        },
      ]
    }
  }

  /** I controlli infrastrutturali, ciascuno con un contatto reale. */
  private controlli(): ControlloInfrastruttura[] {
    const keycloakUrl = this.config.get<string>('KEYCLOAK_URL')
    const realm = this.config.get<string>('KEYCLOAK_REALM')

    return [
      {
        key: 'postgres',
        label: 'Banca dati PostgreSQL',
        configurato: true,
        verifica: () => this.evidenze.verificaConnessione(),
      },
      {
        key: 'numerazione-fatturazione',
        label: 'Numerazione delle fatture senza buchi',
        configurato: true,
        verifica: () => this.evidenze.verificaNumerazioneFatturazione(),
      },
      {
        key: 'catalogo-causali',
        label: 'Catalogo causali del registro',
        configurato: true,
        verifica: () => this.evidenze.verificaCatalogoCausali(),
      },
      {
        key: 'redis',
        label: 'Redis (cache e code)',
        configurato: this.code.size > 0,
        motivoNonConfigurato:
          'Nessuna coda registrata in questo processo: Redis non interrogabile.',
        verifica: () => this.verificaRedis(),
      },
      {
        key: 'smtp',
        label: 'Invio email (SMTP)',
        configurato: !this.email.modalitaSviluppo,
        motivoNonConfigurato:
          'Modalita sviluppo: le email non vengono spedite, vengono scritte nel log.',
        verifica: () => this.email.verificaConnessione(),
      },
      {
        key: 'keycloak',
        label: 'Keycloak (identita)',
        configurato: Boolean(keycloakUrl && realm),
        motivoNonConfigurato: 'KEYCLOAK_URL/KEYCLOAK_REALM non impostate in questo ambiente.',
        verifica: () => this.verificaKeycloak(keycloakUrl as string, realm as string),
      },
    ]
  }

  /**
   * Ping su una connessione GIA' aperta da una coda, non su un client nuovo:
   * apre zero connessioni ed e' esattamente il Redis che le code usano —
   * un client creato apposta potrebbe puntare altrove e dire «tutto bene»
   * mentre le code sono cieche (nel repository convivono due convenzioni di
   * configurazione Redis, `REDIS_CLUSTER_NODES` e `REDIS_HOST`/`REDIS_PORT`).
   */
  private async verificaRedis(): Promise<string> {
    const [primaCoda] = [...this.code.values()]
    if (!primaCoda) throw new Error('nessuna coda disponibile per il ping')

    const client = await primaCoda.client
    const risposta = await client.ping()
    return `PING su Redis: ${risposta}`
  }

  /**
   * Documento di discovery OIDC del realm: raggiungibile senza credenziali,
   * quindi il controllo prova la reperibilita' dell'IdP senza mai spendere
   * (ne' rischiare di invalidare) un segreto.
   */
  private async verificaKeycloak(baseUrl: string, realm: string): Promise<string> {
    const url = `${baseUrl}/realms/${realm}/.well-known/openid-configuration`
    const risposta = await firstValueFrom(this.http.get(url, { timeout: 4_000 }))
    return `realm "${realm}" raggiungibile (HTTP ${risposta.status})`
  }

  /**
   * Fotografia dei cron REALMENTE registrati in questo processo. I nomi sono
   * UUID casuali (v. `JobSchedulatiProbe`), quindi si conserva l'espressione
   * — l'unico identificatore stabile disponibile.
   */
  private cronRegistrati(): CronRegistrato[] {
    const registrati: CronRegistrato[] = []

    for (const job of this.scheduler.getCronJobs().values()) {
      registrati.push({
        espressione: this.espressioneDi(job),
        prossima: this.aData(() => (job as { nextDate?: () => unknown }).nextDate?.()),
        ultima: this.aData(() => (job as { lastDate?: () => unknown }).lastDate?.()),
      })
    }

    return registrati
  }

  private espressioneDi(job: unknown): string {
    const sorgente = (job as { cronTime?: { source?: unknown } }).cronTime?.source
    return typeof sorgente === 'string' ? sorgente : String(sorgente ?? '')
  }

  /**
   * `nextDate()`/`lastDate()` restituiscono un `DateTime` di luxon o una
   * `Date` a seconda della versione della libreria `cron`: si normalizza qui
   * una volta sola, e un valore non interpretabile diventa `null` (la pagina
   * mostrera' semplicemente una riga senza «prossima esecuzione») invece di
   * far fallire l'intera sezione.
   */
  private aData(leggi: () => unknown): Date | null {
    try {
      const valore = leggi()
      if (!valore) return null
      if (valore instanceof Date) return valore
      const conConversione = valore as { toJSDate?: () => Date }
      if (typeof conConversione.toJSDate === 'function') return conConversione.toJSDate()
      const data = new Date(String(valore))
      return Number.isNaN(data.getTime()) ? null : data
    } catch {
      return null
    }
  }
}
