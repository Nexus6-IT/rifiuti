import { TestBed } from '@angular/core/testing'
import { AndamentoMensileVoce } from '../andamento.service'
import { BarreMensiliComponent } from './barre-mensili.component'
import { LOCALE_IT } from './dashboard-fixture'

const MESI_ISO = [
  '2025-12',
  '2026-01',
  '2026-02',
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
  '2026-11',
]

function serie(valori: number[]): AndamentoMensileVoce[] {
  return MESI_ISO.map((mese, i) => ({ mese, conteggio: valori[i] }))
}

describe('BarreMensiliComponent', () => {
  // Somma 1.647, media 137.
  const valori = [134, 131, 122, 128, 141, 137, 149, 152, 160, 88, 147, 158]

  function crea(input: Partial<BarreMensiliComponent>): HTMLElement {
    TestBed.configureTestingModule({ providers: [LOCALE_IT] })
    const fixture = TestBed.createComponent(BarreMensiliComponent)
    Object.assign(fixture.componentInstance, input)
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  it("12 rect con data-mese; solo l'ultimo è barra--corrente", () => {
    const el = crea({ mesi: serie(valori) })
    const rect = Array.from(el.querySelectorAll('rect'))
    expect(rect.length).toBe(12)
    expect(rect.map(r => r.getAttribute('data-mese'))).toEqual(MESI_ISO)
    expect(rect[11].classList).toContain('barra--corrente')
    expect(
      rect
        .slice(0, 11)
        .every(r => r.classList.contains('barra') && !r.classList.contains('barra--corrente'))
    ).toBeTrue()
  })

  it('la barra del mese corrente si riempie con var(--brand-primary), le altre in neutro', () => {
    const el = crea({ mesi: serie(valori) })
    const corrente = el.querySelector('rect.barra--corrente') as SVGRectElement
    const altra = el.querySelector('rect[data-mese="2026-10"]') as SVGRectElement
    const fillCorrente = getComputedStyle(corrente).fill
    const fillAltra = getComputedStyle(altra).fill
    expect(fillCorrente).not.toBe(fillAltra)
  })

  it('le altezze sono a rapporto vero sul massimo', () => {
    const el = crea({ mesi: serie(valori) })
    const h = (m: string): number =>
      Number(el.querySelector(`rect[data-mese="${m}"]`)?.getAttribute('height'))
    // 160 è il massimo (agosto 2026); 80 è esattamente la metà.
    const picco = h('2026-08')
    expect(h('2026-11') / picco).toBeCloseTo(158 / 160, 3)
    expect(h('2026-09') / picco).toBeCloseTo(88 / 160, 3)
  })

  it('12 etichette ricavate dal campo mese, non dalla data di oggi', () => {
    const el = crea({ mesi: serie(valori) })
    const etichette = Array.from(el.querySelectorAll('.colonna__m')).map(e => e.textContent?.trim())
    expect(etichette).toEqual([
      'dic',
      'gen',
      'feb',
      'mar',
      'apr',
      'mag',
      'giu',
      'lug',
      'ago',
      'set',
      'ott',
      'nov',
    ])
  })

  it("la linea della media ha l'aria-label con il valore arrotondato", () => {
    const el = crea({ mesi: serie(valori) })
    expect(el.querySelector('[data-testid="andamento-media"]')?.getAttribute('aria-label')).toBe(
      'Media 137 al mese'
    )
    expect(el.querySelector('.meta')?.textContent?.replace(/\s+/g, ' ')).toContain(
      '1.647 FIR, media 137 al mese'
    )
    expect(el.querySelector('.meta')?.textContent).toContain('dic 2025 – nov 2026')
  })

  it('tutti zero: solo la riga vuota, senza grafico né colonne, e la card resta bassa (I3, bug 8)', () => {
    const el = crea({ mesi: serie(new Array(12).fill(0)) })
    expect(el.querySelector('[data-testid="andamento-vuoto"]')?.textContent?.trim()).toBe(
      'Nessun formulario negli ultimi dodici mesi'
    )
    expect(el.querySelector('svg')).toBeNull()
    expect(el.querySelector('.colonne')).toBeNull()
    expect((el.querySelector('.card') as HTMLElement).offsetHeight).toBeLessThan(120)
  })

  it("l'aria-label dell'SVG contiene la media, perché i figli di un'immagine non si leggono (M5)", () => {
    const el = crea({ mesi: serie(valori) })
    expect(el.querySelector('svg')?.getAttribute('aria-label')).toContain('media 137 al mese')
  })

  it('la tabella sr-only raggruppa le migliaia (M6)', () => {
    const el = crea({ mesi: serie([1240, ...valori.slice(1)]) })
    expect(
      el
        .querySelector('[data-testid="andamento-tabella-testuale"] tbody td:last-child')
        ?.textContent?.trim()
    ).toBe('1.240')
  })

  it('la tabella sr-only ha 12 righe', () => {
    const el = crea({ mesi: serie(valori) })
    const tabella = el.querySelector('[data-testid="andamento-tabella-testuale"]') as HTMLElement
    expect(tabella.classList).toContain('sr-only')
    expect(tabella.querySelectorAll('tbody tr').length).toBe(12)
    expect(tabella.querySelector('tbody tr td')?.textContent).toContain('dic 2025')
  })

  it('con un errore dice che non ha potuto caricare e «Riprova» emette', () => {
    TestBed.configureTestingModule({ providers: [LOCALE_IT] })
    const fixture = TestBed.createComponent(BarreMensiliComponent)
    fixture.componentInstance.errore = true
    let emesso = 0
    fixture.componentInstance.riprova.subscribe(() => emesso++)
    fixture.detectChanges()
    const el = fixture.nativeElement as HTMLElement
    expect(el.querySelector('[data-testid="andamento-errore"]')).toBeTruthy()
    el.querySelector<HTMLButtonElement>('[data-testid="andamento-errore"] button')?.click()
    expect(emesso).toBe(1)
  })

  it('durante il caricamento ha titolo e cornice e nessuna barra', () => {
    const el = crea({ caricamento: true, mesi: [] })
    expect(el.querySelector('h2')?.textContent?.trim()).toBe('Formulari per mese')
    expect(el.querySelectorAll('rect').length).toBe(0)
    expect(el.querySelector('[data-testid="andamento-vuoto"]')).toBeNull()
  })
})
