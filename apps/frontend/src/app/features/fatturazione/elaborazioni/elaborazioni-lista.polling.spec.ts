import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Router } from '@angular/router'
import { Subject, defer, finalize, of, throwError } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { ClientiService } from '../../clienti/clienti.service'
import { ElaborazioneRiga, Pagina } from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import { MAX_ERRORI_POLLING } from './polling-transitorio'
import { ElaborazioniListaComponent } from './elaborazioni-lista.component'

const riga = (n: number, stato: ElaborazioneRiga['stato']): ElaborazioneRiga => ({
  id: `e${n}`,
  stato,
  createdAt: '2026-11-03T09:30:00.000Z',
  periodoDal: '2026-10-01',
  periodoAl: '2026-10-31',
  dataDocumento: '2026-11-03',
  documenti: 1,
  totale: '10.00',
  errori: 0,
  avvisi: 0,
})
const pagina = (elementi: ElaborazioneRiga[]): Pagina<ElaborazioneRiga> => ({
  elementi,
  totale: elementi.length,
  pagina: 1,
  dimensione: 50,
})

describe('ElaborazioniListaComponent: aggiornamento degli stati transitori', () => {
  let fixture: ComponentFixture<ElaborazioniListaComponent>
  let lista: jasmine.Spy

  beforeEach(async () => {
    lista = jasmine.createSpy('lista')
    await TestBed.configureTestingModule({
      imports: [ElaborazioniListaComponent],
      providers: [
        provideNoopAnimations(),
        { provide: FatturazioneService, useValue: { lista } },
        { provide: Router, useValue: jasmine.createSpyObj('Router', ['navigate']) },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
        {
          provide: ClientiService,
          useValue: {
            clienti: { list: () => of({ elementi: [], totale: 0 }) },
            contratti: { list: () => of({ elementi: [], totale: 0 }) },
          },
        },
      ],
    }).compileComponents()
  })

  const crea = (): void => {
    fixture = TestBed.createComponent(ElaborazioniListaComponent)
    fixture.detectChanges()
  }

  it('rilegge ogni 3 s finché una riga è IN_CODA, IN_CORSO o IN_DEFINITIVA, poi si ferma', fakeAsync(() => {
    lista.and.returnValues(
      of(pagina([riga(1, 'IN_CODA')])),
      of(pagina([riga(1, 'IN_CORSO')])),
      of(pagina([riga(1, 'IN_DEFINITIVA')])),
      of(pagina([riga(1, 'DEFINITIVA')]))
    )
    crea()
    expect(lista).toHaveBeenCalledTimes(1)
    tick(3000)
    expect(lista).toHaveBeenCalledTimes(2)
    tick(3000)
    expect(lista).toHaveBeenCalledTimes(3)
    tick(3000)
    expect(lista).toHaveBeenCalledTimes(4)
    expect(fixture.componentInstance.righe()[0].stato).toBe('DEFINITIVA')
    tick(30000)
    expect(lista).toHaveBeenCalledTimes(4)
    fixture.destroy()
  }))

  it('senza stati transitori non rilegge', fakeAsync(() => {
    lista.and.returnValue(of(pagina([riga(1, 'ANTEPRIMA_PRONTA'), riga(2, 'FALLITA')])))
    crea()
    tick(30000)
    expect(lista).toHaveBeenCalledTimes(1)
    fixture.destroy()
  }))

  it('nessuna richiesta sovrapposta e fermo alla distruzione della pagina', fakeAsync(() => {
    const pendente = new Subject<Pagina<ElaborazioneRiga>>()
    lista.and.returnValues(of(pagina([riga(1, 'IN_CORSO')])), pendente)
    crea()
    tick(3000)
    expect(lista).toHaveBeenCalledTimes(2)
    tick(30000)
    expect(lista).toHaveBeenCalledTimes(2)
    expect(pendente.observed).toBeTrue()
    fixture.destroy()
    expect(pendente.observed).toBeFalse()
    tick(30000)
    expect(lista).toHaveBeenCalledTimes(2)
  }))

  it('errore HTTP transitorio durante l’aggiornamento: messaggio, riprova al giro dopo e si ripulisce', fakeAsync(() => {
    lista.and.returnValues(
      of(pagina([riga(1, 'IN_CORSO')])),
      throwError(() => ({ status: 500, error: {} })),
      of(pagina([riga(1, 'DEFINITIVA')]))
    )
    crea()
    tick(3000)
    expect(fixture.componentInstance.errore()).toContain('Impossibile caricare')
    tick(3000)
    expect(lista).toHaveBeenCalledTimes(3)
    expect(fixture.componentInstance.errore()).toBeNull()
    expect(fixture.componentInstance.righe()[0].stato).toBe('DEFINITIVA')
    tick(30000)
    expect(lista).toHaveBeenCalledTimes(3)
    fixture.destroy()
  }))

  it('errori consecutivi oltre il tetto: il giro si ferma col messaggio', fakeAsync(() => {
    lista.and.returnValues(of(pagina([riga(1, 'IN_CORSO')])))
    lista.and.callFake(
      (() => {
        let n = 0
        return () =>
          n++ === 0
            ? of(pagina([riga(1, 'IN_CORSO')]))
            : throwError(() => ({ status: 503, error: {} }))
      })()
    )
    crea()
    tick(3000 * MAX_ERRORI_POLLING + 30000)
    expect(lista).toHaveBeenCalledTimes(2 + MAX_ERRORI_POLLING)
    expect(fixture.componentInstance.errore()).toContain('Impossibile caricare')
    fixture.destroy()
  }))

  it('errore alla prima lettura: messaggio e nessun giro', fakeAsync(() => {
    lista.and.returnValue(throwError(() => ({ status: 500, error: {} })))
    crea()
    tick(30000)
    expect(lista).toHaveBeenCalledTimes(1)
    expect(fixture.componentInstance.errore()).toContain('Impossibile caricare')
    fixture.destroy()
  }))

  it('nessuna crescita delle sottoscrizioni: una sola sottoscrizione attiva alla fonte per giro', fakeAsync(() => {
    let attive = 0
    let massimo = 0
    lista.and.callFake(() =>
      defer(() => {
        attive++
        massimo = Math.max(massimo, attive)
        return of(pagina([riga(1, 'IN_CORSO')]))
      }).pipe(finalize(() => attive--))
    )
    crea()
    tick(3000 * 20)
    expect(lista.calls.count()).toBe(21)
    expect(massimo).toBe(1)
    fixture.destroy()
    expect(attive).toBe(0)
  }))

  it('cambio pagina durante il giro: parte un giro nuovo, la risposta tardiva del vecchio non conta', fakeAsync(() => {
    const vecchia = new Subject<Pagina<ElaborazioneRiga>>()
    lista.and.returnValues(vecchia, of(pagina([riga(9, 'DEFINITIVA')])))
    crea()
    fixture.componentInstance.cambiaPagina({ page: 1 })
    expect(vecchia.observed).toBeFalse()
    vecchia.next(pagina([riga(1, 'IN_CORSO')]))
    expect(fixture.componentInstance.righe()[0].id).toBe('e9')
    fixture.destroy()
    tick(1000)
  }))
})
