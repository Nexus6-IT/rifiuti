import { Injectable } from '@nestjs/common'

import { HealthItem } from '../health-item'
import { RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI } from '../../../rentri/get-rentri-diagnostica.use-case'

/**
 * Probe delle credenziali con scadenza.
 *
 * Le soglie sono IMPORTATE da `get-rentri-diagnostica.use-case.ts`, non
 * riscritte: la pagina «Diagnostica RENTRI» e questa pagina mostrano la
 * stessa credenziale allo stesso operatore. Due soglie diverse (anche di un
 * solo giorno) renderebbero una delle due pagine bugiarda, e non ci sarebbe
 * modo di sapere quale.
 */
export interface StatoCredenziale {
  key: string
  label: string
  /** Giorni alla scadenza; `null` se il certificato non e' analizzabile. */
  giorniAllaScadenza: number | null
  /** Data di scadenza, quando calcolabile. */
  scadenzaAl: Date | null
  /** `false` quando il tenant non ha (ancora) caricato la credenziale. */
  presente: boolean
}

/** Gravita' crescente: serve a scegliere lo stato peggiore in un riepilogo. */
const GRAVITA: Record<string, number> = { ok: 0, info: 0, off: 1, unknown: 2, warn: 3, error: 4 }

@Injectable()
export class CredenzialiProbe {
  raccogli(credenziali: StatoCredenziale[]): HealthItem[] {
    return credenziali.map(credenziale => this.valuta(credenziale))
  }

  /**
   * Riepilogo di tutte le credenziali della piattaforma in UNA riga.
   *
   * La pagina e' di sistema, non di azienda: elencare un certificato per
   * ciascun tenant la trasformerebbe in un registro di dati altrui (e la
   * renderebbe illeggibile appena i tenant sono decine). Il riepilogo dice
   * quanti sono e quanti stanno male — lo stato mostrato e' il PEGGIORE
   * trovato, perche' un solo certificato scaduto e' gia' un problema da
   * vedere subito, e una media lo nasconderebbe.
   */
  riepilogo(credenziali: StatoCredenziale[]): HealthItem {
    const base = { key: 'credenziali.rentri', label: 'Certificati RENTRI delle aziende' }

    if (credenziali.length === 0) {
      return {
        ...base,
        state: 'off',
        since: null,
        detail: 'Nessuna azienda attiva ha caricato una credenziale RENTRI.',
      }
    }

    const valutate = credenziali.map(c => this.valuta(c))
    const conta = (stato: string) => valutate.filter(v => v.state === stato).length
    const peggiore = valutate.reduce((a, b) => (GRAVITA[b.state] > GRAVITA[a.state] ? b : a))

    const dettaglio =
      `${credenziali.length} credenziali: ${conta('ok')} valide, ${conta('warn')} in scadenza ` +
      `entro 30 giorni, ${conta('error')} scadute o entro 7 giorni, ` +
      `${conta('unknown')} non analizzabili, ${conta('off')} non caricate.`

    return {
      ...base,
      state: peggiore.state,
      since: peggiore.since,
      detail: dettaglio,
    }
  }

  private valuta(credenziale: StatoCredenziale): HealthItem {
    const base = { key: `credenziali.${credenziale.key}`, label: credenziale.label }

    if (!credenziale.presente) {
      return {
        ...base,
        state: 'off',
        since: null,
        detail:
          'Nessuna credenziale caricata per questa azienda: la trasmissione telematica non e attiva.',
      }
    }

    if (credenziale.giorniAllaScadenza === null) {
      return {
        ...base,
        state: 'unknown',
        since: null,
        detail:
          'Certificato presente ma non analizzabile (campo notAfter non leggibile): scadenza non calcolabile.',
      }
    }

    const giorni = credenziale.giorniAllaScadenza
    const since = credenziale.scadenzaAl?.toISOString() ?? null

    if (giorni < 0) {
      return {
        ...base,
        state: 'error',
        since,
        detail: `Certificato SCADUTO da ${Math.abs(giorni)} giorni.`,
      }
    }

    if (giorni <= RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_7) {
      return {
        ...base,
        state: 'error',
        since,
        detail: `Certificato in scadenza fra ${giorni} giorni: azione richiesta.`,
      }
    }

    if (giorni <= RENTRI_DIAGNOSTICA_SOGLIE_AVVISO_GIORNI.AVVISO_30) {
      return {
        ...base,
        state: 'warn',
        since,
        detail: `Certificato in scadenza fra ${giorni} giorni.`,
      }
    }

    return { ...base, state: 'ok', since, detail: `Certificato valido per altri ${giorni} giorni.` }
  }
}
