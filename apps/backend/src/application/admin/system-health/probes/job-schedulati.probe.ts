import { Injectable } from '@nestjs/common'
import { CronExpression } from '@nestjs/schedule'

import { HealthItem, formattaDurata, valutaRitardo } from '../health-item'

/**
 * Probe dei job schedulati (`@Cron`).
 *
 * DUE DOMANDE DISTINTE, ENTRAMBE NECESSARIE:
 *  1. il job e' davvero REGISTRATO nello scheduler di questo processo? Un
 *     `@Cron` su una classe che nessun modulo dichiara fra i `providers` non
 *     viene mai istanziato: il metodo esiste nel sorgente e non parte mai.
 *  2. ha prodotto un EFFETTO OSSERVABILE di recente? Registrato non vuol dire
 *     funzionante.
 *
 * L'identita' del job nel registro passa per la sua espressione cron:
 * `@nestjs/schedule` assegna alle `@Cron` senza `name` un UUID casuale
 * (v. `scheduler.orchestrator.js`), quindi il nome NON e' un identificatore
 * utilizzabile. L'espressione lo e', a patto di contare quante ne servono
 * quando piu' job condividono la stessa cadenza (il caso del refresh mensile:
 * seeder dati di riferimento + allineamento codifiche RENTRI).
 */

const MINUTO = 60_000
const ORA = 60 * MINUTO
const GIORNO = 24 * ORA

/** Un job cron effettivamente presente nello scheduler di questo processo. */
export interface CronRegistrato {
  espressione: string
  prossima: Date | null
  ultima: Date | null
}

/** Chiavi delle evidenze in banca dati che sappiamo leggere. */
export type ChiaveEvidenza =
  | 'riconciliazione-rentri'
  | 'codifiche-rentri'
  | 'dati-riferimento'
  | 'notifiche'

/** Fonte delle evidenze: implementata su Prisma, sostituibile nei test. */
export interface LettoreEvidenze {
  ultimoEffetto(chiave: ChiaveEvidenza): Promise<Date | null>
}

export interface DescrittoreJobSchedulato {
  key: string
  label: string
  espressioneCron: string
  cadenzaAttesaMs: number
  /** Effetto osservabile in banca dati, quando ne esiste uno interrogabile. */
  evidenza?: { chiave: ChiaveEvidenza; descrizione: string }
  /**
   * `false` per i job registrati il cui corpo e' ancora un segnaposto: girano
   * ma non producono nulla. Dichiararli `ok` sarebbe falso, `error` ingiusto:
   * lo stato giusto e' `off`.
   */
  implementato?: boolean
  /** Presente solo per i job realmente rilanciabili a mano (v. JobActionsService). */
  actionKey?: string
  /** Perche' l'assenza di evidenza recente non e' di per se' un guasto. */
  nota?: string
}

export const JOB_SCHEDULATI: DescrittoreJobSchedulato[] = [
  {
    key: 'job.rentri-riconciliazione',
    label: 'Riconciliazione periodica RENTRI',
    espressioneCron: CronExpression.EVERY_6_HOURS,
    cadenzaAttesaMs: 6 * ORA,
    evidenza: {
      chiave: 'riconciliazione-rentri',
      descrizione: 'ultima riconciliazione registrata',
    },
    actionKey: 'rentri-riconciliazione',
  },
  {
    key: 'job.rentri-certificato-scadenza',
    label: 'Controllo scadenza certificati RENTRI',
    espressioneCron: CronExpression.EVERY_DAY_AT_3AM,
    cadenzaAttesaMs: GIORNO,
    actionKey: 'rentri-certificato-scadenza',
    nota:
      "L'unico effetto del job e' l'aggiornamento del gauge Prometheus " +
      'wasteflow_rentri_certificate_expiry_days: non lascia traccia in banca dati, ' +
      "quindi l'esecuzione non e' verificabile da qui.",
  },
  {
    key: 'job.scadenzario-mud',
    label: 'Scadenzario MUD',
    espressioneCron: CronExpression.EVERY_DAY_AT_8AM,
    cadenzaAttesaMs: GIORNO,
    nota:
      'Il job invia notifiche solo a 30/15/7/3/1 giorni dalla scadenza del 30 aprile: ' +
      "negli altri giorni non produce nulla, quindi l'assenza di notifiche recenti non e' un guasto.",
  },
  {
    key: 'job.scadenzario-vidimazioni',
    label: 'Scadenzario vidimazioni registri',
    espressioneCron: CronExpression.EVERY_DAY_AT_9AM,
    cadenzaAttesaMs: GIORNO,
    implementato: false,
  },
  {
    key: 'job.scadenzario-autorizzazioni',
    label: 'Scadenzario autorizzazioni impianti',
    espressioneCron: CronExpression.EVERY_DAY_AT_10AM,
    cadenzaAttesaMs: GIORNO,
    implementato: false,
  },
  {
    key: 'job.notifiche-escalation',
    label: 'Escalation notifiche non lette',
    espressioneCron: CronExpression.EVERY_2_HOURS,
    cadenzaAttesaMs: 2 * ORA,
    nota:
      'Il job agisce solo sulle notifiche non lette oltre soglia: non avere nulla da scalare ' +
      "non e' un guasto.",
  },
  {
    key: 'job.pulizia-notifiche',
    label: 'Pulizia notifiche lette',
    espressioneCron: CronExpression.EVERY_WEEK,
    cadenzaAttesaMs: 7 * GIORNO,
    evidenza: { chiave: 'notifiche', descrizione: 'ultima notifica registrata' },
    nota: "La cancellazione non lascia traccia: l'evidenza mostrata e' la vitalita' del dominio.",
  },
  {
    key: 'job.codifiche-rentri',
    label: 'Allineamento codifiche RENTRI',
    espressioneCron: CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT,
    cadenzaAttesaMs: 31 * GIORNO,
    evidenza: { chiave: 'codifiche-rentri', descrizione: 'ultimo allineamento codifiche' },
    actionKey: 'codifiche-rentri',
  },
  {
    key: 'job.dati-riferimento',
    label: 'Refresh dati di riferimento (CER, ATECO, ISTAT)',
    espressioneCron: CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT,
    cadenzaAttesaMs: 31 * GIORNO,
    evidenza: { chiave: 'dati-riferimento', descrizione: 'ultimo aggiornamento catalogo CER' },
    actionKey: 'dati-riferimento',
  },
]

