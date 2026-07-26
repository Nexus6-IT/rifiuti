import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of } from 'rxjs'
import { CerSelectComponent } from './cer-select.component'
import { CerService } from './cer.service'
import { CERSearchResult } from '../../shared/models/cer.model'

function risultato(overrides: Partial<CERSearchResult> = {}): CERSearchResult {
  return {
    code: '15 01 06',
    description: 'Imballaggi in materiali misti',
    isPericoloso: false,
    ...overrides,
  }
}

describe('CerSelectComponent', () => {
  let fixture: ComponentFixture<CerSelectComponent>
  let component: CerSelectComponent
  let service: jasmine.SpyObj<CerService>

  beforeEach(() => {
    service = jasmine.createSpyObj<CerService>('CerService', ['searchCER'])
    service.searchCER.and.returnValue(of([risultato()]))

    TestBed.configureTestingModule({
      imports: [CerSelectComponent],
      providers: [{ provide: CerService, useValue: service }],
    })

    fixture = TestBed.createComponent(CerSelectComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('per default (form di creazione, R4 Task 7) cerca SOLO codici presenti in RENTRI', () => {
    component.searchCer({ query: '150106', originalEvent: new Event('input') } as any)

    expect(service.searchCER).toHaveBeenCalledWith('150106', true)
  })

  it('con soloPresentiInRentri=false (uso futuro su storico) non applica il filtro', () => {
    component.soloPresentiInRentri = false

    component.searchCer({ query: '150106', originalEvent: new Event('input') } as any)

    expect(service.searchCER).toHaveBeenCalledWith('150106', false)
  })

  it('writeValue (precompilazione di un codice esistente, es. edit) risolve SENZA filtro presenteInRentri: un codice storico deve restare visibile', () => {
    component.writeValue('15 01 06')

    // Chiamata di risoluzione della descrizione: nessun secondo argomento,
    // a differenza della ricerca interattiva.
    expect(service.searchCER).toHaveBeenCalledWith('15 01 06')
  })

  it('una query vuota non chiama il backend', () => {
    service.searchCER.calls.reset()
    component.searchCer({ query: '', originalEvent: new Event('input') } as any)

    expect(service.searchCER).not.toHaveBeenCalled()
    expect(component.suggestions).toEqual([])
  })
})
