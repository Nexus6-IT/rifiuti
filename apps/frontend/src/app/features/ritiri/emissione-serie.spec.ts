import { Observable, of, throwError } from 'rxjs'
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
const http = (status: number, message?: string) => ({ status, error: { message } })

function esegui(
  r: RigaEmissione[],
  emetti: (id: string) => Observable<unknown>
): AvanzamentoEmissione[] {
  const eventi: AvanzamentoEmissione[] = []
  emettiInSerie(r, emetti).subscribe(e => eventi.push(e))
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

  it('409: vale come già emesso e il ciclo continua', () => {
    const eventi = esegui(righe(2), id => (id === 'f0' ? throwError(() => http(409)) : of({})))
    expect(eventi.map(e => e.riga.esito)).toEqual(['GIA_EMESSO', 'EMESSO'])
  })

  it('mancanza di firma o certificato: si ferma alla prima, con il messaggio chiaro, senza tentare le altre', () => {
    const chiamate: string[] = []
    const eventi = esegui(righe(4), id => {
      chiamate.push(id)
      return id === 'f1'
        ? throwError(() => http(400, 'Firma produttore non riuscita: certificato assente'))
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
        ? throwError(() => http(400, 'Il FIR non è in bozza'))
        : id === 'f1'
          ? throwError(() => http(404, 'FIR not found: x'))
          : of({})
    )
    expect(eventi.map(e => e.riga.esito)).toEqual(['ERRORE', 'ERRORE', 'EMESSO'])
    expect(eventi[0].riga.messaggio).toBe('Il FIR non è in bozza')
    expect(eventi[1].riga.messaggio).toBe('FIR non trovato.')
  })
})
