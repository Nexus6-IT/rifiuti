import { TestBed } from '@angular/core/testing'
import { BarreOrizzontaliComponent } from './barre-orizzontali.component'
import { LOCALE_IT } from './dashboard-fixture'

describe('BarreOrizzontaliComponent', () => {
  function crea(input: Partial<BarreOrizzontaliComponent>): HTMLElement {
    TestBed.configureTestingModule({ providers: [LOCALE_IT] })
    const fixture = TestBed.createComponent(BarreOrizzontaliComponent)
    Object.assign(fixture.componentInstance, { titolo: 'Top 10 codici CER', ...input })
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  const voci = [
    { etichetta: '17 04 05', valore: 31000, mono: true },
    { etichetta: '15 01 06', valore: 12400, mono: true },
    { etichetta: '08 01 11*', valore: 3100, mono: true },
  ]

  it('la larghezza è valore / massimo (12.400 su 31.000 kg = 40%)', () => {
    const el = crea({ voci })
    const larghezze = Array.from(el.querySelectorAll<HTMLElement>('.barra__riempi')).map(
      r => r.style.width
    )
    expect(larghezze).toEqual(['100%', '40%', '10%'])
  })

  it("il testo del valore ha il punto delle migliaia e l'unità", () => {
    const el = crea({ voci })
    expect(el.querySelectorAll('.barra__v')[1].textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '12.400 kg'
    )
  })

  it('i codici CER sono in mono', () => {
    const el = crea({ voci })
    expect(el.querySelector('.barra__e')?.classList).toContain('mono')
  })

  it('un solo colore di riempimento per tutte le barre, senza i vecchi colori dei grafici (bug 4)', () => {
    const el = crea({ voci })
    const colori = new Set(
      Array.from(el.querySelectorAll('.barra__riempi')).map(
        r => getComputedStyle(r).backgroundColor
      )
    )
    expect(colori.size).toBe(1)
    expect(el.innerHTML).not.toMatch(/#0f766e|#1d4ed8/i)
    expect(el.querySelector('canvas')).toBeNull()
  })

  it('senza voci: cornice, titolo e una riga di testo, nessuna icona', () => {
    const el = crea({ voci: [] })
    expect(el.querySelector('.card h3')?.textContent?.trim()).toBe('Top 10 codici CER')
    expect(el.querySelector('.vuoto')?.textContent?.trim()).toBe('Nessun formulario registrato')
    expect(el.querySelector('.pi, .empty-state')).toBeNull()
  })

  it('tutte le voci a zero non producono barre piene', () => {
    const el = crea({
      voci: [
        { etichetta: 'Recupero', valore: 0 },
        { etichetta: 'Smaltimento', valore: 0 },
      ],
    })
    expect(
      Array.from(el.querySelectorAll<HTMLElement>('.barra__riempi')).map(r => r.style.width)
    ).toEqual(['0%', '0%'])
  })
})
