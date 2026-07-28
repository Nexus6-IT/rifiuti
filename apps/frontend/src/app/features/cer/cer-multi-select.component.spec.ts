import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of, throwError } from 'rxjs'
import { CerMultiSelectComponent } from './cer-multi-select.component'
import { CerService } from './cer.service'
import { CERSearchResult } from '../../shared/models/cer.model'

function risultato(over: Partial<CERSearchResult> = {}): CERSearchResult {
  return {
    code: '15 01 06',
    description: 'Imballaggi in materiali misti',
    isPericoloso: false,
    ...over,
  }
}

const evento = (query: string) => ({ query, originalEvent: new Event('input') }) as never

describe('CerMultiSelectComponent', () => {
  let fixture: ComponentFixture<CerMultiSelectComponent>
  let component: CerMultiSelectComponent
  let service: jasmine.SpyObj<CerService>

  beforeEach(() => {
    service = jasmine.createSpyObj<CerService>('CerService', ['searchCER'])
    service.searchCER.and.returnValue(of([risultato()]))

    TestBed.configureTestingModule({
      imports: [CerMultiSelectComponent],
      providers: [{ provide: CerService, useValue: service }],
    })

    fixture = TestBed.createComponent(CerMultiSelectComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  /**
   * Stessa classe di difetto corretta in AnagraficaSelectComponent:
   * p-autoComplete spegne l'indicatore di caricamento solo vedendo CAMBIARE
   * l'input `suggestions`. Riassegnare lo stesso array lascia il menu a girare
   * a vuoto. Qui si verifica l'IDENTITA', non solo il contenuto.
   */
  it('ogni ricerca emette un array NUOVO', () => {
    component.cerca(evento('1501'))
    const primo = component.suggestions()

    component.cerca(evento('1501'))

    expect(component.suggestions()).not.toBe(primo)
  })

  it('anche due query vuote consecutive danno array distinti', () => {
    component.cerca(evento(''))
    const primo = component.suggestions()

    component.cerca(evento(''))

    expect(component.suggestions()).not.toBe(primo)
    expect(component.suggestions()).toEqual([])
  })

  it('con query vuota non interroga il servizio', () => {
    component.cerca(evento('   '))

    expect(service.searchCER).not.toHaveBeenCalled()
  })

  it('per difetto cerca solo i codici confermati da RENTRI', () => {
    component.cerca(evento('150106'))

    expect(service.searchCER).toHaveBeenCalledWith('150106', true)
  })

  it('esclude dai suggerimenti i codici gia scelti', () => {
    service.searchCER.and.returnValue(of([risultato(), risultato({ code: '15 01 07' })]))
    component.onSelezioneCambiata([
      { code: '15 01 06', description: '', isPericoloso: false, label: '15 01 06' },
    ])

    component.cerca(evento('1501'))

    expect(component.suggestions().map(s => s.code)).toEqual(['15 01 07'])
  })

  it('emette i codici come stringhe, non gli oggetti', () => {
    const emessi: string[][] = []
    component.registerOnChange(v => emessi.push(v))

    component.onSelezioneCambiata([
      { code: '15 01 06', description: 'x', isPericoloso: false, label: '15 01 06 — x' },
      { code: '15 01 07', description: 'y', isPericoloso: false, label: '15 01 07 — y' },
    ])

    expect(emessi).toEqual([['15 01 06', '15 01 07']])
  })

  it('la rimozione di tutti i token emette un array vuoto, non null', () => {
    const emessi: string[][] = []
    component.registerOnChange(v => emessi.push(v))

    component.onSelezioneCambiata(null as never)

    expect(emessi).toEqual([[]])
  })

  it('un valore preimpostato mostra subito i codici', () => {
    component.writeValue(['15 01 06', '20 03 01'])

    expect(component.selected.map(s => s.code)).toEqual(['15 01 06', '20 03 01'])
  })

  it('se il catalogo non risponde non lascia suggerimenti sporchi', () => {
    service.searchCER.and.returnValue(throwError(() => new Error('offline')))

    component.cerca(evento('1501'))

    expect(component.suggestions()).toEqual([])
  })
})
