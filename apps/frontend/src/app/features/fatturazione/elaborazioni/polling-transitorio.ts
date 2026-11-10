import {
  EMPTY,
  Observable,
  catchError,
  defer,
  repeat,
  take,
  takeWhile,
  tap,
  throwError,
} from 'rxjs'

/** Errori HTTP consecutivi tollerati durante il polling prima di fermarsi. */
export const MAX_ERRORI_POLLING = 5

export interface OpzioniPolling {
  /** Attesa fra la fine di una lettura e l'inizio della successiva. */
  intervalloMs: number
  /** Errori consecutivi tollerati dopo una lettura riuscita (default `MAX_ERRORI_POLLING`). */
  maxErrori?: number
  /** Chiamata a ogni errore tollerato (la lettura si ripete al giro dopo). */
  alErrore?: (err: unknown) => void
}

/**
 * Legge con `leggi` e, finché il valore e' transitorio, rilegge dopo `intervalloMs` dalla
 * risposta (mai due richieste insieme, nessuna sottoscrizione annidata). Si ferma al primo
 * valore non transitorio (emesso comunque). Un errore prima della prima lettura riuscita, o oltre
 * `maxErrori` errori consecutivi, termina con errore; un errore transitorio in mezzo salta il giro.
 */
export function pollingTransitorio<T>(
  leggi: () => Observable<T>,
  transitorio: (v: T) => boolean,
  { intervalloMs, maxErrori = MAX_ERRORI_POLLING, alErrore }: OpzioniPolling
): Observable<T> {
  return defer(() => {
    let lettoAlmenoUnaVolta = false
    let consecutivi = 0
    return defer(leggi).pipe(
      take(1), // una risposta per giro, anche se la fonte non completa
      tap(() => {
        lettoAlmenoUnaVolta = true
        consecutivi = 0
      }),
      catchError(err => {
        consecutivi++
        if (!lettoAlmenoUnaVolta || consecutivi > maxErrori) return throwError(() => err)
        alErrore?.(err)
        return EMPTY
      }),
      repeat({ delay: intervalloMs }),
      takeWhile(transitorio, true)
    )
  })
}
