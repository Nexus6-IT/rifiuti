import { ComponentFixture, TestBed } from '@angular/core/testing'
import { RouterTestingModule } from '@angular/router/testing'
import { of, throwError } from 'rxjs'

import { DashboardComponent } from './dashboard.component'
import { FirService } from '../fir/fir.service'
import { AttenzioneService, VoceAttenzione } from './attenzione.service'
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

describe('DashboardComponent', () => {
  let fixture: ComponentFixture<DashboardComponent>
  let component: DashboardComponent
  let firService: jasmine.SpyObj<FirService>
  let attenzioneService: jasmine.SpyObj<AttenzioneService>

  function setup(): void {
    firService = jasmine.createSpyObj<FirService>('FirService', ['getFIRList'])
    firService.getFIRList.and.returnValue(of(paginaFIRVuota()))

    attenzioneService = jasmine.createSpyObj<AttenzioneService>('AttenzioneService', [
      'getAttenzione',
    ])
    attenzioneService.getAttenzione.and.returnValue(of({ voci: [] }))

    TestBed.configureTestingModule({
      imports: [DashboardComponent, RouterTestingModule],
      providers: [
        { provide: FirService, useValue: firService },
        { provide: AttenzioneService, useValue: attenzioneService },
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
    expect(html.querySelector('[data-testid="attenzione-fascia"]')).toBeNull()
    expect(component.error).toBe('')
    expect(html.querySelector('.stat-grid')).not.toBeNull()
  })
})
