import { ComponentFixture, TestBed } from '@angular/core/testing'
import { signal } from '@angular/core'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { RentriBlocchiComponent } from './rentri-blocchi.component'
import { RentriBlocchiService, RentriBlocco, RentriScorta } from './rentri-blocchi.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'

function blocco(overrides: Partial<RentriBlocco> = {}): RentriBlocco {
  return {
    codiceBlocco: 'BLK-001',
    descrizione: 'Blocco camion targa AB123CD',
    numIscrSito: 'OP1234ABC123456-RM1234',
    disattivo: false,
    numeroFirVidimati: 12,
    dataUltimoUtilizzo: '2026-08-01T10:00:00.000Z',
    predefinito: true,
    ...overrides,
  }
}

function scorta(overrides: Partial<RentriScorta> = {}): RentriScorta {
  return {
    totaleDisponibili: 30,
    perBlocco: [
      {
        codiceBlocco: 'BLK-001',
        numIscrSito: 'OP1234ABC123456-RM1234',
        descrizione: 'Blocco camion targa AB123CD',
        disponibili: 30,
      },
    ],
    ...overrides,
  }
}

describe('RentriBlocchiComponent', () => {
  let fixture: ComponentFixture<RentriBlocchiComponent>
  let component: RentriBlocchiComponent
  let service: jasmine.SpyObj<RentriBlocchiService>
  let toast: jasmine.SpyObj<ToastService>
  let authStub: { currentUser: ReturnType<typeof signal> }

  function setup(role: string | undefined): void {
    authStub = { currentUser: signal(role ? { id: 'u1', email: 'u@test.com', role } : null) }
    service = jasmine.createSpyObj<RentriBlocchiService>('RentriBlocchiService', [
      'blocchi',
      'scorta',
      'vidima',
      'setPredefinito',
      'emissionePossibile',
    ])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error'])

    TestBed.configureTestingModule({
      imports: [RentriBlocchiComponent, NoopAnimationsModule],
      providers: [
        { provide: RentriBlocchiService, useValue: service },
        { provide: AuthService, useValue: authStub },
        { provide: ToastService, useValue: toast },
      ],
    })

    fixture = TestBed.createComponent(RentriBlocchiComponent)
    component = fixture.componentInstance
  }

  it('mostra il gate "accesso riservato" per un ruolo senza visibilità RENTRI, senza chiamare il backend', () => {
    setup('VIEWER')
    fixture.detectChanges()

    expect(component.isAutorizzato()).toBe(false)
    expect(service.blocchi).not.toHaveBeenCalled()
    expect(service.scorta).not.toHaveBeenCalled()
  })

  it('carica blocchi e scorta per OPERATOR (visibilità in lettura)', () => {
    setup('OPERATOR')
    service.blocchi.and.returnValue(of([blocco()]))
    service.scorta.and.returnValue(of(scorta()))

    fixture.detectChanges()

    expect(service.blocchi).toHaveBeenCalled()
    expect(service.scorta).toHaveBeenCalled()
    expect(component.blocchi()).toEqual([blocco()])
    expect(component.scorta()).toEqual(scorta())
  })

  it('etichetta il totale scorta come "su tutte le sedi" e mostra la sede di ogni riga', () => {
    setup('ADMIN')
    service.blocchi.and.returnValue(of([blocco()]))
    service.scorta.and.returnValue(of(scorta()))

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    const totale = html.querySelector('[data-testid="rentri-blocchi-scorta-totale"]')
    expect(totale?.textContent).toContain('tutte le sedi')

    const riga = html.querySelector('[data-testid="rentri-blocchi-scorta-blocco-BLK-001"]')
    expect(riga?.textContent).toContain('OP1234ABC123456-RM1234')
  })

  it('mostra sempre la nota su dove si creano i blocchi (solo sul portale RENTRI)', () => {
    setup('ADMIN')
    service.blocchi.and.returnValue(of([blocco()]))
    service.scorta.and.returnValue(of(scorta()))

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    const nota = html.querySelector('[data-testid="rentri-blocchi-nota-portale"]')
    expect(nota).not.toBeNull()
    expect(nota?.textContent).toContain('portale RENTRI')
    expect(nota?.textContent).toContain('Interoperabilità')
  })

  it('mostra uno stato vuoto esplicativo quando non ci sono blocchi attivi (non una tabella vuota)', () => {
    setup('ADMIN')
    service.blocchi.and.returnValue(of([]))
    service.scorta.and.returnValue(of({ totaleDisponibili: 0, perBlocco: [] }))

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(html.querySelector('[data-testid="rentri-blocchi-empty-state"]')).not.toBeNull()
    expect(html.querySelector('[data-testid="rentri-blocchi-list-attivi"]')).toBeNull()
  })

  it('distingue i blocchi disattivati senza nasconderli', () => {
    setup('ADMIN')
    service.blocchi.and.returnValue(
      of([blocco(), blocco({ codiceBlocco: 'BLK-002', disattivo: true, predefinito: false })])
    )
    service.scorta.and.returnValue(of(scorta()))

    fixture.detectChanges()

    expect(component.bloccheAttivi().map(b => b.codiceBlocco)).toEqual(['BLK-001'])
    expect(component.bloccheDisattivati().map(b => b.codiceBlocco)).toEqual(['BLK-002'])

    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="rentri-blocchi-list-disattivati"]')).not.toBeNull()
    expect(html.querySelector('[data-testid="rentri-blocchi-row-BLK-002"]')).not.toBeNull()
  })

  it('nasconde le azioni di scrittura a un OPERATOR (sola lettura)', () => {
    setup('OPERATOR')
    service.blocchi.and.returnValue(of([blocco({ predefinito: false })]))
    service.scorta.and.returnValue(of(scorta()))

    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    expect(component.isAdmin()).toBe(false)
    expect(html.querySelector('[data-testid="rentri-blocchi-vidima-BLK-001"]')).toBeNull()
    expect(html.querySelector('[data-testid="rentri-blocchi-set-predefinito-BLK-001"]')).toBeNull()
  })

  it('imposta un blocco come predefinito e ricarica', () => {
    setup('ADMIN')
    service.blocchi.and.returnValue(of([blocco({ predefinito: false })]))
    service.scorta.and.returnValue(of(scorta()))
    fixture.detectChanges()

    service.setPredefinito.and.returnValue(of({ codiceBlocco: 'BLK-001', numIscrSito: 'x' }))
    component.impostaPredefinito(blocco({ predefinito: false }))

    expect(service.setPredefinito).toHaveBeenCalledWith('BLK-001')
    expect(toast.success).toHaveBeenCalled()
  })

  it('imposta un blocco senza descrizione come predefinito senza mostrare "null"', () => {
    setup('ADMIN')
    service.blocchi.and.returnValue(of([blocco({ predefinito: false, descrizione: null })]))
    service.scorta.and.returnValue(of(scorta()))
    fixture.detectChanges()

    service.setPredefinito.and.returnValue(of({ codiceBlocco: 'BLK-001', numIscrSito: 'x' }))
    component.impostaPredefinito(blocco({ predefinito: false, descrizione: null }))

    const messaggio = toast.success.calls.mostRecent().args[0] as string
    expect(messaggio).not.toContain('null')
    expect(messaggio).toContain('BLK-001')
  })

  it('avvia la vidimazione di un lotto e avvisa che non è immediata', () => {
    setup('ADMIN')
    service.blocchi.and.returnValue(of([blocco()]))
    service.scorta.and.returnValue(of(scorta()))
    fixture.detectChanges()

    component.apriVidimazione(blocco())
    component.quantitaVidimazione = 20
    service.vidima.and.returnValue(of({ avviato: true, richiesti: 20 }))

    component.confermaVidimazione()

    expect(service.vidima).toHaveBeenCalledWith('BLK-001', 20)
    expect(component.displayVidimaDialog).toBe(false)
    const messaggio = toast.success.calls.mostRecent().args[0]
    expect(messaggio).toContain('non è immediata')
  })

  it('impone il tetto di 100 sul campo quantità, come il backend (@Max(100))', () => {
    setup('ADMIN')
    service.blocchi.and.returnValue(of([blocco()]))
    service.scorta.and.returnValue(of(scorta()))
    fixture.detectChanges()

    component.apriVidimazione(blocco())
    fixture.detectChanges()
    const html: HTMLElement = fixture.nativeElement

    const input = html.querySelector('[data-testid="rentri-blocchi-vidima-input-quantita"]')
    expect(input?.getAttribute('ng-reflect-max') ?? input?.getAttribute('max')).toBe('100')
  })

  it('non avvia la vidimazione se la quantità supera 100 (allineato al @Max(100) del backend)', () => {
    setup('ADMIN')
    service.blocchi.and.returnValue(of([blocco()]))
    service.scorta.and.returnValue(of(scorta()))
    fixture.detectChanges()

    component.apriVidimazione(blocco())
    component.quantitaVidimazione = 250

    component.confermaVidimazione()

    expect(service.vidima).not.toHaveBeenCalled()
  })

  it('mostra un errore se la vidimazione fallisce, senza chiudere il dialogo', () => {
    setup('ADMIN')
    service.blocchi.and.returnValue(of([blocco()]))
    service.scorta.and.returnValue(of(scorta()))
    fixture.detectChanges()

    component.apriVidimazione(blocco())
    component.quantitaVidimazione = 5
    service.vidima.and.returnValue(throwError(() => ({ error: { message: 'Blocco non attivo' } })))

    component.confermaVidimazione()

    expect(toast.error).toHaveBeenCalledWith('Blocco non attivo')
    expect(component.displayVidimaDialog).toBe(true)
  })

  it('la pagina ha la larghezza di .page, senza max-width proprio', () => {
    setup('ADMIN')
    service.blocchi.and.returnValue(of([blocco()]))
    service.scorta.and.returnValue(of(scorta()))
    fixture.detectChanges()

    const pagina = (fixture.nativeElement as HTMLElement).querySelector('.page') as HTMLElement
    expect(pagina).not.toBeNull()
    expect(pagina.getAttribute('style') ?? '').not.toContain('max-width')
    expect(getComputedStyle(pagina).maxWidth).toBe('1320px')
  })
})
