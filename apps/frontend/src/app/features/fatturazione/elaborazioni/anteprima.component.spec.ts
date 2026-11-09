import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router'
import { Subject, defer, finalize, of, throwError } from 'rxjs'
import { AuthService } from '../../../core/services/auth.service'
import { ElaborazioneDettaglio } from '../fatturazione.model'
import { FatturazioneService } from '../fatturazione.service'
import {
  AnteprimaComponent,
  INTERVALLO_AGGIORNAMENTO_MS,
  MSG_NON_CARICATA,
} from './anteprima.component'
import { MAX_ERRORI_POLLING } from './polling-transitorio'
import { dettaglio, documentoRiga, paginaDocumenti } from './anteprima.fixture'

describe('AnteprimaComponent', () => {
  let fixture: ComponentFixture<AnteprimaComponent>
  let comp: AnteprimaComponent
  let servizio: jasmine.SpyObj<FatturazioneService>

  beforeEach(async () => {
    servizio = jasmine.createSpyObj('FatturazioneService', [
      'dettaglio',
      'documentiElaborazione',
      'ricalcola',
      'scarta',
      'definitiva',
      'escludi',
      'riammetti',
      'documento',
      'scaricaPdf',
    ])
    servizio.documentiElaborazione.and.returnValue(of(paginaDocumenti([documentoRiga(1)])))
    await TestBed.configureTestingModule({
      imports: [AnteprimaComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: FatturazioneService, useValue: servizio },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 'e1' }) } },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
      ],
    }).compileComponents()
  })

  const crea = (): void => {
    fixture = TestBed.createComponent(AnteprimaComponent)
    comp = fixture.componentInstance
    fixture.detectChanges()
  }

  const stato = (s: ElaborazioneDettaglio['stato'], v = 1): ElaborazioneDettaglio =>
    dettaglio({ stato: s, versione: v })

  describe('aggiornamento periodico', () => {
    it('rilegge ogni 3 s finché è IN_CODA/IN_CORSO e si ferma a ANTEPRIMA_PRONTA', fakeAsync(() => {
      servizio.dettaglio.and.returnValues(
        of(stato('IN_CODA')),
        of(stato('IN_CORSO')),
        of(stato('ANTEPRIMA_PRONTA', 2))
      )
      crea()
      expect(servizio.dettaglio).toHaveBeenCalledTimes(1)
      tick(INTERVALLO_AGGIORNAMENTO_MS - 1)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(1)
      tick(1)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(2)
      tick(INTERVALLO_AGGIORNAMENTO_MS)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(3)
      expect(comp.dettaglio()?.stato).toBe('ANTEPRIMA_PRONTA')
      tick(INTERVALLO_AGGIORNAMENTO_MS * 5)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(3)
      fixture.destroy()
    }))

    it('IN_DEFINITIVA continua a rileggere fino a DEFINITIVA', fakeAsync(() => {
      servizio.dettaglio.and.returnValues(of(stato('IN_DEFINITIVA')), of(stato('DEFINITIVA', 4)))
      crea()
      tick(INTERVALLO_AGGIORNAMENTO_MS)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(2)
      tick(INTERVALLO_AGGIORNAMENTO_MS * 3)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(2)
      expect(comp.dettaglio()?.stato).toBe('DEFINITIVA')
      fixture.destroy()
    }))

    it('nessuna richiesta sovrapposta: la successiva parte 3 s DOPO la risposta', fakeAsync(() => {
      const prima = new Subject<ElaborazioneDettaglio>()
      servizio.dettaglio.and.returnValues(prima as never, of(stato('ANTEPRIMA_PRONTA')))
      crea()
      tick(INTERVALLO_AGGIORNAMENTO_MS * 4)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(1)
      prima.next(stato('IN_CORSO'))
      tick(INTERVALLO_AGGIORNAMENTO_MS - 1)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(1)
      tick(1)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(2)
      fixture.destroy()
    }))

    it('alla distruzione della pagina il giro si ferma (e la GET pendente è annullata)', fakeAsync(() => {
      const pendente = new Subject<ElaborazioneDettaglio>()
      servizio.dettaglio.and.returnValues(of(stato('IN_CORSO')), pendente as never)
      crea()
      tick(INTERVALLO_AGGIORNAMENTO_MS)
      expect(pendente.observed).toBeTrue()
      fixture.destroy()
      expect(pendente.observed).toBeFalse()
      tick(INTERVALLO_AGGIORNAMENTO_MS * 5)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(2)
    }))

    it('distrutta fra due letture: il timer non parte', fakeAsync(() => {
      servizio.dettaglio.and.returnValue(of(stato('IN_CORSO')))
      crea()
      fixture.destroy()
      tick(INTERVALLO_AGGIORNAMENTO_MS * 5)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(1)
    }))

    it('errore HTTP transitorio durante l’aggiornamento: messaggio, riprova al giro dopo e si ripulisce', fakeAsync(() => {
      servizio.dettaglio.and.returnValues(
        of(stato('IN_CORSO')),
        throwError(() => ({ status: 500, error: { message: 'boom' } })),
        of(stato('ANTEPRIMA_PRONTA', 2))
      )
      crea()
      tick(INTERVALLO_AGGIORNAMENTO_MS)
      expect(comp.errore()).toBe(MSG_NON_CARICATA)
      tick(INTERVALLO_AGGIORNAMENTO_MS)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(3)
      expect(comp.errore()).toBeNull()
      tick(INTERVALLO_AGGIORNAMENTO_MS * 5)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(3)
      fixture.destroy()
    }))

    it('errori consecutivi oltre il tetto: il giro si ferma col messaggio', fakeAsync(() => {
      let n = 0
      servizio.dettaglio.and.callFake(() =>
        n++ === 0 ? of(stato('IN_CORSO')) : throwError(() => ({ status: 503, error: {} }))
      )
      crea()
      tick(INTERVALLO_AGGIORNAMENTO_MS * (MAX_ERRORI_POLLING + 10))
      expect(servizio.dettaglio).toHaveBeenCalledTimes(1 + MAX_ERRORI_POLLING)
      expect(comp.errore()).toBe(MSG_NON_CARICATA)
      fixture.destroy()
    }))

    it('errore alla prima lettura: messaggio e nessun giro', fakeAsync(() => {
      servizio.dettaglio.and.returnValue(throwError(() => ({ status: 500, error: {} })))
      crea()
      tick(INTERVALLO_AGGIORNAMENTO_MS * 5)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(1)
      expect(comp.errore()).toBe(MSG_NON_CARICATA)
      fixture.destroy()
    }))

    it('nessuna crescita delle sottoscrizioni durante il giro', fakeAsync(() => {
      let attive = 0
      let massimo = 0
      servizio.dettaglio.and.callFake(() =>
        defer(() => {
          attive++
          massimo = Math.max(massimo, attive)
          return of(stato('IN_CORSO'))
        }).pipe(finalize(() => attive--))
      )
      crea()
      tick(INTERVALLO_AGGIORNAMENTO_MS * 20)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(21)
      expect(massimo).toBe(1)
      fixture.destroy()
      expect(attive).toBe(0)
    }))

    it('risposta tardiva: una lettura nuova annulla la pendente e la vecchia non scrive', fakeAsync(() => {
      const vecchia = new Subject<ElaborazioneDettaglio>()
      servizio.dettaglio.and.returnValues(vecchia as never, of(stato('ANTEPRIMA_PRONTA', 9)))
      crea()
      comp.carica()
      expect(vecchia.observed).toBeFalse()
      vecchia.next(stato('ANTEPRIMA_PRONTA', 1))
      expect(comp.dettaglio()?.versione).toBe(9)
      fixture.destroy()
    }))
  })

  describe('azioni', () => {
    beforeEach(() => {
      servizio.dettaglio.and.returnValue(of(dettaglio()))
    })

    it('ricalcola manda la versione e poi rilegge lo stato', fakeAsync(() => {
      servizio.ricalcola.and.returnValue(of({ id: 'e1' }))
      crea()
      comp.ricalcola()
      expect(servizio.ricalcola).toHaveBeenCalledWith('e1', 3)
      expect(servizio.dettaglio).toHaveBeenCalledTimes(2)
      fixture.destroy()
    }))

    it('ricalcola ripetuto durante la richiesta: una sola chiamata', fakeAsync(() => {
      const risposta = new Subject<{ id: string }>()
      servizio.ricalcola.and.returnValue(risposta)
      crea()
      comp.ricalcola()
      comp.ricalcola()
      expect(servizio.ricalcola).toHaveBeenCalledTimes(1)
      risposta.next({ id: 'e1' })
      risposta.complete()
      expect(comp.inAzione()).toBeFalse()
      fixture.destroy()
    }))

    it('scarta manda la versione e chiude la conferma', fakeAsync(() => {
      servizio.scarta.and.returnValue(of({ id: 'e1' }))
      crea()
      comp.scartaAperta.set(true)
      comp.scarta()
      expect(servizio.scarta).toHaveBeenCalledWith('e1', 3)
      expect(comp.scartaAperta()).toBeFalse()
      fixture.destroy()
    }))

    it('chiudendo «Scarta» il focus torna al pulsante che l’ha aperto', fakeAsync(() => {
      crea()
      const origine = document.createElement('button')
      document.body.appendChild(origine)
      origine.focus()
      comp.scartaAperta.set(true)
      fixture.detectChanges()
      document.body.focus()
      comp.scartaAperta.set(false)
      fixture.detectChanges()
      tick(100)
      expect(document.activeElement).toBe(origine)
      origine.remove()
      fixture.destroy()
    }))

    it('definitiva: manda impronta e versione dell’anteprima vista, poi rilegge', fakeAsync(() => {
      servizio.definitiva.and.returnValue(of({ id: 'e1' }))
      crea()
      comp.confermaAperta.set(true)
      comp.rendiDefinitiva()
      expect(servizio.definitiva).toHaveBeenCalledWith('e1', 'a'.repeat(64), 3)
      expect(comp.confermaAperta()).toBeFalse()
      expect(servizio.dettaglio).toHaveBeenCalledTimes(2)
      fixture.destroy()
    }))

    it('definitiva con interruttore spento: non chiama il servizio', fakeAsync(() => {
      servizio.dettaglio.and.returnValue(of(dettaglio({ definitiveAttive: false })))
      crea()
      comp.rendiDefinitiva()
      expect(servizio.definitiva).not.toHaveBeenCalled()
      fixture.destroy()
    }))

    it('409 DEFINITIVE_NON_ATTIVE: stesso messaggio del pulsante', fakeAsync(() => {
      servizio.definitiva.and.returnValue(
        throwError(() => ({ status: 409, error: { error: 'DEFINITIVE_NON_ATTIVE', message: 'x' } }))
      )
      crea()
      comp.rendiDefinitiva()
      expect(comp.esito()?.messaggio).toBe(
        'Le fatture definitive non sono ancora attive per questa azienda'
      )
      expect(comp.inAzione()).toBeFalse()
      fixture.destroy()
    }))

    it('409 ANTEPRIMA_SUPERATA: messaggio con le differenze e «Ricalcola»', fakeAsync(() => {
      servizio.definitiva.and.returnValue(
        throwError(() => ({
          status: 409,
          error: {
            error: 'ANTEPRIMA_SUPERATA',
            message: 'x',
            details: { differenze: { nuovi: 1, cambiati: 2, fatturatiDaAltri: 0 } },
          },
        }))
      )
      crea()
      comp.rendiDefinitiva()
      const e = comp.esito()!
      expect(e.messaggio).toContain('non è più aggiornata')
      expect(e.differenze).toContain('1 nuovi, 2 cambiati, 0 già fatturati da altri')
      expect(e.ricalcola).toBeTrue()
      fixture.destroy()
    }))

    it('409 VERSIONE_SUPERATA o ELABORAZIONE_GIA_IN_DEFINITIVA: messaggio e rilettura dello stato', fakeAsync(() => {
      for (const codice of [
        'VERSIONE_SUPERATA',
        'ELABORAZIONE_GIA_IN_DEFINITIVA',
        'ANTEPRIMA_SUPERATA',
        'DATA_ANTERIORE_ULTIMA_FATTURA',
        'NESSUN_DOCUMENTO_DEFINIBILE',
      ]) {
        servizio.dettaglio.calls.reset()
        servizio.ricalcola.and.returnValue(
          throwError(() => ({ status: 409, error: { error: codice, message: 'x' } }))
        )
        crea()
        comp.ricalcola()
        expect(comp.esito()).not.toBeNull()
        expect(servizio.dettaglio).toHaveBeenCalledTimes(2)
        fixture.destroy()
      }
    }))

    it('errore di un’azione: nessun id o testo tecnico nel messaggio', fakeAsync(() => {
      servizio.ricalcola.and.returnValue(
        throwError(() => ({ status: 500, error: { message: 'Errore interno e1 ' } }))
      )
      crea()
      comp.ricalcola()
      expect(comp.esito()!.messaggio).not.toContain('e1')
      fixture.destroy()
    }))
  })
})
