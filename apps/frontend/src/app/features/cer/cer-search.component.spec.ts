import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { CER, PaginatedCERResponse } from '../../shared/models/cer.model'
import { CerSearchComponent } from './cer-search.component'
import { CerService } from './cer.service'

/**
 * Task 9 (giro 2): il Catalogo CER ha le cifre a destra, «pericoloso» come segno nella riga
 * (asterisco del codice e pillola tenue) e non come colonna colorata.
 */
const cer = (over: Partial<CER> = {}): CER => ({
  code: '01 01 01',
  description: 'rifiuti prodotti dalle attivita di estrazione di minerali metalliferi',
  category: '01',
  isPericoloso: false,
  ...over,
})

const pagina = (items: CER[], total = items.length): PaginatedCERResponse => ({
  items,
  total,
  page: 1,
  limit: 20,
  totalPages: 1,
})

describe('CerSearchComponent (stile del giro 2)', () => {
  let fixture: ComponentFixture<CerSearchComponent>
  let servizio: jasmine.SpyObj<CerService>

  function monta(items: CER[], total = items.length): HTMLElement {
    servizio.getCERList.and.returnValue(of(pagina(items, total)))
    fixture = TestBed.createComponent(CerSearchComponent)
    fixture.detectChanges()
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  const righe = (el: HTMLElement) => Array.from(el.querySelectorAll('tbody tr.p-selectable-row'))

  beforeEach(() => {
    servizio = jasmine.createSpyObj<CerService>('CerService', [
      'getCERList',
      'getCERByCategory',
      'getCERPericolosi',
      'searchCER',
    ])
    TestBed.configureTestingModule({
      imports: [CerSearchComponent],
      providers: [provideNoopAnimations(), { provide: CerService, useValue: servizio }],
    })
  })

  it('tiene il titolo della pagina invariato', () => {
    const el = monta([cer()])
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Ricerca codici CER')
  })

  it('mette a destra le colonne numeriche (codice e categoria), intestazioni comprese', () => {
    const el = monta([cer(), cer({ code: '01 03 04*', isPericoloso: true })])
    const intestazioni = Array.from(el.querySelectorAll('thead th'))
    const num = intestazioni.filter(th => th.classList.contains('num-col'))
    expect(num.map(th => th.textContent?.trim())).toEqual(['Codice', 'Categoria'])
    for (const r of righe(el)) {
      expect(r.querySelector('td.num-col .cell-mono')).not.toBeNull()
      expect(r.querySelectorAll('td.num-col').length).toBe(2)
    }
  })

  it('un CER pericoloso ha l asterisco nel codice e la pillola «Pericoloso»', () => {
    const el = monta([cer({ code: '01 03 04*', isPericoloso: true })])
    const riga = righe(el)[0]
    expect(riga.querySelector('td.num-col')?.textContent).toContain('*')
    const pillola = riga.querySelector('.pillola-pericoloso')
    expect(pillola?.textContent?.trim()).toBe('Pericoloso')
  })

  it('un CER non pericoloso non ha ne asterisco ne pillola, e non c e una colonna «Non pericoloso»', () => {
    const el = monta([cer()])
    const riga = righe(el)[0]
    expect(riga.querySelector('td.num-col')?.textContent).not.toContain('*')
    expect(riga.querySelector('.pillola-pericoloso')).toBeNull()
    expect(el.textContent).not.toContain('Non pericoloso')
    const titoli = Array.from(el.querySelectorAll('thead th')).map(th => th.textContent?.trim())
    expect(titoli).not.toContain('Pericoloso')
  })

  it('la pillola usa la tinta err tenue del tema, mai un fondo pieno', () => {
    const el = monta([cer({ code: '01 03 04*', isPericoloso: true })])
    const pillola = el.querySelector('.pillola-pericoloso') as HTMLElement
    const sonda = document.createElement('i')
    document.body.appendChild(sonda)
    const colore = (token: string) => {
      sonda.style.backgroundColor = getComputedStyle(document.documentElement)
        .getPropertyValue(token)
        .trim()
      return getComputedStyle(sonda).backgroundColor
    }
    expect(getComputedStyle(pillola).backgroundColor).toBe(colore('--stato-err-bg'))
    expect(getComputedStyle(pillola).height).toBe('22px')
    sonda.remove()
  })

  it('il bottone del dropdown dell autocomplete non e un blocco pieno d inchiostro', () => {
    const el = monta([cer()])
    const bottone = el.querySelector('.p-autocomplete-dropdown') as HTMLElement
    expect(bottone).not.toBeNull()
    const sonda = document.createElement('i')
    document.body.appendChild(sonda)
    sonda.style.backgroundColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--ink-fill')
      .trim()
    const inchiostro = getComputedStyle(sonda).backgroundColor
    sonda.remove()
    const fondo = getComputedStyle(bottone).backgroundColor
    expect(fondo).not.toBe(inchiostro)
    // senza il tema Aura (Karma carica solo styles.scss) vale la regola di _primeng.scss:
    // il bottone e' un'appendice del campo, col fondo del campo o senza fondo, mai pieno
    sonda.style.backgroundColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--surface-section')
      .trim()
    document.body.appendChild(sonda)
    const campo = getComputedStyle(sonda).backgroundColor
    sonda.remove()
    expect(['rgba(0, 0, 0, 0)', 'transparent', campo]).toContain(fondo)
  })

  it('segue il pattern delle liste: nessun min-width fisso, righe a due linee sul telefono', () => {
    const el = monta([cer()])
    const tabella = el.querySelector('.p-datatable') as HTMLElement
    expect(tabella.classList.contains('lista-telefono')).toBeTrue()
    expect(el.querySelector('table')?.getAttribute('style') ?? '').not.toContain('min-width')
    const riga = righe(el)[0]
    expect(riga.querySelector('td.m2')).not.toBeNull()
    expect(riga.querySelector('td.m-hide')).not.toBeNull()
  })

  it('con una sola pagina non mostra il paginatore, con zero righe nemmeno', () => {
    const una = monta([cer()])
    expect(una.querySelector('.p-paginator')).toBeNull()
    fixture.destroy()
    const zero = monta([])
    expect(zero.querySelector('.p-paginator')).toBeNull()
    expect(zero.querySelector('.p-datatable.senza-righe')).not.toBeNull()
    expect(zero.textContent).toContain('Nessun codice CER trovato')
  })

  it('con piu pagine il paginatore c e', () => {
    const molte = Array.from({ length: 20 }, (_, i) => cer({ code: `01 01 ${i + 10}` }))
    const el = monta(molte, 60)
    expect(el.querySelector('.p-paginator')).not.toBeNull()
  })
})
