import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { FIR, FIRStato } from '../../../shared/models/fir.model'
import { FirRecentiComponent, etichettaDataFir } from './fir-recenti.component'
import { coloreDelToken } from './dashboard-fixture'

function fir(over: Partial<FIR> = {}, n = 1): FIR {
  return {
    id: `f${n}`,
    numeroProgressivo: `DLVQ 00125${n} XC`,
    anno: 2026,
    stato: FIRStato.CONSEGNATO,
    produttoreId: 'p',
    trasportatoreId: 't',
    destinatarioId: 'd',
    produttore: { ragioneSociale: 'Lavorazioni Metalliche Arnaldi', partitaIva: '01234567890' },
    rifiuto: { cerCode: '15 01 06', quantita: 1240, unitaMisura: 'kg' },
    createdAt: new Date().toISOString(),
    ...over,
  }
}

describe('FirRecentiComponent', () => {
  function crea(input: Partial<FirRecentiComponent>): HTMLElement {
    TestBed.configureTestingModule({ providers: [provideRouter([])] })
    const fixture = TestBed.createComponent(FirRecentiComponent)
    Object.assign(fixture.componentInstance, input)
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  it('cinque righe su due linee: numero in mono e pillola; CER, produttore, quantità e data', () => {
    const el = crea({ fir: [1, 2, 3, 4, 5].map(n => fir({}, n)) })
    const righe = el.querySelectorAll('li')
    expect(righe.length).toBe(5)
    const prima = righe[0]
    expect(prima.querySelector('.r1')?.classList).toContain('mono')
    expect(prima.querySelector('.r1')?.textContent?.trim()).toBe('DLVQ 001251 XC')
    expect(prima.querySelector('.pillola')?.textContent?.trim()).toBe('Consegnato')
    const testo = prima.textContent?.replace(/\s+/g, ' ')
    expect(testo).toContain('15 01 06 · Lavorazioni Metalliche Arnaldi')
    expect(testo).toContain('1.240 kg')
    expect(testo).toContain('Oggi')
  })

  it('la quantità porta la sua unità: un FIR in litri mostra «1.240 l»', () => {
    const el = crea({
      fir: [fir({ rifiuto: { cerCode: '13 02 05*', quantita: 1240, unitaMisura: 'l' } })],
    })
    expect(el.querySelector('.r2.dx')?.textContent).toContain('1.240 l')
  })

  it('quantità mancante: «—»', () => {
    const f = fir()
    ;(f.rifiuto as { quantita: number | null }).quantita = null
    const el = crea({ fir: [f] })
    expect(el.querySelector('.r2.dx')?.textContent?.trim().startsWith('—')).toBeTrue()
  })

  it('una bozza senza numero progressivo mostra «Bozza» al posto del numero', () => {
    const el = crea({ fir: [fir({ numeroProgressivo: null, stato: FIRStato.BOZZA })] })
    expect(el.querySelector('.r1')?.textContent?.trim()).toBe('Bozza')
  })

  it('un FIR annullato senza numero non si presenta come «Bozza» (I1)', () => {
    const el = crea({ fir: [fir({ numeroProgressivo: null, stato: FIRStato.ANNULLATO })] })
    expect(el.querySelector('.r1')?.textContent?.trim()).toBe('Senza numero')
  })

  it("l'annullato ha la pillola barrata", () => {
    const el = crea({ fir: [fir({ stato: FIRStato.ANNULLATO })] })
    expect(el.querySelector('.pillola')?.classList).toContain('pillola--barrata')
  })

  it('il numero di riga è in inchiostro, non nel colore del link (P13)', () => {
    const el = crea({ fir: [fir()] })
    const colore = getComputedStyle(el.querySelector('.r1') as HTMLElement).color
    expect(colore).toBe(coloreDelToken('--text-primary'))
    expect(colore).not.toBe(coloreDelToken('--brand-primary'))
  })

  it('«Vedi tutti i FIR» porta a /fir e il numero al dettaglio del FIR', () => {
    const el = crea({ fir: [fir()] })
    expect(el.querySelector('.vedi a')?.getAttribute('href')).toBe('/fir')
    expect(el.querySelector('.r1')?.getAttribute('href')).toBe('/fir/f1')
  })

  it('con 0 FIR: «Nessun FIR registrato», link «Nuovo FIR» se permesso, nessun elenco', () => {
    const el = crea({ fir: [], puoCreare: true })
    expect(el.querySelector('[data-testid="fir-recenti-vuoto"]')?.textContent?.trim()).toBe(
      'Nessun FIR registrato'
    )
    expect(el.querySelector('.vuoto-azione a')?.textContent?.trim()).toBe('Nuovo FIR')
    expect(el.querySelector('ul')).toBeNull()
    expect(el.querySelector('.vedi')).toBeNull()
  })

  it('con 0 FIR e senza permesso non offre «Nuovo FIR»', () => {
    const el = crea({ fir: [], puoCreare: false })
    expect(el.querySelector('.vuoto-azione')).toBeNull()
  })

  it('durante il caricamento ha titolo e cornice e nessuna riga', () => {
    const el = crea({ fir: [], caricamento: true })
    expect(el.querySelector('h2')?.textContent?.trim()).toBe('FIR recenti')
    expect(el.querySelector('li')).toBeNull()
    expect(el.querySelector('[data-testid="fir-recenti-vuoto"]')).toBeNull()
  })

  describe('etichettaDataFir', () => {
    const adesso = new Date(2026, 10, 5, 12, 0)
    it('oggi, ieri e una data', () => {
      expect(etichettaDataFir(new Date(2026, 10, 5, 9, 14).toISOString(), adesso)).toBe(
        'Oggi 09:14'
      )
      expect(etichettaDataFir(new Date(2026, 10, 4, 15, 2).toISOString(), adesso)).toBe(
        'Ieri 15:02'
      )
      expect(etichettaDataFir(new Date(2026, 10, 3, 17, 50).toISOString(), adesso)).toBe(
        '3/11 17:50'
      )
    })
  })
})
