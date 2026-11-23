import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { RentriRegistroCollegamentoComponent } from './rentri-registro-collegamento.component'
import {
  CandidatoRegistroRentri,
  ImpostazioniRegistroRentri,
  RentriRegistroService,
} from './rentri-registro.service'
import { ToastService } from '../../core/services/toast.service'

function registro(p: Partial<ImpostazioniRegistroRentri> = {}): ImpostazioniRegistroRentri {
  return {
    registroId: 'r1',
    descrizione: 'Sede di Milano',
    identificativoRentri: null,
    invioAutomatico: false,
    invioAutomaticoDal: null,
    perStato: {},
    nonTrasmessi: 0,
    escluse: 0,
    haCertificato: true,
    scadenzaTrasmissione: null,
    numIscrSito: 'OP0001XX000001-MI0001',
    rentriAttivita: [],
    rentriAttivitaRecSmalt: [],
    aperturaInCorso: false,
    rentriChiusoIl: null,
    chiusuraInCorso: false,
    ...p,
  }
}

const cand = (p: Partial<CandidatoRegistroRentri> = {}): CandidatoRegistroRentri => ({
  identificativo: 'RAB12CD34E5',
  descrizione: 'Registro portale',
  attivita: ['Produzione'],
  attivitaRecSmalt: [],
  dataCreazione: '2026-11-01T10:00:00Z',
  collegatoA: null,
  questoRegistro: false,
  ...p,
})

