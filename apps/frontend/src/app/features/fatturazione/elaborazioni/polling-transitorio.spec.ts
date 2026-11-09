import { fakeAsync, tick } from '@angular/core/testing'
import { Observable, of, throwError } from 'rxjs'
import { MAX_ERRORI_POLLING, pollingTransitorio } from './polling-transitorio'

describe('pollingTransitorio: tetto degli errori consecutivi', () => {
  const INTERVALLO = 1000

  /** Prima lettura riuscita (transitoria), poi `errori` errori, poi un valore finale. */
  function fonte(errori: number): { leggi: () => Observable<string>; chiamate: () => number } {
    let n = 0
    return {
      leggi: () => {
        const i = n++
        if (i === 0) return of('IN_CORSO')
        if (i <= errori) return throwError(() => new Error('503'))
        return of('FINITO')
      },
      chiamate: () => n,
    }
  }

  it('tollera esattamente MAX_ERRORI_POLLING errori consecutivi e poi legge il valore finale', fakeAsync(() => {
    const f = fonte(MAX_ERRORI_POLLING)
    const valori: string[] = []
    let errore: unknown = null
    pollingTransitorio(f.leggi, v => v === 'IN_CORSO', { intervalloMs: INTERVALLO }).subscribe({
      next: v => valori.push(v),
      error: e => (errore = e),
    })
    tick(INTERVALLO * (MAX_ERRORI_POLLING + 5))
    expect(errore).toBeNull()
    expect(valori).toEqual(['IN_CORSO', 'FINITO'])
  }))

  it('il (MAX_ERRORI_POLLING + 1)-esimo errore consecutivo termina con errore', fakeAsync(() => {
    const f = fonte(MAX_ERRORI_POLLING + 1)
    let errore: unknown = null
    pollingTransitorio(f.leggi, v => v === 'IN_CORSO', { intervalloMs: INTERVALLO }).subscribe({
      error: e => (errore = e),
    })
    tick(INTERVALLO * (MAX_ERRORI_POLLING + 10))
    expect(errore).toBeTruthy()
    expect(f.chiamate()).toBe(MAX_ERRORI_POLLING + 2)
  }))
})
