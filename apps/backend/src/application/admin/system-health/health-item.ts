/**
 * Vocabolario condiviso della pagina «Stato del sistema».
 *
 * VINCOLO CHE DECIDE QUESTO FILE: ogni riga della pagina deve dichiarare
 * *cosa* si sta guardando, *come sta*, *da quando* e **la prova** — numeri,
 * non aggettivi. Da qui i due campi `since` e `detail` accanto a `state`:
 * uno stato senza prova non e' verificabile da chi legge, e una pagina di
 * salute non verificabile e' peggio di nessuna pagina (rassicura senza
 * motivo).
 *
 * Lo stato `unknown` esiste ed e' DELIBERATAMENTE distinto da `ok`: un
 * pallino verde che in realta' significa «non lo so» e' esattamente il
 * difetto che questa pagina esiste per evitare. Quando un dato non e'
 * misurabile con quello che il sistema registra davvero, la riga lo dice.
 */

export type HealthState = 'ok' | 'warn' | 'error' | 'off' | 'info' | 'unknown'

export interface HealthItem {
  /** Identificatore stabile della voce (usato anche come chiave azione). */
  key: string
  /** Etichetta leggibile, in italiano (la UI non traduce: v. frontend). */
  label: string
  state: HealthState
  /** Timestamp ISO dell'ultimo evento noto. `null` quando non misurabile. */
  since: string | null
  /** Prova testuale dello stato dichiarato: numeri, non aggettivi. */
  detail: string
  /**
   * True SOLO per le voci dietro a un job realmente rilanciabile a mano.
   * Le voci non azionabili non mostrano alcun pulsante nel frontend — mai un
   * bottone disabilitato senza spiegazione.
   */
  actionable?: boolean
  /** Chiave da passare all'endpoint di accodamento quando `actionable`. */
  actionKey?: string | null
}

/** Sezioni della pagina. Una sezione per domanda che l'operatore si pone. */
export interface SystemHealth {
  generatedAt: string
  /** True se la risposta viene dalla cache in-process. */
  cached: boolean
  cacheAgeSeconds: number
  /** Postgres, Redis, SMTP, Keycloak. */
  infrastructure: HealthItem[]
  /** Code BullMQ: profondita', falliti e — soprattutto — consumatori vivi. */
  queues: HealthItem[]
  /** Job schedulati: registrati davvero nello scheduler + ultimo effetto in DB. */
  scheduledJobs: HealthItem[]
  /** Freschezza dei dati prodotti dal sistema. */
  freshness: HealthItem[]
  /** Credenziali con scadenza (certificato RENTRI del tenant chiamante). */
  credentials: HealthItem[]
  /** Flag di modalita' attivi/spenti in questo ambiente. */
  flags: HealthItem[]
}

const MS_PER_SECONDO = 1000
const MS_PER_MINUTO = 60 * MS_PER_SECONDO
const MS_PER_ORA = 60 * MS_PER_MINUTO
const MS_PER_GIORNO = 24 * MS_PER_ORA

/**
 * Tolleranza sul ritardo di un job rispetto alla sua cadenza attesa.
 *
 * Un job non e' in ritardo appena supera la cadenza: una cadenza di 6 ore
 * significa «ogni ~6 ore», e un'esecuzione partita con qualche minuto di
 * scarto e' normale. `warn` oltre 1,5 volte la cadenza (una corsa saltata e'
 * plausibile), `error` oltre 3 volte (due corse saltate di fila non sono
 * piu' un caso). Numeri espliciti qui invece che sparsi nelle probe: se un
 * giorno vanno cambiati, si cambiano in un punto solo.
 */
export const SOGLIA_RITARDO_WARN = 1.5
export const SOGLIA_RITARDO_ERROR = 3

/** Formatta una durata in italiano, con la granularita' che serve a capire. */
export function formattaDurata(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'n/d'
  if (ms < MS_PER_MINUTO) return `${Math.round(ms / MS_PER_SECONDO)} s`
  if (ms < MS_PER_ORA) return `${Math.round(ms / MS_PER_MINUTO)} min`
  if (ms < MS_PER_GIORNO) {
    const ore = Math.floor(ms / MS_PER_ORA)
    const minuti = Math.round((ms % MS_PER_ORA) / MS_PER_MINUTO)
    return minuti > 0 ? `${ore} h ${minuti} min` : `${ore} h`
  }
  const giorni = Math.floor(ms / MS_PER_GIORNO)
  const ore = Math.round((ms % MS_PER_GIORNO) / MS_PER_ORA)
  return ore > 0 ? `${giorni} g ${ore} h` : `${giorni} g`
}

export interface EsitoRitardo {
  state: HealthState
  since: string | null
  /** Ritardo rispetto all'ultimo evento noto, `null` se non misurabile. */
  ritardoMs: number | null
  /** Prova pronta da mostrare: «ultimo ... fa, cadenza attesa ...». */
  detail: string
}

/**
 * Valuta la freschezza di un evento rispetto alla cadenza con cui dovrebbe
 * ripetersi. `ultimo === null` NON e' un guasto e non e' un successo: e'
 * `unknown` — non abbiamo modo di sapere se il job e' mai girato, e dirlo e'
 * l'unica risposta onesta.
 */
export function valutaRitardo(params: {
  ultimo: Date | null
  cadenzaAttesaMs: number
  adesso?: Date
  /** Cosa e' l'evento misurato, per la frase di prova (es. «ultima riconciliazione»). */
  descrizioneEvento?: string
}): EsitoRitardo {
  const { ultimo, cadenzaAttesaMs } = params
  const adesso = params.adesso ?? new Date()
  const evento = params.descrizioneEvento ?? 'ultimo evento'
  const cadenza = formattaDurata(cadenzaAttesaMs)

  if (!ultimo) {
    return {
      state: 'unknown',
      since: null,
      ritardoMs: null,
      detail: `Nessun ${evento} registrato: non misurabile (cadenza attesa ${cadenza}).`,
    }
  }

  const ritardoMs = adesso.getTime() - ultimo.getTime()
  const trascorso = formattaDurata(Math.max(ritardoMs, 0))
  const detail = `${evento} ${trascorso} fa (cadenza attesa ${cadenza}).`

  if (ritardoMs > cadenzaAttesaMs * SOGLIA_RITARDO_ERROR) {
    return { state: 'error', since: ultimo.toISOString(), ritardoMs, detail }
  }
  if (ritardoMs > cadenzaAttesaMs * SOGLIA_RITARDO_WARN) {
    return { state: 'warn', since: ultimo.toISOString(), ritardoMs, detail }
  }
  return { state: 'ok', since: ultimo.toISOString(), ritardoMs, detail }
}
