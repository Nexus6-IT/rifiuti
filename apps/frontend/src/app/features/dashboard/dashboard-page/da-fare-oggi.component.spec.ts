import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { VoceAttenzione } from '../attenzione.service'
import { DaFareOggiComponent } from './da-fare-oggi.component'

function voce(over: Partial<VoceAttenzione> = {}): VoceAttenzione {
  return {
    chiave: 'autorizzazione',
    gravita: 'avviso',
    titolo: 'Autorizzazione XYZ in scadenza',
    dettaglio: 'scade fra 12 giorni',
    azione: { etichetta: 'Vedi trasportatori', rotta: '/trasportatori' },
    ...over,
  }
}

describe('DaFareOggiComponent', () => {
  let fixture: ComponentFixture<DaFareOggiComponent>

  function crea(input: Partial<DaFareOggiComponent>): HTMLElement {
    TestBed.configureTestingModule({
      imports: [DaFareOggiComponent],
      providers: [provideRouter([])],
    })
    fixture = TestBed.createComponent(DaFareOggiComponent)
    Object.assign(fixture.componentInstance, input)
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  it('con voci mostra la fascia «Da fare oggi» e una riga per voce con titolo e dettaglio', () => {
    const el = crea({
      voci: [
        voce(),
        voce({
          chiave: 'certificato-rentri',
          gravita: 'critico',
          titolo: 'Certificato scaduto',
          dettaglio: 'ieri',
        }),
      ],
    })

    const fascia = el.querySelector('[data-testid="attenzione-fascia"]')
    expect(fascia).toBeTruthy()
    expect(fascia?.querySelector('h2')?.textContent?.trim()).toBe('Da fare oggi')
    const righe = el.querySelectorAll('li')
    expect(righe.length).toBe(2)
    const prima = el.querySelector('[data-testid="attenzione-voce-autorizzazione"]') as HTMLElement
    expect(prima.textContent).toContain('Autorizzazione XYZ in scadenza')
    expect(prima.textContent).toContain('scade fra 12 giorni')
  })

  it('la pillola dice la gravità con la parola e il tono giusto', () => {
    const el = crea({
      voci: [
        voce({ chiave: 'a', gravita: 'critico' }),
        voce({ chiave: 'b', gravita: 'avviso' }),
        voce({ chiave: 'c', gravita: 'informativo' }),
      ],
    })
    const pillola = (chiave: string): HTMLElement =>
      el.querySelector(`[data-testid="attenzione-voce-${chiave}"] .pillola`) as HTMLElement
    expect(pillola('a').textContent?.trim()).toBe('Urgente')
    expect(pillola('a').classList).toContain('tono-err')
    expect(pillola('b').textContent?.trim()).toBe('In scadenza')
    expect(pillola('b').classList).toContain('tono-warn')
    expect(pillola('c').textContent?.trim()).toBe('Da sapere')
    expect(pillola('c').classList).toContain('tono-none')
  })

  it('il bottone azione porta alla rotta della voce', () => {
    const el = crea({ voci: [voce()] })
    const azione = el.querySelector(
      '[data-testid="attenzione-azione-autorizzazione"]'
    ) as HTMLAnchorElement
    expect(azione.textContent?.trim()).toBe('Vedi trasportatori')
    expect(azione.getAttribute('href')).toBe('/trasportatori')
  })

  it('due voci con la stessa chiave danno due righe con lo stesso data-testid', () => {
    const el = crea({ voci: [voce({ titolo: 'Uno' }), voce({ titolo: 'Due' })] })
    expect(el.querySelectorAll('[data-testid="attenzione-voce-autorizzazione"]').length).toBe(2)
  })

  it('non ha un tetto di righe: 12 voci, 12 righe', () => {
    const el = crea({ voci: Array.from({ length: 12 }, (_, i) => voce({ titolo: `Voce ${i}` })) })
    expect(el.querySelectorAll('li').length).toBe(12)
  })

  it('errore: con il modulo RENTRI il testo nomina il certificato RENTRI', () => {
    const el = crea({ errore: true, conRentri: true })
    const voceErrore = el.querySelector('[data-testid="attenzione-voce-verifica-fallita"]')
    expect(voceErrore?.textContent).toContain('certificato RENTRI')
  })

  it('errore: senza il modulo RENTRI il testo non nomina il certificato RENTRI', () => {
    const el = crea({ errore: true, conRentri: false })
    const voceErrore = el.querySelector('[data-testid="attenzione-voce-verifica-fallita"]')
    expect(voceErrore?.textContent).not.toContain('RENTRI')
    expect(voceErrore?.textContent).toContain('autorizzazioni')
  })

  it('senza voci e senza errore non disegna nessuna fascia', () => {
    const el = crea({ voci: [] })
    expect(el.querySelector('[data-testid="attenzione-fascia"]')).toBeNull()
    expect(el.querySelector('.card')).toBeNull()
  })

  it('con errore mostra la voce «verifica fallita» e «Riprova» emette riprova', () => {
    const el = crea({ errore: true })
    expect(el.querySelector('[data-testid="attenzione-voce-verifica-fallita"]')).toBeTruthy()
    let emesso = 0
    fixture.componentInstance.riprova.subscribe(() => emesso++)
    ;(
      el.querySelector('[data-testid="attenzione-azione-verifica-fallita"]') as HTMLButtonElement
    ).click()
    expect(emesso).toBe(1)
  })

  it('durante il caricamento mostra titolo e cornice, senza la fascia', () => {
    const el = crea({ caricamento: true })
    expect(el.querySelector('h2')?.textContent?.trim()).toBe('Da fare oggi')
    expect(el.querySelector('.card')).toBeTruthy()
    expect(el.querySelector('[data-testid="attenzione-fascia"]')).toBeNull()
  })
})
