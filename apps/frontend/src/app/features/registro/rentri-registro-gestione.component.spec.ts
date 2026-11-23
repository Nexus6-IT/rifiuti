import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { RentriRegistroGestioneComponent } from './rentri-registro-gestione.component'
import { ImpostazioniRegistroRentri, RentriRegistroService } from './rentri-registro.service'
import { ToastService } from '../../core/services/toast.service'

function registro(p: Partial<ImpostazioniRegistroRentri> = {}): ImpostazioniRegistroRentri {
  return {
    registroId: 'r1',
    descrizione: 'Sede di Milano',
    identificativoRentri: 'RAB12CD34E5',
    invioAutomatico: false,
    invioAutomaticoDal: null,
    perStato: {},
    nonTrasmessi: 0,
    escluse: 0,
    haCertificato: true,
    scadenzaTrasmissione: null,
    numIscrSito: 'OP0001XX000001-MI0001',
    rentriAttivita: ['Produzione'],
    rentriAttivitaRecSmalt: [],
    aperturaInCorso: false,
    rentriChiusoIl: null,
    chiusuraInCorso: false,
    ...p,
  }
}

const q = <T extends HTMLElement = HTMLElement>(testid: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${testid}"]`)
const clic = (testid: string) => q(testid)!.querySelector('button')!.click()
const scrivi = (testid: string, valore: string) => {
  const el = q<HTMLInputElement>(testid)!
  el.value = valore
  el.dispatchEvent(new Event('input'))
}

describe('RentriRegistroGestioneComponent (eREGI E3)', () => {
  let servizio: jasmine.SpyObj<RentriRegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<RentriRegistroGestioneComponent>
  let aggiornato: jasmine.Spy

  function monta(r: ImpostazioniRegistroRentri): void {
    fixture = TestBed.createComponent(RentriRegistroGestioneComponent)
    fixture.componentRef.setInput('registro', r)
    aggiornato = jasmine.createSpy('aggiornato')
    fixture.componentInstance.aggiornato.subscribe(aggiornato)
    fixture.detectChanges()
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RentriRegistroService>('RentriRegistroService', [
      'modifica',
      'chiudi',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [RentriRegistroGestioneComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: RentriRegistroService, useValue: servizio },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it('non collegato o chiuso: niente da gestire', () => {
    monta(registro({ identificativoRentri: null }))
    expect(q('rentri-gest')).toBeNull()
    fixture.destroy()
    monta(registro({ rentriChiusoIl: '2026-11-01T00:00:00Z' }))
    expect(q('rentri-gest')).toBeNull()
  })

  describe('modifica', () => {
    it('invia solo la descrizione cambiata e avvisa', () => {
      servizio.modifica.and.returnValue(of({ esito: 'MODIFICATO', impostazioni: registro() }))
      monta(registro())
      expect(q<HTMLInputElement>('rentri-gest-descrizione')!.value).toBe('Sede di Milano')
      expect(q('rentri-gest-codici')).toBeNull()
      scrivi('rentri-gest-descrizione', '  Nuova sede ')
      fixture.detectChanges()
      clic('rentri-gest-salva')
      expect(servizio.modifica).toHaveBeenCalledOnceWith('r1', { descrizione: 'Nuova sede' })
      expect(toast.success).toHaveBeenCalled()
      expect(aggiornato).toHaveBeenCalledWith(true)
    })

    it('il pulsante resta spento se non è cambiato nulla', () => {
      monta(registro())
      fixture.detectChanges()
      expect(q('rentri-gest-salva')!.querySelector('button')!.disabled).toBeTrue()
    })

    it('Recupero: mostra i codici e la casella «forza», li invia insieme', () => {
      servizio.modifica.and.returnValue(of({ esito: 'MODIFICATO', impostazioni: registro() }))
      monta(registro({ rentriAttivita: ['Recupero'], rentriAttivitaRecSmalt: ['R1'] }))
      expect(q<HTMLInputElement>('rentri-gest-codici')!.value).toBe('R1')
      scrivi('rentri-gest-codici', 'r1, R13')
      q<HTMLInputElement>('rentri-gest-forza')!.click()
      fixture.detectChanges()
      clic('rentri-gest-salva')
      expect(servizio.modifica).toHaveBeenCalledOnceWith('r1', {
        attivitaRecSmalt: ['R1', 'R13'],
        forza: true,
      })
    })

    it('esito incerto: avviso, il dialog non si chiude (aggiornato false)', () => {
      servizio.modifica.and.returnValue(of({ esito: 'INCERTO', messaggio: 'Non confermata' }))
      monta(registro())
      scrivi('rentri-gest-descrizione', 'Altra')
      fixture.detectChanges()
      clic('rentri-gest-salva')
      fixture.detectChanges()
      expect(q('rentri-gest-avviso')!.textContent).toContain('Non confermata')
      expect(aggiornato).toHaveBeenCalledWith(false)
    })

    it('errore del backend: messaggio in italiano senza chiudere', () => {
      servizio.modifica.and.returnValue(
        throwError(() => ({ error: { message: 'Il registro è già chiuso su RENTRI.' } }))
      )
      monta(registro())
      scrivi('rentri-gest-descrizione', 'Altra')
      fixture.detectChanges()
      clic('rentri-gest-salva')
      fixture.detectChanges()
      expect(q('rentri-gest-errore')!.textContent).toContain('già chiuso')
      expect(aggiornato).not.toHaveBeenCalled()
    })
  })

  describe('chiusura (doppia conferma)', () => {
    it('il primo passo apre solo la conferma: nessuna chiamata', () => {
      monta(registro())
      expect(q('rentri-gest-conferma')).toBeNull()
      clic('rentri-gest-chiudi')
      fixture.detectChanges()
      expect(q('rentri-gest-conferma')).not.toBeNull()
      expect(servizio.chiudi).not.toHaveBeenCalled()
    })

    it("«Chiudi definitivamente» resta spento finché non si digita l'identificativo esatto", () => {
      monta(registro())
      clic('rentri-gest-chiudi')
      fixture.detectChanges()
      const spento = () => q('rentri-gest-conferma-si')!.querySelector('button')!.disabled
      expect(spento()).toBeTrue()
      scrivi('rentri-gest-conferma-testo', 'RAB12CD34E')
      fixture.detectChanges()
      expect(spento()).toBeTrue()
      scrivi('rentri-gest-conferma-testo', ' rab12cd34e5 ')
      fixture.detectChanges()
      expect(spento()).toBeFalse()
    })

    it('conferma: chiama il backend con l identificativo e chiude il dialog', () => {
      servizio.chiudi.and.returnValue(of({ esito: 'CHIUSO', impostazioni: registro() }))
      monta(registro())
      clic('rentri-gest-chiudi')
      fixture.detectChanges()
      scrivi('rentri-gest-conferma-testo', 'RAB12CD34E5')
      fixture.detectChanges()
      clic('rentri-gest-conferma-si')
      expect(servizio.chiudi).toHaveBeenCalledOnceWith('r1', 'RAB12CD34E5')
      expect(toast.success).toHaveBeenCalled()
      expect(aggiornato).toHaveBeenCalledWith(true)
    })

    it('annullare richiude la conferma senza chiamare il backend', () => {
      monta(registro())
      clic('rentri-gest-chiudi')
      fixture.detectChanges()
      clic('rentri-gest-conferma-no')
      fixture.detectChanges()
      expect(q('rentri-gest-conferma')).toBeNull()
      expect(servizio.chiudi).not.toHaveBeenCalled()
    })

    it('409 con annotazioni da trasmettere: il messaggio del backend resta visibile', () => {
      servizio.chiudi.and.returnValue(
        throwError(() => ({
          error: {
            message: 'Non si può chiudere il registro: ci sono annotazioni 3 da trasmettere.',
          },
        }))
      )
      monta(registro())
      clic('rentri-gest-chiudi')
      fixture.detectChanges()
      scrivi('rentri-gest-conferma-testo', 'RAB12CD34E5')
      fixture.detectChanges()
      clic('rentri-gest-conferma-si')
      fixture.detectChanges()
      expect(q('rentri-gest-errore')!.textContent).toContain('3 da trasmettere')
      expect(aggiornato).not.toHaveBeenCalled()
    })

    it('esito incerto: avviso e dialog aperto', () => {
      servizio.chiudi.and.returnValue(of({ esito: 'INCERTO', messaggio: 'Ripeti «Chiudi»' }))
      monta(registro())
      clic('rentri-gest-chiudi')
      fixture.detectChanges()
      scrivi('rentri-gest-conferma-testo', 'RAB12CD34E5')
      fixture.detectChanges()
      clic('rentri-gest-conferma-si')
      fixture.detectChanges()
      expect(q('rentri-gest-avviso')!.textContent).toContain('Ripeti')
      expect(aggiornato).toHaveBeenCalledWith(false)
    })

    it('chiusura in corso: lo segnala, i nuovi invii sono fermi, si può ripetere la chiusura', () => {
      monta(registro({ chiusuraInCorso: true }))
      expect(q('rentri-gest-in-corso')).not.toBeNull()
      expect(q('rentri-gest-modifica')).toBeNull()
      expect(q('rentri-gest-chiudi')).not.toBeNull()
    })
  })
})
