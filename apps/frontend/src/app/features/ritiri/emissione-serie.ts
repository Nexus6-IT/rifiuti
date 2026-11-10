/**
 * Emissione in serie dei FIR dai ritiri (4.7, T17; P7 §3.3): il frontend chiama UNA ALLA VOLTA, nell'ordine
 * della lista, la rotta esistente `POST /fir/:id/emetti` (nessun codice nuovo lato server).
 *
 * - 200: emesso.
 * - 409: il FIR non è più in bozza, vale come già emesso.
 * - Mancanza di firma o di certificato, errore del server (5xx), rete assente, sessione scaduta o
 *   permesso negato: il ciclo SI FERMA su quella riga, i restanti non vengono tentati.
 * - Un altro rifiuto del singolo FIR (es. FIR non trovato): errore di quella riga, si continua.
 */
import { Observable, catchError, concatMap, from, map, of, takeWhile } from 'rxjs'

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
  error?: { message?: string | string[] }
}

function testoMessaggio(err: ErroreHttp | null): string {
  const m = err?.error?.message
  return Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : ''
}

/** Classifica l'errore di una singola emissione; la mancanza di firma («Firma … non riuscita») si riconosce dal testo del backend. */
export function classificaErroreEmissione(errore: unknown): {
  esito: EsitoEmissione
  messaggio?: string
  ferma: boolean
} {
  const err = (errore ?? null) as ErroreHttp | null
  const stato = err?.status ?? 0
  if (stato === 409) return { esito: 'GIA_EMESSO', ferma: false }
  if (stato === 401 || stato === 403) {
    return { esito: 'ERRORE', messaggio: MESSAGGIO_SESSIONE, ferma: true }
  }
  if (stato === 0 || stato >= 500) {
    return { esito: 'ERRORE', messaggio: MESSAGGIO_SERVER, ferma: true }
  }
  const testo = testoMessaggio(err)
  if (/firma[^:]*non riuscita|certificat/i.test(testo)) {
    return { esito: 'ERRORE', messaggio: MESSAGGIO_FIRMA_MANCANTE, ferma: true }
  }
  return {
    esito: 'ERRORE',
    messaggio: stato === 404 ? 'FIR non trovato.' : testo || 'Il FIR non si può emettere.',
    ferma: false,
  }
}

/**
 * Emette i FIR in sequenza. Emette un evento per riga tentata; dopo la riga che ferma il ciclo,
 * si completa senza toccare le successive.
 */
export function emettiInSerie(
  righe: readonly RigaEmissione[],
  emetti: (firId: string) => Observable<unknown>
): Observable<AvanzamentoEmissione> {
  return from(righe).pipe(
    concatMap((riga, indice) =>
      emetti(riga.firId).pipe(
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
