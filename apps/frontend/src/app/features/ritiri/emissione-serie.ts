/**
 * Emissione in serie dei FIR dai ritiri (4.7, T17; P7 §3.3): il frontend chiama UNA ALLA VOLTA, nell'ordine
 * della lista, la rotta esistente `POST /fir/:id/emetti` (nessun codice nuovo lato server).
 *
 * - 200: emesso.
 * - 409 `FIR_NON_PIU_IN_BOZZA`: vale come già emesso (annullato o modificato nel frattempo: errore di riga).
 * - Firma non riuscita (`FIRMA_NON_RIUSCITA`), errore del server (5xx), rete assente, sessione scaduta o
 *   permesso negato: il ciclo SI FERMA su quella riga, i restanti non vengono tentati.
 * - Un altro rifiuto del singolo FIR (es. FIR non trovato): errore di quella riga, si continua.
 */
import { EMPTY, Observable, catchError, concatMap, defer, from, map, of, takeWhile } from 'rxjs'

export type EsitoEmissione = 'EMESSO' | 'GIA_EMESSO' | 'ERRORE'

export interface RigaEmissione {
  ritiroId: string
  firId: string
  /** `null` finché la riga non è stata tentata. */
  esito: EsitoEmissione | null
  messaggio?: string
}

export interface AvanzamentoEmissione {
  indice: number
  riga: RigaEmissione
  /** Vero se il ciclo si ferma su questa riga: le successive non verranno tentate. */
  ferma: boolean
}

export const MESSAGGIO_FIRMA_MANCANTE =
  'Firma non riuscita: controlla il certificato di firma dell’azienda. I FIR restanti sono ancora in bozza.'
export const MESSAGGIO_SERVER =
  'Il server non ha risposto come previsto. I FIR restanti non sono stati emessi: riprova più tardi.'
export const MESSAGGIO_SESSIONE =
  'Non è più possibile emettere con questo accesso. I FIR restanti non sono stati emessi.'

interface ErroreHttp {
  status?: number
  error?: { error?: string }
}

/** Codici macchina del backend (`error` nel corpo dell'errore): mai il testo del messaggio. */
export const CODICE_NON_PIU_IN_BOZZA = 'FIR_NON_PIU_IN_BOZZA'
export const CODICE_ANNULLATO = 'FIR_ANNULLATO_NEL_FRATTEMPO'
export const CODICE_MODIFICATO = 'FIR_MODIFICATO_NEL_FRATTEMPO'
export const CODICE_FIRMA_NON_RIUSCITA = 'FIRMA_NON_RIUSCITA'

/**
 * Classifica l'errore di una singola emissione dal codice del backend. I messaggi mostrati sono
 * fissi e senza id. 409 `FIR_NON_PIU_IN_BOZZA` = già emesso; annullato o modificato nel frattempo
 * sono errori della riga (non «già emesso»); `FIRMA_NON_RIUSCITA` ferma il ciclo.
 */
export function classificaErroreEmissione(errore: unknown): {
  esito: EsitoEmissione
  messaggio?: string
  ferma: boolean
} {
  const err = (errore ?? null) as ErroreHttp | null
  const stato = err?.status ?? 0
  const codice = err?.error?.error
  if (stato === 409 && codice === CODICE_NON_PIU_IN_BOZZA) {
    return { esito: 'GIA_EMESSO', ferma: false }
  }
  if (stato === 409 && codice === CODICE_ANNULLATO) {
    return { esito: 'ERRORE', messaggio: 'Il FIR è stato annullato nel frattempo.', ferma: false }
  }
  if (stato === 409 && codice === CODICE_MODIFICATO) {
    return {
      esito: 'ERRORE',
      messaggio: 'Il FIR è stato modificato da un altro utente: ricarica l’elenco e riprova.',
      ferma: false,
    }
  }
  if (stato === 401 || stato === 403) {
    return { esito: 'ERRORE', messaggio: MESSAGGIO_SESSIONE, ferma: true }
  }
  if (stato === 0 || stato >= 500) {
    return { esito: 'ERRORE', messaggio: MESSAGGIO_SERVER, ferma: true }
  }
  if (stato === 400 && codice === CODICE_FIRMA_NON_RIUSCITA) {
    return { esito: 'ERRORE', messaggio: MESSAGGIO_FIRMA_MANCANTE, ferma: true }
  }
  return {
    esito: 'ERRORE',
    messaggio: stato === 404 ? 'FIR non trovato.' : 'Il FIR non si può emettere.',
    ferma: false,
  }
}

/**
 * Emette i FIR in sequenza. Emette un evento per riga tentata; dopo la riga che ferma il ciclo,
 * si completa senza toccare le successive.
 */
export function emettiInSerie(
  righe: readonly RigaEmissione[],
  emetti: (firId: string) => Observable<unknown>,
  interrotto: () => boolean = () => false
): Observable<AvanzamentoEmissione> {
  return from(righe).pipe(
    // `interrotto` si controlla PRIMA di ogni riga: la richiesta già partita non si annulla (il server
    // la completa comunque) e arriva al suo esito; dopo, il ciclo si completa senza altre chiamate.
    concatMap((riga, indice) =>
      defer(() => (interrotto() ? EMPTY : emetti(riga.firId))).pipe(
        map(
          (): AvanzamentoEmissione => ({
            indice,
            riga: { ...riga, esito: 'EMESSO' },
            ferma: false,
          })
        ),
        catchError(err => {
          const c = classificaErroreEmissione(err)
          return of<AvanzamentoEmissione>({
            indice,
            riga: { ...riga, esito: c.esito, messaggio: c.messaggio },
            ferma: c.ferma,
          })
        })
      )
    ),
    takeWhile(a => !a.ferma, true)
  )
}
