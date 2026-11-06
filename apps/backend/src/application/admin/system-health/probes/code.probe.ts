import { Injectable } from '@nestjs/common'
import type { Queue } from 'bullmq'

import { HealthItem, HealthState, formattaDurata } from '../health-item'

/**
 * Probe delle code BullMQ.
 *
 * VINCOLO CHE DECIDE QUESTA PROBE: la domanda vera su una coda non e' «quanti
 * job ci sono dentro» ma «c'e' qualcuno che li consuma». Una coda con zero
 * job in attesa sembra sanissima anche quando nessun worker e' registrato:
 * i job non si accumulano perche' nessuno li accoda, non perche' vengano
 * lavorati. Per questo la prova principale qui e' `queue.getWorkers()` —
 * i consumatori realmente connessi a Redis — e non la profondita' della coda.
 *
 * Al momento della scrittura questa distinzione NON e' teorica in questo
 * repository: `ArchiveAuditLogsJob`, `CleanupOldPermissionRequestsJob`,
 * `ExpireTempPermissionsJob` e `WarmPermissionCacheJob` sono classi
 * `@Processor` che nessun modulo registra fra i propri `providers`
 * (e `infrastructure/jobs/queues.config.ts` non e' importato da nessuna
 * parte), quindi i loro worker non esistono a runtime. La pagina lo dira' guardando Redis, non fidandosi di una lista
 * scritta a mano che potrebbe invecchiare.
 */

/** Una coda attesa in questo sistema, con la sua etichetta leggibile. */
export interface DescrittoreCoda {
  nome: string
  label: string
}

/**
 * Le code che questo sistema dichiara di avere. L'elenco serve solo a sapere
 * *cosa cercare*: lo STATO viene sempre da Redis, mai da questo elenco.
 */
export const CODE_ATTESE: DescrittoreCoda[] = [
  { nome: 'rentri-sync', label: 'Trasmissioni RENTRI' },
  { nome: 'audit-logging', label: 'Registrazione audit asincrona' },
  { nome: 'audit-archival', label: 'Archiviazione log di audit' },
  { nome: 'permission-expiration', label: 'Scadenza permessi temporanei' },
  { nome: 'permission-cleanup', label: 'Pulizia richieste di permesso' },
  { nome: 'cache-warming', label: 'Riscaldamento cache permessi' },
  { nome: 'fatturazione', label: 'Elaborazioni di fatturazione' },
]

/** Conteggi che ci interessano, nell'ordine in cui li mostriamo. */
interface ConteggiCoda {
  waiting: number
  active: number
  delayed: number
  failed: number
  completed: number
}

@Injectable()
export class CodeProbe {
  /**
   * @param code Le `Queue` risolte dal modulo (una per nome atteso). Passate
   *   dall'esterno e non create qui: aprire connessioni Redis dentro una
   *   probe la renderebbe non testabile e moltiplicherebbe i client.
   */
  async raccogli(code: Map<string, Queue>): Promise<HealthItem[]> {
    return Promise.all(CODE_ATTESE.map(descrittore => this.valutaCoda(descrittore, code)))
  }

  private async valutaCoda(
    descrittore: DescrittoreCoda,
    code: Map<string, Queue>
  ): Promise<HealthItem> {
    const key = `coda.${descrittore.nome}`
    const queue = code.get(descrittore.nome)

    if (!queue) {
      return {
        key,
        label: descrittore.label,
        state: 'unknown',
        since: null,
        detail: `Coda "${descrittore.nome}" non registrata in questo processo: stato non misurabile.`,
      }
    }

    try {
      const [conteggi, workers, ultimoCompletato] = await Promise.all([
        this.conteggi(queue),
        queue.getWorkers(),
        this.ultimoCompletatoAl(queue),
      ])

      const numeri =
        `${workers.length} consumatori, ${conteggi.waiting} in attesa, ` +
        `${conteggi.active} in corso, ${conteggi.delayed} differiti, ${conteggi.failed} falliti`

      if (workers.length === 0) {
        return {
          key,
          label: descrittore.label,
          state: 'error',
          since: ultimoCompletato?.toISOString() ?? null,
          detail:
            `Nessun consumatore connesso: i job accodati non vengono lavorati. ${numeri}. ` +
            'Il processore della coda non risulta registrato fra i provider di alcun modulo.',
        }
      }

      const state: HealthState = conteggi.failed > 0 ? 'warn' : 'ok'
      const daUltimo = ultimoCompletato
        ? `ultimo completato ${formattaDurata(Date.now() - ultimoCompletato.getTime())} fa`
        : 'nessun job completato registrato'

      return {
        key,
        label: descrittore.label,
        state,
        since: ultimoCompletato?.toISOString() ?? null,
        detail: `${numeri}; ${daUltimo}.`,
      }
    } catch (errore) {
      // Redis irraggiungibile o comando negato: `unknown`, non `error` — non
      // sappiamo nulla della coda, e dire "rotta" sarebbe inventare.
      return {
        key,
        label: descrittore.label,
        state: 'unknown',
        since: null,
        detail: `Interrogazione della coda fallita: ${(errore as Error).message}`,
      }
    }
  }

  private async conteggi(queue: Queue): Promise<ConteggiCoda> {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed')
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
    }
  }

  /**
   * Timestamp dell'ultimo job completato. `null` quando la coda non ne
   * conserva nessuno: BullMQ pota i completati, quindi l'assenza NON prova
   * che il worker non lavori — per quello guardiamo i consumatori.
   */
  private async ultimoCompletatoAl(queue: Queue): Promise<Date | null> {
    const completati = await queue.getJobs(['completed'], 0, 0, false)
    const finishedOn = completati[0]?.finishedOn
    return finishedOn ? new Date(finishedOn) : null
  }
}