const q = <T extends HTMLElement = HTMLElement>(testid: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${testid}"]`)
const clic = (testid: string) => q(testid)!.querySelector('button')!.click()

describe('RentriRegistroCollegamentoComponent', () => {
  let servizio: jasmine.SpyObj<RentriRegistroService>
  let toast: jasmine.SpyObj<ToastService>
  let fixture: ComponentFixture<RentriRegistroCollegamentoComponent>
  let aggiornato: jasmine.Spy

  function monta(r: ImpostazioniRegistroRentri): void {
    fixture = TestBed.createComponent(RentriRegistroCollegamentoComponent)
    fixture.componentRef.setInput('registro', r)
    aggiornato = jasmine.createSpy('aggiornato')
    fixture.componentInstance.aggiornato.subscribe(aggiornato)
    fixture.detectChanges()
  }

  beforeEach(() => {
    servizio = jasmine.createSpyObj<RentriRegistroService>('RentriRegistroService', [
      'candidati',
      'collega',
      'apri',
      'abbandonaApertura',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['error', 'success', 'info', 'warn'])
    TestBed.configureTestingModule({
      imports: [RentriRegistroCollegamentoComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        { provide: RentriRegistroService, useValue: servizio },
        { provide: ToastService, useValue: toast },
      ],
    })
  })
  afterEach(() => fixture?.destroy())

  it("senza sede: nessuna scelta, solo l'avviso", () => {
    monta(registro({ numIscrSito: null }))
    expect(q('rentri-col-senza-sede')).not.toBeNull()
    expect(q('rentri-col-elenco')).toBeNull()
    expect(q('rentri-col-apri-nuovo')).toBeNull()
  })

  it("collegato: mostra l'identificativo e nasconde le scelte", () => {
    monta(registro({ identificativoRentri: 'RAB12CD34E5', rentriAttivita: ['Produzione'] }))
    expect(q('rentri-col-attuale')!.textContent).toContain('RAB12CD34E5')
    expect(q('rentri-col-elenco')).toBeNull()
  })

  it('chiuso su RENTRI: lo dice', () => {
    monta(registro({ identificativoRentri: 'RAB12CD34E5', rentriChiusoIl: '2026-11-01T00:00:00Z' }))
    expect(q('rentri-col-chiuso')).not.toBeNull()
  })

  it("scegli dall'elenco: mostra i candidati, blocca quelli gia' collegati, collega", () => {
    servizio.candidati.and.returnValue(
      of({ candidati: [cand(), cand({ identificativo: 'RZZ99ZZ99Z9', collegatoA: 'altro' })] })
    )
    servizio.collega.and.returnValue(of(registro()))
    monta(registro())
    clic('rentri-col-elenco')
    fixture.detectChanges()
    expect(q('rentri-col-cand-RAB12CD34E5')).not.toBeNull()
    expect(q('rentri-col-collega-RZZ99ZZ99Z9')!.querySelector('button')!.disabled).toBeTrue()
    clic('rentri-col-collega-RAB12CD34E5')
    fixture.detectChanges()
    expect(servizio.collega).toHaveBeenCalledOnceWith('r1', 'RAB12CD34E5')
    expect(toast.success).toHaveBeenCalled()
    expect(aggiornato).toHaveBeenCalledOnceWith(true)
  })

  it('elenco vuoto: invita ad aprire un registro', () => {
    servizio.candidati.and.returnValue(of({ candidati: [] }))
    monta(registro())
    clic('rentri-col-elenco')
    fixture.detectChanges()
    expect(q('rentri-col-vuoto')).not.toBeNull()
  })

  it("errore del backend: si mostra il messaggio cosi' com'e'", () => {
    servizio.candidati.and.returnValue(
      throwError(() => ({ error: { message: 'Configura il numero di iscrizione RENTRI.' } }))
    )
    monta(registro())
    clic('rentri-col-elenco')
    fixture.detectChanges()
    expect(q('rentri-col-errore')!.textContent).toContain('Configura il numero')
  })

  describe('apri un nuovo registro', () => {
    function spunta(testid: string) {
      const el = q<HTMLInputElement>(testid)!
      el.checked = !el.checked
      el.dispatchEvent(new Event('change'))
      fixture.detectChanges()
    }

    it("senza attivita' non si puo' avviare; i codici R/D compaiono solo con Recupero/Smaltimento", () => {
      monta(registro())
      clic('rentri-col-apri-nuovo')
      fixture.detectChanges()
      expect(q('rentri-col-apri-avvia')!.querySelector('button')!.disabled).toBeTrue()
      expect(q('rentri-col-codici')).toBeNull()
      spunta('rentri-col-att-Recupero')
      expect(q('rentri-col-codici')).not.toBeNull()
      expect(q('rentri-col-apri-avvia')!.querySelector('button')!.disabled).toBeFalse()
    })

    it("chiede conferma, poi apre con attivita', codici normalizzati e descrizione", () => {
      servizio.apri.and.returnValue(of({ esito: 'APERTO', impostazioni: registro() }))
      monta(registro())
      clic('rentri-col-apri-nuovo')
      fixture.detectChanges()
      spunta('rentri-col-att-Produzione')
      spunta('rentri-col-att-Recupero')
      const codici = q<HTMLInputElement>('rentri-col-codici')!
      codici.value = 'r13, d15'
      codici.dispatchEvent(new Event('input'))
      fixture.detectChanges()
      clic('rentri-col-apri-avvia')
      fixture.detectChanges()
      expect(servizio.apri).not.toHaveBeenCalled()
      expect(q('rentri-col-conferma')).not.toBeNull()
      clic('rentri-col-conferma-si')
      fixture.detectChanges()
      expect(servizio.apri).toHaveBeenCalledOnceWith('r1', {
        attivita: ['Produzione', 'Recupero'],
        attivitaRecSmalt: ['R13', 'D15'],
      })
      expect(aggiornato).toHaveBeenCalledOnceWith(true)
    })

    it('Recupero senza codici: errore locale, nessuna chiamata', () => {
      monta(registro())
      clic('rentri-col-apri-nuovo')
      fixture.detectChanges()
      spunta('rentri-col-att-Recupero')
      clic('rentri-col-apri-avvia')
      fixture.detectChanges()
      expect(q('rentri-col-errore')!.textContent).toContain('almeno un codice')
      expect(q('rentri-col-conferma')).toBeNull()
    })

    it('esito incerto (202): avviso di non riprovare, nessun toast di successo', () => {
      servizio.apri.and.returnValue(of({ esito: 'INCERTO', messaggio: 'Non riprovare subito.' }))
      monta(registro())
      clic('rentri-col-apri-nuovo')
      fixture.detectChanges()
      spunta('rentri-col-att-Produzione')
      clic('rentri-col-apri-avvia')
      fixture.detectChanges()
      clic('rentri-col-conferma-si')
      fixture.detectChanges()
      expect(q('rentri-col-avviso')!.textContent).toContain('Non riprovare subito.')
      expect(toast.success).not.toHaveBeenCalled()
      expect(aggiornato).toHaveBeenCalledOnceWith(false)
    })

    it('errore del backend (409): messaggio nel pannello', () => {
      servizio.apri.and.returnValue(
        throwError(() => ({ error: { message: 'Apertura del registro su RENTRI già in corso.' } }))
      )
      monta(registro())
      clic('rentri-col-apri-nuovo')
      fixture.detectChanges()
      spunta('rentri-col-att-Produzione')
      clic('rentri-col-apri-avvia')
      fixture.detectChanges()
      clic('rentri-col-conferma-si')
      fixture.detectChanges()
      expect(q('rentri-col-errore')!.textContent).toContain('già in corso')
    })
  })

  it('apertura in corso: avviso di non riprovare', () => {
    monta(registro({ aperturaInCorso: true }))
    expect(q('rentri-col-in-corso')!.textContent).toContain('non riprovare')
  })

  describe('abbandona apertura (E3)', () => {
    it("compare solo con un'apertura in sospeso e il registro non collegato", () => {
      monta(registro({ aperturaInCorso: false }))
      expect(q('rentri-col-abbandona')).toBeNull()
      fixture.destroy()
      monta(registro({ aperturaInCorso: true, identificativoRentri: 'RAB12CD34E5' }))
      expect(q('rentri-col-abbandona')).toBeNull()
      fixture.destroy()
      monta(registro({ aperturaInCorso: true }))
      expect(q('rentri-col-abbandona')).not.toBeNull()
    })

    it('chiede conferma, poi azzera la prenotazione e fa rileggere (aggiornato false)', () => {
      servizio.abbandonaApertura.and.returnValue(of(registro()))
      monta(registro({ aperturaInCorso: true }))
      clic('rentri-col-abbandona')
      fixture.detectChanges()
      expect(servizio.abbandonaApertura).not.toHaveBeenCalled()
      clic('rentri-col-abbandona-si')
      expect(servizio.abbandonaApertura).toHaveBeenCalledOnceWith('r1')
      expect(toast.success).toHaveBeenCalled()
      expect(aggiornato).toHaveBeenCalledWith(false)
    })

    it('troppo presto (409): messaggio del backend', () => {
      servizio.abbandonaApertura.and.returnValue(
        throwError(() => ({ error: { message: 'Riprova più tardi.' } }))
      )
      monta(registro({ aperturaInCorso: true }))
      clic('rentri-col-abbandona')
      fixture.detectChanges()
      clic('rentri-col-abbandona-si')
      fixture.detectChanges()
      expect(q('rentri-col-errore')!.textContent).toContain('Riprova più tardi')
      expect(aggiornato).not.toHaveBeenCalled()
    })
  })
})
