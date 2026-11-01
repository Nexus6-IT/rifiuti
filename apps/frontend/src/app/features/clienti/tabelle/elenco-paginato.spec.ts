import { fakeAsync, tick } from '@angular/core/testing'
import { Subject, of, throwError } from 'rxjs'
import { Pagina } from '../clienti.model'
import { ElencoPaginato } from './elenco-paginato'

describe('ElencoPaginato', () => {
  let fonte: jasmine.Spy
  let elenco: ElencoPaginato<string>

  beforeEach(() => {
    fonte = jasmine.createSpy('fonte').and.returnValue(of({ elementi: ['a'], totale: 1 }))
    elenco = new ElencoPaginato<string>(fonte, 'Impossibile caricare.')
  })
  afterEach(() => elenco.ferma())

  it('avvia: un solo caricamento, pagina 1 e dimensione 25, senza testo', () => {
    elenco.avvia()
    expect(fonte).toHaveBeenCalledOnceWith({ pagina: 1, dimensione: 25 })
    expect(elenco.righe()).toEqual(['a'])
    expect(elenco.totale()).toBe(1)
    expect(elenco.caricamento()).toBeFalse()
  })

  it('ricerca con debounce e distinctUntilChanged: una sola chiamata, di nuovo a pagina 1', fakeAsync(() => {
    elenco.avvia()
    elenco.cambiaPagina({ first: 25, rows: 25 })
    fonte.calls.reset()
    elenco.cerca('ro')
    elenco.cerca('ros')
    elenco.cerca(' ross ')
    tick(100)
    expect(fonte).not.toHaveBeenCalled()
    tick(300)
    expect(fonte).toHaveBeenCalledOnceWith({ pagina: 1, dimensione: 25, testo: 'ross' })
    // lo stesso testo di nuovo: nessuna chiamata
    elenco.cerca('ross')
    tick(400)
    expect(fonte).toHaveBeenCalledTimes(1)
  }))

  it('cambiaPagina: pagina e dimensione dal paginator', () => {
    elenco.avvia()
    fonte.calls.reset()
    fonte.and.returnValue(of({ elementi: ['x'], totale: 60 }))
    elenco.cambiaPagina({ first: 50, rows: 25 })
    expect(fonte).toHaveBeenCalledOnceWith({ pagina: 3, dimensione: 25 })
    expect(elenco.totale()).toBe(60)
  })

  it('una risposta in ritardo non sovrascrive quella attuale', () => {
    elenco.avvia()
    const vecchia = new Subject<Pagina<string>>()
    const nuova = new Subject<Pagina<string>>()
    fonte.and.returnValues(vecchia, nuova)
    elenco.carica()
    elenco.carica()
    nuova.next({ elementi: ['NUOVO'], totale: 1 })
    vecchia.next({ elementi: ['VECCHIO'], totale: 1 })
    expect(elenco.righe()).toEqual(['NUOVO'])
  })

  it('caricamento vero finché la risposta non arriva', () => {
    elenco.avvia()
    const r = new Subject<Pagina<string>>()
    fonte.and.returnValue(r)
    elenco.carica()
    expect(elenco.caricamento()).toBeTrue()
    r.next({ elementi: [], totale: 0 })
    expect(elenco.caricamento()).toBeFalse()
  })

  it('errore: messaggio del backend o ripiego, caricamento finito', () => {
    elenco.avvia()
    fonte.and.returnValue(throwError(() => ({ error: { message: 'Servizio non disponibile.' } })))
    elenco.carica()
    expect(elenco.errore()).toBe('Servizio non disponibile.')
    fonte.and.returnValue(throwError(() => ({})))
    elenco.carica()
    expect(elenco.errore()).toBe('Impossibile caricare.')
    expect(elenco.caricamento()).toBeFalse()
  })

  it("eliminata l'ultima riga dell'ultima pagina torna alla pagina precedente", () => {
    elenco.avvia()
    elenco.cambiaPagina({ first: 50, rows: 25 })
    fonte.calls.reset()
    // pagina 3 ora vuota, ma il totale (50) dice che l'ultima è la 2
    fonte.and.returnValues(of({ elementi: [], totale: 50 }), of({ elementi: ['p2'], totale: 50 }))
    elenco.carica()
    expect(fonte.calls.allArgs().map(a => a[0].pagina)).toEqual([3, 2])
    expect(elenco.primo).toBe(25)
    expect(elenco.righe()).toEqual(['p2'])
  })

  it('elenco davvero vuoto: nessun ciclo', () => {
    fonte.and.returnValue(of({ elementi: [], totale: 0 }))
    elenco.avvia()
    expect(fonte).toHaveBeenCalledTimes(1)
  })

  it('ferma annulla la lettura in corso e la ricerca', fakeAsync(() => {
    elenco.avvia()
    const r = new Subject<Pagina<string>>()
    fonte.and.returnValue(r)
    elenco.carica()
    elenco.cerca('x')
    elenco.ferma()
    r.next({ elementi: ['TARDI'], totale: 1 })
    tick(400)
    expect(elenco.righe()).toEqual(['a'])
    expect(fonte).toHaveBeenCalledTimes(2)
  }))
})
