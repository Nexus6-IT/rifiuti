import { TestBed } from '@angular/core/testing'
import { AnalisiSintesiComponent } from './analisi-sintesi.component'
import { celleAnalisi } from './dashboard-dati'
import { coloreDelToken, dashboardFixture, dashboardSenzaFir } from './dashboard-fixture'

describe('AnalisiSintesiComponent', () => {
  const mesi = [
    { mese: '2026-10', conteggio: 32 },
    { mese: '2026-11', conteggio: 41 },
  ]

  function crea(input: Partial<AnalisiSintesiComponent>): HTMLElement {
    const fixture = TestBed.createComponent(AnalisiSintesiComponent)
    Object.assign(fixture.componentInstance, input)
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  it('quattro celle in un solo contenitore diviso, nessuna icona', () => {
    const el = crea({ celle: celleAnalisi(dashboardFixture(), mesi) })
    expect(el.querySelectorAll('.striscia').length).toBe(1)
    expect(el.querySelectorAll('.cella').length).toBe(4)
    expect(el.querySelector('i, .pi, svg, canvas')).toBeNull()
  })

  it('senza modulo rentri: tre celle, anche nello scheletro, nessuna RENTRI', () => {
    const el = crea({ celle: celleAnalisi(dashboardFixture(), mesi, false), conRentri: false })
    expect(el.querySelectorAll('.cella').length).toBe(3)
    expect(el.textContent).not.toContain('RENTRI')
    const sk = crea({ caricamento: true, conRentri: false })
    expect(sk.querySelectorAll('.cella').length).toBe(3)
    expect(sk.textContent).not.toContain('RENTRI')
  })

  it('sotto 992 px con tre celle l’ultima occupa tutta la riga: nessun buco nella griglia', () => {
    if (window.innerWidth >= 992) {
      pending('serve una finestra sotto 992 px')
      return
    }
    for (const sk of [false, true]) {
      const el = crea({
        celle: sk ? [] : celleAnalisi(dashboardFixture(), mesi, false),
        caricamento: sk,
        conRentri: false,
      })
      const striscia = el.querySelector('.striscia') as HTMLElement
      const celle = Array.from(el.querySelectorAll<HTMLElement>('.cella'))
      expect(celle.length).toBe(3)
      const larghezza = striscia.getBoundingClientRect().width
      expect(celle[2].getBoundingClientRect().width).toBeGreaterThan(larghezza * 0.95)
      expect(celle[0].getBoundingClientRect().width).toBeLessThan(larghezza * 0.6)
    }
  })

  it('le cifre e il livello di conformità come pillola', () => {
    const d = dashboardFixture()
    const el = crea({ celle: celleAnalisi(d, mesi), livello: { parola: 'Buona', tono: 'ok' } })
    const conformita = el.querySelector('[data-testid="analisi-conformita"]') as HTMLElement
    expect(conformita.querySelector('.cella__v')?.textContent?.trim()).toBe('82%')
    expect(conformita.querySelector('.pillola')?.textContent?.trim()).toBe('Buona')
    expect(el.querySelector('[data-testid="analisi-andamento"]')?.textContent).toContain(
      '41 questo mese'
    )
    expect(el.querySelector('[data-testid="analisi-andamento"]')?.textContent).toContain(
      '+28% sul mese scorso'
    )
  })

  it('cella vuota: «—» in grigio terziario e nessuna pillola', () => {
    const celle = celleAnalisi(dashboardSenzaFir(), [])
    const el = crea({ celle, livello: null })
    const cella = el.querySelector('[data-testid="analisi-conformita"]') as HTMLElement
    expect(cella.classList).toContain('cella--vuota')
    expect(cella.querySelector('.cella__v')?.textContent?.trim()).toBe('—')
    expect(el.querySelector('.pillola')).toBeNull()
    expect(getComputedStyle(cella.querySelector('.cella__v') as HTMLElement).color).toBe(
      coloreDelToken('--text-tertiary')
    )
    expect(cella.textContent).toContain('Si calcola dal primo formulario')
  })

  it('una cella con dato ha il valore in inchiostro, non in grigio', () => {
    const el = crea({ celle: celleAnalisi(dashboardFixture(), mesi) })
    const v = el.querySelector('[data-testid="analisi-firme"] .cella__v') as HTMLElement
    expect(getComputedStyle(v).color).toBe(coloreDelToken('--text-primary'))
  })

  it('durante il caricamento restano le etichette e nessun valore', () => {
    const el = crea({ caricamento: true })
    expect(Array.from(el.querySelectorAll('.cella__l')).map(e => e.textContent?.trim())).toEqual([
      'Conformità',
      'Firme',
      'RENTRI',
      'Andamento',
    ])
    expect(el.querySelector('.cella__v')).toBeNull()
  })
})
