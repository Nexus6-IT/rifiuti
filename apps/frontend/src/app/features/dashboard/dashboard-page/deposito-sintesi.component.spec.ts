import { TestBed } from '@angular/core/testing'
import { DepositoTemporaneoVista } from '../../giacenze/giacenze.service'
import { DepositoSintesiComponent } from './deposito-sintesi.component'
import { LOCALE_IT, depositoFixture, registroFixture } from './dashboard-fixture'

describe('DepositoSintesiComponent', () => {
  function crea(input: {
    vista?: DepositoTemporaneoVista | null
    caricamento?: boolean
    errore?: boolean
  }): HTMLElement {
    TestBed.configureTestingModule({ providers: [LOCALE_IT] })
    const fixture = TestBed.createComponent(DepositoSintesiComponent)
    Object.assign(fixture.componentInstance, input)
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  const quantitativo = (): DepositoTemporaneoVista =>
    depositoFixture([
      registroFixture({
        soglie: { ...registroFixture().soglie, criterio: 'QUANTITATIVO' },
        totalePericolosiKg: 6400,
        totaleKg: 17900,
        avvisi: [
          {
            tipo: 'DURATA_ANNUALE',
            livello: 'PREAVVISO',
            cerCode: '08 01 11*',
            valore: 89,
            soglia: 92,
            unita: 'giorni',
            giornoPiuVecchio: '2026-08-08',
            scadenza: '2026-11-08',
            messaggio: 'm',
          },
        ],
      }),
    ])

  it('tre barre con aria-valuenow e aria-valuemax e la larghezza a rapporto vero', () => {
    const el = crea({ vista: quantitativo() })
    const piste = Array.from(el.querySelectorAll<HTMLElement>('[role="progressbar"]'))
    expect(piste.length).toBe(3)
    expect(piste[0].getAttribute('aria-valuenow')).toBe('6400')
    expect(piste[0].getAttribute('aria-valuemax')).toBe('10000')
    expect((piste[0].querySelector('.barra__riempi') as HTMLElement).style.width).toBe('64%')
  })

  it("i numeri hanno il separatore delle migliaia e l'unità", () => {
    const el = crea({ vista: quantitativo() })
    const testo = el.querySelector('.barra__top')?.textContent?.replace(/\s+/g, ' ')
    expect(testo).toContain('6.400 di 10.000 kg')
  })

  it('la barra in allarme ha la classe barra--allarme e la sua nota', () => {
    const el = crea({ vista: quantitativo() })
    const barre = Array.from(el.querySelectorAll<HTMLElement>('[data-testid="deposito-barra"]'))
    const allarme = barre.filter(b => b.classList.contains('barra--allarme'))
    expect(allarme.length).toBe(1)
    expect(allarme[0].textContent).toContain('Giacenza più vecchia')
    expect(allarme[0].textContent).toContain('89 di 92 giorni')
    expect(allarme[0].querySelector('.barra__nota')?.textContent).toContain(
      '08 01 11* · entro il 08/11'
    )
  })

  it('un valore oltre il limite resta la barra intera (100%)', () => {
    const v = depositoFixture([
      registroFixture({
        soglie: { ...registroFixture().soglie, criterio: 'QUANTITATIVO' },
        totaleKg: 45000,
      }),
    ])
    const el = crea({ vista: v })
    const riempi = el.querySelectorAll<HTMLElement>('.barra__riempi')[1]
    expect(riempi.style.width).toBe('100%')
  })

  it('senza registri: «Nessun deposito da controllare» dentro la card', () => {
    const el = crea({ vista: depositoFixture([]) })
    expect(el.querySelector('.card [data-testid="deposito-vuoto"]')?.textContent?.trim()).toBe(
      'Nessun deposito da controllare'
    )
    expect(el.querySelector('[role="progressbar"]')).toBeNull()
  })

  it('durante il caricamento ha titolo e cornice e nessuna cifra', () => {
    const el = crea({ vista: null, caricamento: true })
    expect(el.querySelector('h2')?.textContent?.trim()).toBe('Deposito temporaneo')
    expect(el.querySelector('[role="progressbar"]')).toBeNull()
    expect(el.querySelector('.barra__top')).toBeNull()
  })

  it('con un errore lo dice senza dichiarare il deposito vuoto', () => {
    const el = crea({ vista: null, errore: true })
    expect(el.querySelector('[data-testid="deposito-errore"]')).toBeTruthy()
    expect(el.querySelector('[data-testid="deposito-vuoto"]')).toBeNull()
  })
})
