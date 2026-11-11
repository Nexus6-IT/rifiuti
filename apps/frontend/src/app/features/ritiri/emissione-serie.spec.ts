import { Observable, Subject, of, throwError } from 'rxjs'
import {
  AvanzamentoEmissione,
  classificaErroreEmissione,
  emettiInSerie,
  MESSAGGIO_FIRMA_MANCANTE,
  MESSAGGIO_SERVER,
  RigaEmissione,
} from './emissione-serie'

const righe = (n: number): RigaEmissione[] =>
  Array.from({ length: n }, (_, i) => ({ ritiroId: `r${i}`, firId: `f${i}`, esito: null }))
const http = (status: number, codice?: string, message?: string) => ({
  status,
  error: { error: codice, message },
})

function esegui(
  r: RigaEmissione[],
  emetti: (id: string) => Observable<unknown>,
  interrotto: () => boolean = () => false
): AvanzamentoEmissione[] {
  const eventi: AvanzamentoEmissione[] = []
  emettiInSerie(r, emetti, interrotto).subscribe(e => eventi.push(e))
  return eventi
}

describe('emettiInSerie', () => {
  it('emette tutte le righe nell’ordine dato, una alla volta', () => {
    const chiamate: string[] = []
    const eventi = esegui(righe(3), id => {
      chiamate.push(id)
      return of({})
    })
    expect(chiamate).toEqual(['f0', 'f1', 'f2'])
    expect(eventi.map(e => e.riga.esito)).toEqual(['EMESSO', 'EMESSO', 'EMESSO'])
    expect(eventi.some(e => e.ferma)).toBeFalse()
  })

  it('409 FIR_NON_PIU_IN_BOZZA: vale come già emesso e il ciclo continua', () => {
    const eventi = esegui(righe(2), id =>
      id === 'f0' ? throwError(() => http(409, 'FIR_NON_PIU_IN_BOZZA')) : of({})
    )
    expect(eventi.map(e => e.riga.esito)).toEqual(['GIA_EMESSO', 'EMESSO'])
  })

  it('409 FIR_ANNULLATO_NEL_FRATTEMPO e FIR_MODIFICATO_NEL_FRATTEMPO sono errori di riga, mai «già emesso»; si continua', () => {
    const eventi = esegui(righe(3), id =>
      id === 'f0'
        ? throwError(() => http(409, 'FIR_ANNULLATO_NEL_FRATTEMPO'))
        : id === 'f1'
          ? throwError(() => http(409, 'FIR_MODIFICATO_NEL_FRATTEMPO'))
          : of({})
    )
    expect(eventi.map(e => e.riga.esito)).toEqual(['ERRORE', 'ERRORE', 'EMESSO'])
    expect(eventi[0].riga.messaggio).toBe('Il FIR è stato annullato nel frattempo.')
    expect(eventi[1].riga.messaggio).toContain('modificato da un altro utente')
  })

  it('un 409 senza codice noto non vale come già emesso', () => {
    expect(classificaErroreEmissione(http(409)).esito).toBe('ERRORE')
  })

  it('mancanza di firma o certificato: si ferma alla prima, con il messaggio chiaro, senza tentare le altre', () => {
    const chiamate: string[] = []
    const eventi = esegui(righe(4), id => {
      chiamate.push(id)
      return id === 'f1'
        ? throwError(() =>
            http(400, 'FIRMA_NON_RIUSCITA', 'Firma produttore non riuscita: certificato assente')
          )
        : of({})
    })
    expect(chiamate).toEqual(['f0', 'f1'])
    expect(eventi[1]).toEqual(
      jasmine.objectContaining({
        ferma: true,
        riga: jasmine.objectContaining({ messaggio: MESSAGGIO_FIRMA_MANCANTE }),
      })
    )
    // il testo tecnico del backend non arriva all'utente
    expect(eventi[1].riga.messaggio).not.toContain('assente')
  })

  it('il testo del messaggio non decide nulla: «certificato» in un 400 senza codice non ferma il ciclo', () => {
    const chiamate: string[] = []
    esegui(righe(2), id => {
      chiamate.push(id)
      return throwError(() => http(400, undefined, 'Firma non riuscita, certificato scaduto'))
    })
    expect(chiamate).toEqual(['f0', 'f1'])
  })

  it('interruzione: la richiesta in volo arriva al suo esito, le successive non partono', () => {
    const chiamate: string[] = []
    const volo = new Subject<unknown>()
    let stop = false
    const eventi = esegui(
      righe(3),
      id => {
        chiamate.push(id)
        return volo
      },
      () => stop
    )
    expect(chiamate).toEqual(['f0'])
    stop = true
    volo.next({})
    volo.complete()
    expect(chiamate).toEqual(['f0'])
    expect(eventi.map(e => e.riga.esito)).toEqual(['EMESSO'])
  })

  it('errore 5xx o rete assente: si ferma', () => {
    for (const stato of [500, 503, 0]) {
      const chiamate: string[] = []
      const eventi = esegui(righe(3), id => {
        chiamate.push(id)
        return throwError(() => http(stato))
      })
      expect(chiamate).toEqual(['f0'])
      expect(eventi[0].ferma).toBeTrue()
      expect(eventi[0].riga.messaggio).toBe(MESSAGGIO_SERVER)
    }
  })

  it('401 e 403 fermano il ciclo; un 400 qualunque o un 404 sono errore di quella riga e si continua', () => {
    expect(classificaErroreEmissione(http(401)).ferma).toBeTrue()
    expect(classificaErroreEmissione(http(403)).ferma).toBeTrue()
    const eventi = esegui(righe(3), id =>
      id === 'f0'
        ? throwError(() => http(400, undefined, 'Failed to emit FIR: il FIR 123 non è valido'))
        : id === 'f1'
          ? throwError(() => http(404, undefined, 'FIR not found: x'))
          : of({})
    )
    expect(eventi.map(e => e.riga.esito)).toEqual(['ERRORE', 'ERRORE', 'EMESSO'])
    // mai il testo grezzo del backend (inglese, con id)
    expect(eventi[0].riga.messaggio).toBe('Il FIR non si può emettere.')
    expect(eventi[1].riga.messaggio).toBe('FIR non trovato.')
  })
})
