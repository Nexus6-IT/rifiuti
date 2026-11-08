import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http'
import { TestBed } from '@angular/core/testing'
import { MessageService } from 'primeng/api'
import { throwError } from 'rxjs'
import { errorInterceptor } from './error.interceptor'

describe('errorInterceptor', () => {
  let messageService: jasmine.SpyObj<MessageService>

  beforeEach(() => {
    messageService = jasmine.createSpyObj<MessageService>('MessageService', ['add'])
    TestBed.configureTestingModule({
      providers: [{ provide: MessageService, useValue: messageService }],
    })
  })

  function esegui(error: HttpErrorResponse): HttpErrorResponse | undefined {
    let rilanciato: HttpErrorResponse | undefined
    TestBed.runInInjectionContext(() => {
      const interceptor: HttpInterceptorFn = errorInterceptor
      interceptor(new HttpRequest('GET', '/x'), () => throwError(() => error)).subscribe({
        error: (e: HttpErrorResponse) => (rilanciato = e),
      })
    })
    return rilanciato
  }

  function ultimo() {
    return messageService.add.calls.mostRecent().args[0]
  }

  it('500: titolo «Errore» e dettaglio in italiano', () => {
    const errore = new HttpErrorResponse({ status: 500 })
    expect(esegui(errore)).toBe(errore)

    expect(ultimo().severity).toBe('error')
    expect(ultimo().summary).toBe('Errore')
    expect(ultimo().detail).toBe('Errore del server. Riprova più tardi.')
  })

  it('409: titolo «Attenzione» e dettaglio in italiano', () => {
    esegui(new HttpErrorResponse({ status: 409 }))

    expect(ultimo().severity).toBe('warn')
    expect(ultimo().summary).toBe('Attenzione')
    expect(ultimo().detail).toBe('Conflitto: la risorsa potrebbe essere stata modificata.')
  })

  const attesi: Array<[number, string]> = [
    [400, 'Richiesta non valida. Controlla i dati inseriti.'],
    [401, 'Autenticazione richiesta. Accedi di nuovo.'],
    [403, 'Non hai il permesso di eseguire questa azione.'],
    [404, 'La risorsa richiesta non è stata trovata.'],
    [422, 'Validazione non riuscita. Controlla i dati inseriti.'],
    [429, 'Troppe richieste. Riprova più tardi.'],
    [503, 'Servizio temporaneamente non disponibile. Riprova più tardi.'],
    [0, 'Si è verificato un errore imprevisto.'],
  ]
  attesi.forEach(([status, testo]) => {
    it(`${status}: dettaglio «${testo}»`, () => {
      esegui(new HttpErrorResponse({ status }))
      expect(ultimo().detail).toBe(testo)
    })
  })

  it('un messaggio del server (400) ha la precedenza sul testo predefinito', () => {
    esegui(new HttpErrorResponse({ status: 400, error: { message: 'Codice CER non valido' } }))

    expect(ultimo().detail).toBe('Codice CER non valido')
  })

  it('un errore lato client dice «Errore del client» e non «Client Error»', () => {
    esegui(
      new HttpErrorResponse({ status: 0, error: new ErrorEvent('rete', { message: 'offline' }) })
    )

    expect(ultimo().detail).toBe('Errore del client: offline')
  })
})