@Injectable()
export class JobSchedulatiProbe {
  async raccogli(cron: CronRegistrato[], evidenze: LettoreEvidenze): Promise<HealthItem[]> {
    const disponibili = this.conteggiaPerEspressione(cron)

    return Promise.all(
      JOB_SCHEDULATI.map(descrittore => this.valuta(descrittore, cron, disponibili, evidenze))
    )
  }

  private conteggiaPerEspressione(cron: CronRegistrato[]): Map<string, number> {
    const conteggi = new Map<string, number>()
    for (const registrato of cron) {
      conteggi.set(registrato.espressione, (conteggi.get(registrato.espressione) ?? 0) + 1)
    }
    return conteggi
  }

  private async valuta(
    descrittore: DescrittoreJobSchedulato,
    cron: CronRegistrato[],
    disponibili: Map<string, number>,
    evidenze: LettoreEvidenze
  ): Promise<HealthItem> {
    const attesiConStessaCadenza = JOB_SCHEDULATI.filter(
      j => j.espressioneCron === descrittore.espressioneCron
    ).length
    const registratiConStessaCadenza = disponibili.get(descrittore.espressioneCron) ?? 0

    const base = {
      key: descrittore.key,
      label: descrittore.label,
      actionable: Boolean(descrittore.actionKey),
      actionKey: descrittore.actionKey ?? null,
    }

    if (registratiConStessaCadenza < attesiConStessaCadenza) {
      return {
        ...base,
        // Non rilanciabile a mano se non e' nemmeno cablato: il pulsante
        // fallirebbe allo stesso modo, e offrirlo suggerirebbe un rimedio
        // che non esiste.
        actionable: false,
        actionKey: null,
        state: 'error',
        since: null,
        detail:
          `Non registrato nello scheduler: attesi ${attesiConStessaCadenza} job con cadenza ` +
          `"${descrittore.espressioneCron}", trovati ${registratiConStessaCadenza}. ` +
          'Non partira mai finche la classe non e fra i provider di un modulo.',
      }
    }

    const prossima = this.prossimaEsecuzione(cron, descrittore.espressioneCron)
    const codaProssima = prossima
      ? ` Prossima esecuzione fra ${formattaDurata(prossima.getTime() - Date.now())}.`
      : ''

    if (descrittore.implementato === false) {
      return {
        ...base,
        actionable: false,
        actionKey: null,
        state: 'off',
        since: null,
        detail: `Registrato ma non implementato: il corpo del job non produce alcun effetto.${codaProssima}`,
      }
    }

    if (!descrittore.evidenza) {
      return {
        ...base,
        state: 'unknown',
        since: null,
        detail: `Registrato nello scheduler.${codaProssima} ${descrittore.nota ?? ''}`.trim(),
      }
    }

    const ultimo = await evidenze.ultimoEffetto(descrittore.evidenza.chiave)
    const esito = valutaRitardo({
      ultimo,
      cadenzaAttesaMs: descrittore.cadenzaAttesaMs,
      descrizioneEvento: descrittore.evidenza.descrizione,
    })

    return {
      ...base,
      state: esito.state,
      since: esito.since,
      detail: `${esito.detail}${codaProssima}${descrittore.nota ? ` ${descrittore.nota}` : ''}`,
    }
  }

  private prossimaEsecuzione(cron: CronRegistrato[], espressione: string): Date | null {
    const candidati = cron
      .filter(c => c.espressione === espressione && c.prossima)
      .map(c => c.prossima as Date)
      .sort((a, b) => a.getTime() - b.getTime())
    return candidati[0] ?? null
  }
}
