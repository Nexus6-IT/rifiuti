import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of, throwError } from 'rxjs'
import { AnagraficaSelectComponent } from './anagrafica-select.component'
import { RegistryService } from './registry.service'

function pagina(items: any[]) {
  return of({ items, total: items.length, page: 1, limit: 500, totalPages: 1 } as any)
}

const ACME = { id: 'p1', ragioneSociale: 'ACME SPA', partitaIVA: '01234567890' }
const BETA = { id: 'p2', ragioneSociale: 'BETA SRL', partitaIVA: '09876543210' }

describe('AnagraficaSelectComponent', () => {
  let fixture: ComponentFixture<AnagraficaSelectComponent>
  let component: AnagraficaSelectComponent
  let registry: jasmine.SpyObj<RegistryService>

  beforeEach(() => {
    registry = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
    ])
    registry.getProduttori.and.returnValue(pagina([ACME, BETA]))
    registry.getTrasportatori.and.returnValue(pagina([]))
    registry.getDestinatari.and.returnValue(pagina([]))

    TestBed.configureTestingModule({
      imports: [AnagraficaSelectComponent],
      providers: [{ provide: RegistryService, useValue: registry }],
    })

    fixture = TestBed.createComponent(AnagraficaSelectComponent)
    component = fixture.componentInstance
  })

  it('carica il registro indicato, non gli altri', () => {
    component.registro = 'trasportatori'
    fixture.detectChanges()

    expect(registry.getTrasportatori).toHaveBeenCalled()
    expect(registry.getProduttori).not.toHaveBeenCalled()
  })

  it('ricarica quando il registro cambia', () => {
    component.registro = 'trasportatori'
    fixture.detectChanges()
    component.registro = 'destinatari'

    expect(registry.getDestinatari).toHaveBeenCalled()
  })

  it('cerca per ragione sociale', () => {
    fixture.detectChanges()
    component.cerca({ query: 'beta', originalEvent: new Event('input') } as any)

    expect(component.suggestions().map(s => s.id)).toEqual(['p2'])
  })

  it('cerca anche per partita IVA', () => {
    fixture.detectChanges()
    component.cerca({ query: '0123456', originalEvent: new Event('input') } as any)

    expect(component.suggestions().map(s => s.id)).toEqual(['p1'])
  })

  /**
   * Regressione: con query vuota (il semplice click sulla tendina) i
   * suggerimenti venivano riassegnati con LO STESSO array. p-autoComplete
   * spegne il proprio indicatore di caricamento solo vedendo cambiare l'input
   * `suggestions`: stesso riferimento = nessun cambiamento = menu che gira a
   * vuoto per sempre. Non basta controllare il contenuto, va controllata
   * l'identita' dell'array.
   */
  it('con query vuota emette un array NUOVO (altrimenti il menu resta a caricare)', () => {
    fixture.detectChanges()
    const primaDelClick = component.suggestions()

    component.cerca({ query: '', originalEvent: new Event('input') } as any)

    expect(component.suggestions()).not.toBe(primaDelClick)
    expect(component.suggestions().map(s => s.id)).toEqual(['p1', 'p2'])
  })

  it("i suggerimenti non condividono l'array con le voci caricate", () => {
    fixture.detectChanges()

    expect(component.suggestions()).not.toBe(component.voci())
    expect(component.suggestions().map(s => s.id)).toEqual(component.voci().map(s => s.id))
  })

  it('due click consecutivi danno due array distinti', () => {
    fixture.detectChanges()
    component.cerca({ query: '', originalEvent: new Event('input') } as any)
    const primo = component.suggestions()

    component.cerca({ query: '', originalEvent: new Event('input') } as any)

    expect(component.suggestions()).not.toBe(primo)
  })

  it("emette l'id, non l'oggetto, alla selezione", () => {
    fixture.detectChanges()
    const emessi: string[] = []
    component.registerOnChange(v => emessi.push(v))

    component.onSelezione({ ...ACME, label: 'ACME SPA — 01234567890' })

    expect(emessi).toEqual(['p1'])
  })

  describe('registro con una sola voce', () => {
    beforeEach(() => {
      registry.getProduttori.and.returnValue(pagina([ACME]))
    })

    it('la preseleziona ed emette il suo id', () => {
      const emessi: string[] = []
      fixture = TestBed.createComponent(AnagraficaSelectComponent)
      component = fixture.componentInstance
      component.registerOnChange(v => emessi.push(v))
      fixture.detectChanges()

      expect(emessi).toEqual(['p1'])
    })

    it('non preseleziona se disattivato', () => {
      const emessi: string[] = []
      fixture = TestBed.createComponent(AnagraficaSelectComponent)
      component = fixture.componentInstance
      component.preselezionaSeUnica = false
      component.registerOnChange(v => emessi.push(v))
      fixture.detectChanges()

      expect(emessi).toEqual([])
    })
  })

  it('con registro vuoto non preseleziona nulla e resta senza voci', () => {
    registry.getProduttori.and.returnValue(pagina([]))
    fixture = TestBed.createComponent(AnagraficaSelectComponent)
    component = fixture.componentInstance
    fixture.detectChanges()

    expect(component.voci().length).toBe(0)
    expect(component.caricato()).toBeTrue()
  })

  it('un id impostato prima del caricamento viene risolto dopo', () => {
    fixture = TestBed.createComponent(AnagraficaSelectComponent)
    component = fixture.componentInstance
    component.writeValue('p2')
    fixture.detectChanges()

    expect((component.selected as any)?.ragioneSociale).toBe('BETA SRL')
  })

  it('se il registro non risponde non resta bloccato in caricamento', () => {
    registry.getProduttori.and.returnValue(throwError(() => new Error('offline')))
    fixture = TestBed.createComponent(AnagraficaSelectComponent)
    component = fixture.componentInstance
    fixture.detectChanges()

    expect(component.caricato()).toBeTrue()
  })
})
