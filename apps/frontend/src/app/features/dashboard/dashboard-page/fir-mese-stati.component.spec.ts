import { TestBed } from '@angular/core/testing'
import { FIRStato } from '../../../shared/models/fir.model'
import { FirMeseStatiComponent } from './fir-mese-stati.component'
import { LOCALE_IT } from './dashboard-fixture'

describe('FirMeseStatiComponent', () => {
  const conteggi = {
    [FIRStato.BOZZA]: 4,
    [FIRStato.EMESSO]: 6,
    [FIRStato.IN_TRANSITO]: 9,
    [FIRStato.CONSEGNATO]: 21,
    [FIRStato.ANNULLATO]: 1,
  }

  function crea(input: Partial<FirMeseStatiComponent>): HTMLElement {
    TestBed.configureTestingModule({ providers: [LOCALE_IT] })
    const fixture = TestBed.createComponent(FirMeseStatiComponent)
    Object.assign(fixture.componentInstance, { mese: new Date(2026, 10, 5), ...input })
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  const celle = (el: HTMLElement): HTMLElement[] =>
    Array.from(el.querySelectorAll<HTMLElement>('.cella'))

  it('il titolo dice il mese e il totale, somma delle cinque celle', () => {
    const el = crea({ conteggi })
    expect(el.querySelector('h2')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'FIR di novembre · 41'
    )
  })

  it("cinque celle nell'ordine Bozza, Emesso, In transito, Consegnato, Annullato", () => {
    const el = crea({ conteggi })
    const lista = celle(el)
    expect(lista.map(c => c.querySelector('.cella__l')?.textContent?.trim())).toEqual([
      'Bozza',
      'Emesso',
      'In transito',
      'Consegnato',
      'Annullato',
    ])
    expect(lista.map(c => c.querySelector('.cella__v')?.textContent?.trim())).toEqual([
      '4',
      '6',
      '9',
      '21',
      '1',
    ])
  })

  it('lo zero si stampa come «0»', () => {
    const el = crea({ conteggi: { ...conteggi, [FIRStato.ANNULLATO]: 0 } })
    expect(celle(el)[4].querySelector('.cella__v')?.textContent?.trim()).toBe('0')
  })

  it('il tono del pallino segue lo stato, non la posizione (bug 3)', () => {
    const el = crea({ conteggi })
    const toni = (e: HTMLElement): string[] =>
      celle(e).map(c => Array.from(c.classList).find(k => k.startsWith('tono-')) ?? '')
    expect(toni(el)).toEqual(['tono-none', 'tono-todo', 'tono-warn', 'tono-ok', 'tono-none'])
    // Chiavi dell'oggetto in ordine rimescolato: i toni per stato non cambiano.
    TestBed.resetTestingModule()
    const rimescolato = {
      [FIRStato.ANNULLATO]: 1,
      [FIRStato.CONSEGNATO]: 21,
      [FIRStato.BOZZA]: 4,
      [FIRStato.IN_TRANSITO]: 9,
      [FIRStato.EMESSO]: 6,
    }
    expect(toni(crea({ conteggi: rimescolato }))).toEqual(toni(el))
  })

  it('senza dati stampa cinque zeri e il totale 0', () => {
    const el = crea({ conteggi: null })
    expect(celle(el).map(c => c.querySelector('.cella__v')?.textContent?.trim())).toEqual([
      '0',
      '0',
      '0',
      '0',
      '0',
    ])
    expect(el.querySelector('h2')?.textContent).toContain('· 0')
  })

  it('durante il caricamento ha titolo e cornice e nessun «0» provvisorio', () => {
    const el = crea({ conteggi: null, caricamento: true })
    expect(el.querySelector('h2')?.textContent?.trim()).toBe('FIR di novembre')
    expect(celle(el).length).toBe(5)
    expect(el.querySelector('.cella__v')).toBeNull()
    expect(el.textContent).not.toMatch(/\b0\b/)
  })

  it('con un errore dice che non ha potuto caricare e non stampa cifre', () => {
    const el = crea({ errore: true })
    expect(el.querySelector('[data-testid="fir-mese-errore"]')).toBeTruthy()
    expect(el.querySelector('.cella__v')).toBeNull()
  })
})
