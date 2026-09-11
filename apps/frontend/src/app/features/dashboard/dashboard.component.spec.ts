import { ComponentFixture, TestBed } from '@angular/core/testing'
import { RouterTestingModule } from '@angular/router/testing'
import { of, throwError } from 'rxjs'

import { DashboardComponent } from './dashboard.component'
import { FirService } from '../fir/fir.service'
import { AttenzioneService, VoceAttenzione } from './attenzione.service'
import { AndamentoService, AndamentoMensileResult } from './andamento.service'
import { FIR, PaginatedFIRResponse } from '../../shared/models/fir.model'

function paginaFIRVuota(): PaginatedFIRResponse {
  return {
    items: [] as FIR[],
    total: 0,
    page: 1,
    limit: 5,
    totalPages: 0,
  } as PaginatedFIRResponse
}

function voceAttenzione(overrides: Partial<VoceAttenzione> = {}): VoceAttenzione {
  return {
    chiave: 'autorizzazione',
    gravita: 'avviso',
    titolo: 'Autorizzazione XYZ in scadenza',
    dettaglio: 'scade fra 12 giorni',
    azione: { etichetta: 'Vedi autorizzazione', rotta: '/impianti/autorizzazioni/1' },
    ...overrides,
  }
}

function andamentoVuoto(): AndamentoMensileResult {
  return { mesi: [] }
}

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>
  let component: DashboardComponent
  let firService: jasmine.SpyObj<FirService>
  let attenzioneService: jasmine.SpyObj<AttenzioneService>
  let andamentoService: jasmine.SpyObj<AndamentoService>

  function setup(): void {
    firService = jasmine.createSpyObj<FirService>('FirService', ['getFIRList'])
    firService.getFIRList.and.returnValue(of(paginaFIRVuota()))

    attenzioneService = jasmine.createSpyObj<AttenzioneService>('AttenzioneService', [
      'getAttenzione',
    ])
    attenzioneService.getAttenzione.and.returnValue(of({ voci: [] }))

    andamentoService = jasmine.createSpyObj<AndamentoService>('AndamentoService', ['getAndamento'])
    andamentoService.getAndamento.and.returnValue(of(andamentoVuoto()))

    TestBed.configureTestingModule({
      imports: [DashboardComponent, RouterTestingModule],
      providers: [
        { provide: FirService, useValue: firService },
        { provide: AttenzioneService, useValue: attenzioneService },
        { provide: AndamentoService, useValue: andamentoService },
      ],
    })

    fixture = TestBed.createComponent(DashboardComponent)
    component = fixture.componentInstance
  }

  it('mostra la fascia di attenzione sopra gli indicatori, con la voce critica per prima', () => {
    setup()
    attenzioneService.getAttenzione.and.returnValue(
      of({
        voci: [
          voceAttenzione({
            chiave: 'certificato-rentri',
            gravita: 'critico',
            titolo: 'Certificato RENTRI scaduto',
            dettaglio: 'scaduto da 3 giorni',
            azione: { etichetta: 'Rinnova certificato', rotta: '/rentri/credenziali' },
          }),
          voceAttenzione({
            chiave: 'autorizzazione',
            gravita: 'avviso',
            titolo: 'Autorizzazione XYZ in scadenza',
            dettaglio: 'scade fra 12 giorni',
          }),
        ],
      })
    )

    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    const fascia = html.querySelector('[data-testid="attenzione-fascia"]')
    expect(fascia).not.toBeNull()

    const voci = html.querySelectorAll('[data-testid^="attenzione-voce-"]')
    expect(voci.length).toBe(2)
    expect(voci[0].getAttribute('data-testid')).toBe('attenzione-voce-certificato-rentri')
    expect(voci[0].textContent).toContain('Certificato RENTRI scaduto')
    expect(voci[1].getAttribute('data-testid')).toBe('attenzione-voce-autorizzazione')

    // La fascia precede la sezione degli indicatori nel DOM
    const kpiSection = html.querySelector('#kpi-heading')
    expect(fascia!.compareDocumentPosition(kpiSection!) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )

    // Ogni voce porta il suo pulsante di azione verso dove si risolve
    const pulsante = html.querySelector('[data-testid="attenzione-azione-certificato-rentri"]')
    expect(pulsante).not.toBeNull()
    expect(
      pulsante!.getAttribute('ng-reflect-router-link') ?? pulsante!.getAttribute('href')
    ).toBeTruthy()
  })

  it('non mostra alcuna fascia quando non ci sono voci: nessun riquadro vuoto', () => {
    setup()
    attenzioneService.getAttenzione.and.returnValue(of({ voci: [] }))

    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="attenzione-fascia"]')).toBeNull()
  })

  it('un errore nel caricamento delle voci di attenzione non rompe il resto del cruscotto', () => {
    setup()
    attenzioneService.getAttenzione.and.returnValue(throwError(() => new Error('boom')))

    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    expect(component.error).toBe('')
    expect(html.querySelector('.stat-grid')).not.toBeNull()
  })

  it('mostra la fascia con una voce di verifica fallita quando il controllo non riesce: "non lo so" non è "tutto a posto"', () => {
    setup()
    attenzioneService.getAttenzione.and.returnValue(throwError(() => new Error('Network error')))

    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    const fascia = html.querySelector('[data-testid="attenzione-fascia"]')
    expect(fascia).not.toBeNull()

    const voceErrore = html.querySelector('[data-testid="attenzione-voce-verifica-fallita"]')
    expect(voceErrore).not.toBeNull()
    // Testo dal punto di vista dell'utente, non un dettaglio tecnico di rete
    expect(voceErrore!.textContent).not.toContain('Network error')
    expect(voceErrore!.textContent?.toLowerCase()).toContain('non è stato possibile')

    // Azione di riprova che rilancia il controllo
    const riprova = html.querySelector(
      '[data-testid="attenzione-azione-verifica-fallita"] button'
    ) as HTMLButtonElement
    expect(riprova).not.toBeNull()

    attenzioneService.getAttenzione.calls.reset()
    riprova.click()
    expect(attenzioneService.getAttenzione).toHaveBeenCalledTimes(1)
  })

  it("mostra gli indicatori orientati all'azione (Task 3) con la stessa fascia generica, informativo incluso", () => {
    // Il template `*ngFor` legge solo chiave/gravita/titolo/dettaglio/azione:
    // le nuove voci del backend (formulari da trasmettere, numeri vidimati
    // pronti) non richiedono alcuna modifica al componente, compreso il caso
    // 'informativo' già supportato da etichettaGravita/getGravitaSeverity.
    setup()
    attenzioneService.getAttenzione.and.returnValue(
      of({
        voci: [
          voceAttenzione({
            chiave: 'formulari-da-trasmettere',
            gravita: 'avviso',
            titolo: 'Formulari da trasmettere a RENTRI',
            dettaglio: "3 in attesa di trasmissione all'ente",
            azione: { etichetta: 'Vedi formulari', rotta: '/fir' },
          }),
          voceAttenzione({
            chiave: 'scorta-vidimata-OP0001AAA000001-MI0001',
            gravita: 'informativo',
            titolo: 'Numeri vidimati pronti — Sede di Milano',
            dettaglio: '25 pronti su una soglia di 10',
            azione: { etichetta: 'Vedi scorta', rotta: '/rentri/blocchi' },
          }),
        ],
      })
    )

    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    const daTrasmettere = html.querySelector(
      '[data-testid="attenzione-voce-formulari-da-trasmettere"]'
    )
    expect(daTrasmettere).not.toBeNull()
    expect(daTrasmettere!.textContent).toContain('Formulari da trasmettere a RENTRI')
    expect(daTrasmettere!.querySelector('p-tag')?.getAttribute('aria-label')).toBe(
      'Gravità: Avviso'
    )

    const scorta = html.querySelector(
      '[data-testid="attenzione-voce-scorta-vidimata-OP0001AAA000001-MI0001"]'
    )
    expect(scorta).not.toBeNull()
    expect(scorta!.querySelector('p-tag')?.getAttribute('aria-label')).toBe('Gravità: Informativo')
  })

  describe('andamento mensile (Task 4)', () => {
    it("mostra il grafico dei formulari creati per mese con un'alternativa testuale per screen reader", () => {
      setup()
      andamentoService.getAndamento.and.returnValue(
        of({
          mesi: [
            { mese: '2026-08', conteggio: 5 },
            { mese: '2026-09', conteggio: 8 },
          ],
        })
      )

      fixture.detectChanges()

      const html: HTMLElement = fixture.nativeElement
      const grafico = html.querySelector('[data-testid="andamento-grafico"]')
      expect(grafico).not.toBeNull()
      // Etichetta "creati", non "emessi" (ruling PO giro di revisione 1): il
      // backend conta per data di creazione, non esiste un campo "data di
      // emissione" persistito — l'interfaccia deve dire il vero, non far
      // finta di mostrare un dato che non ha.
      expect(grafico!.getAttribute('aria-label')).toContain('formulari creati')

      // Alternativa testuale: un grafico che uno screen reader non sa
      // leggere non comunica niente, quindi dev'esserci SEMPRE, non solo in
      // caso di errore.
      const tabella = html.querySelector('[data-testid="andamento-tabella-testuale"]')
      expect(tabella).not.toBeNull()
      expect(tabella!.textContent).toContain('8')
      expect(tabella!.textContent).toContain('5')
    })

    it("un errore nel caricamento dell'andamento non rompe il resto del cruscotto", () => {
      setup()
      andamentoService.getAndamento.and.returnValue(throwError(() => new Error('boom')))

      fixture.detectChanges()

      const html: HTMLElement = fixture.nativeElement
      expect(component.error).toBe('')
      expect(html.querySelector('.stat-grid')).not.toBeNull()
      expect(html.querySelector('[data-testid="andamento-errore"]')).not.toBeNull()
    })

    it('senza formulari creati negli ultimi dodici mesi mostra uno stato vuoto, non un grafico piatto', () => {
      setup()
      andamentoService.getAndamento.and.returnValue(of(andamentoVuoto()))

      fixture.detectChanges()

      const html: HTMLElement = fixture.nativeElement
      expect(html.querySelector('[data-testid="andamento-grafico"]')).toBeNull()
      expect(html.querySelector('[data-testid="andamento-vuoto"]')).not.toBeNull()
      expect(html.querySelector('[data-testid="andamento-vuoto"]')!.textContent).toContain('creato')
    })
  })
})
