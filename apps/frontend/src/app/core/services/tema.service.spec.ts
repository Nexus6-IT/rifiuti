import { TestBed } from '@angular/core/testing'
import { DOCUMENT } from '@angular/common'
import {
  MEDIA_TEMA_SCURO,
  TemaService,
  hrefTemaPrimeng,
  leggiPreferenzaTema,
  prossimaPreferenzaTema,
  risolviTema,
} from './tema.service'

/** MediaQueryList finta: il test decide se il sistema operativo è in modalità scura. */
class MediaFinta {
  private ascoltatori: ((e: { matches: boolean }) => void)[] = []
  constructor(public matches: boolean) {}
  addEventListener(_tipo: 'change', fn: (e: { matches: boolean }) => void): void {
    this.ascoltatori.push(fn)
  }
  removeEventListener(): void {}
  cambia(matches: boolean): void {
    this.matches = matches
    this.ascoltatori.forEach(fn => fn({ matches }))
  }
}

describe('tema: funzioni pure', () => {
  it('risolviTema: la preferenza esplicita vince sul sistema', () => {
    expect(risolviTema('chiaro', true)).toBe('chiaro')
    expect(risolviTema('scuro', false)).toBe('scuro')
  })

  it('risolviTema: "sistema" segue il sistema operativo', () => {
    expect(risolviTema('sistema', true)).toBe('scuro')
    expect(risolviTema('sistema', false)).toBe('chiaro')
  })

  it('prossimaPreferenzaTema: sistema, chiaro, scuro, poi di nuovo sistema', () => {
    expect(prossimaPreferenzaTema('sistema')).toBe('chiaro')
    expect(prossimaPreferenzaTema('chiaro')).toBe('scuro')
    expect(prossimaPreferenzaTema('scuro')).toBe('sistema')
  })

  it('leggiPreferenzaTema: valori sconosciuti o assenti tornano a "sistema"', () => {
    expect(leggiPreferenzaTema('scuro')).toBe('scuro')
    expect(leggiPreferenzaTema('chiaro')).toBe('chiaro')
    expect(leggiPreferenzaTema(null)).toBe('sistema')
    expect(leggiPreferenzaTema('dark')).toBe('sistema')
  })

  it('hrefTemaPrimeng: un file di tema PrimeNG per modalità', () => {
    expect(hrefTemaPrimeng('chiaro')).toBe('tema-primeng-chiaro.css')
    expect(hrefTemaPrimeng('scuro')).toBe('tema-primeng-scuro.css')
  })
})

describe('TemaService', () => {
  let media: MediaFinta
  let doc: Document
  let link: HTMLLinkElement

  function crea(): TemaService {
    TestBed.configureTestingModule({ providers: [{ provide: MEDIA_TEMA_SCURO, useValue: media }] })
    doc = TestBed.inject(DOCUMENT)
    const servizio = TestBed.inject(TemaService)
    TestBed.flushEffects()
    return servizio
  }

  beforeEach(() => {
    localStorage.removeItem('wf_tema')
    media = new MediaFinta(false)
    link = document.createElement('link')
    link.id = 'tema-primeng'
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  })

  afterEach(() => {
    link.remove()
    localStorage.removeItem('wf_tema')
    document.documentElement.removeAttribute('data-theme')
  })

  it('senza preferenza salvata segue il sistema e applica data-theme e il tema PrimeNG', () => {
    media.matches = true
    const servizio = crea()
    expect(servizio.preferenza()).toBe('sistema')
    expect(servizio.effettivo()).toBe('scuro')
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(link.getAttribute('href')).toBe('tema-primeng-scuro.css')
  })

  it('con preferenza "sistema" reagisce al cambio del sistema operativo', () => {
    const servizio = crea()
    expect(servizio.effettivo()).toBe('chiaro')
    media.cambia(true)
    TestBed.flushEffects()
    expect(servizio.effettivo()).toBe('scuro')
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('cicla la preferenza, la salva e la applica', () => {
    const servizio = crea()
    servizio.cicla()
    TestBed.flushEffects()
    expect(servizio.preferenza()).toBe('chiaro')
    expect(localStorage.getItem('wf_tema')).toBe('chiaro')
    expect(doc.documentElement.getAttribute('data-theme')).toBe('light')

    servizio.cicla()
    TestBed.flushEffects()
    expect(servizio.preferenza()).toBe('scuro')
    expect(link.getAttribute('href')).toBe('tema-primeng-scuro.css')
  })

  it('legge la preferenza salvata', () => {
    localStorage.setItem('wf_tema', 'scuro')
    const servizio = crea()
    expect(servizio.preferenza()).toBe('scuro')
    expect(servizio.effettivo()).toBe('scuro')
  })

  it('tornando a "sistema" rimuove la preferenza salvata', () => {
    localStorage.setItem('wf_tema', 'scuro')
    const servizio = crea()
    servizio.cicla()
    TestBed.flushEffects()
    expect(servizio.preferenza()).toBe('sistema')
    expect(localStorage.getItem('wf_tema')).toBeNull()
  })
})
