import { TestBed } from '@angular/core/testing'
import { ClassificaDitteComponent } from './classifica-ditte.component'
import { LOCALE_IT } from './dashboard-fixture'

describe('ClassificaDitteComponent', () => {
  function crea(input: Partial<ClassificaDitteComponent>): HTMLElement {
    TestBed.configureTestingModule({ providers: [LOCALE_IT] })
    const fixture = TestBed.createComponent(ClassificaDitteComponent)
    Object.assign(fixture.componentInstance, { titolo: 'Produttori più frequenti', ...input })
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  const voci = [
    { nome: 'Acciaierie Valdelsa S.p.A.', partitaIva: '01234567890', conteggio: 12 },
    { nome: '09876543210', partitaIva: '09876543210', conteggio: 3 },
  ]

  it('ragione sociale in testa, P. IVA in grigio mono sotto, conteggio a destra', () => {
    const el = crea({ voci })
    const prima = el.querySelectorAll('li')[0]
    expect(prima.querySelector('.ditta__nome')?.textContent?.trim()).toBe(
      'Acciaierie Valdelsa S.p.A.'
    )
    const piva = prima.querySelector('.ditta__piva') as HTMLElement
    expect(piva.textContent?.trim()).toBe('01234567890')
    expect(piva.classList).toContain('mono')
    expect(prima.querySelector('.conteggio')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      '12 FIR'
    )
  })

  it('senza ragione sociale la P. IVA fa da nome e non si ripete in grigio', () => {
    const el = crea({ voci })
    const seconda = el.querySelectorAll('li')[1]
    expect(seconda.querySelector('.ditta__nome')?.textContent?.trim()).toBe('09876543210')
    expect(seconda.querySelector('.ditta__piva')).toBeNull()
  })

  it('il rango è testo «1.», «2.», senza cerchi colorati', () => {
    const el = crea({ voci })
    expect(Array.from(el.querySelectorAll('.rango')).map(r => r.textContent?.trim())).toEqual([
      '1.',
      '2.',
    ])
    const rango = el.querySelector('.rango') as HTMLElement
    expect(getComputedStyle(rango).borderRadius).not.toBe('50%')
    expect(getComputedStyle(rango).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  })

  it('senza voci: cornice con titolo e una riga di testo', () => {
    const el = crea({ voci: [] })
    expect(el.querySelector('.card h3')?.textContent?.trim()).toBe('Produttori più frequenti')
    expect(el.querySelector('.vuoto')?.textContent?.trim()).toBe('Nessun formulario registrato')
    expect(el.querySelector('.pi, .empty-state')).toBeNull()
  })
})
