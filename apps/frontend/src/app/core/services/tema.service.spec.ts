import { TestBed } from '@angular/core/testing'
import { DOCUMENT } from '@angular/common'
import {
  MEDIA_TEMA_SCURO,
  TemaService,
  etichettaPreferenzaTema,
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

  it('prossimaPreferenzaTema: chiaro, scuro, sistema, poi di nuovo chiaro', () => {
    expect(prossimaPreferenzaTema('chiaro')).toBe('scuro')
    expect(prossimaPreferenzaTema('scuro')).toBe('sistema')
    expect(prossimaPreferenzaTema('sistema')).toBe('chiaro')
  })

  it('leggiPreferenzaTema: valori assenti o sconosciuti valgono "chiaro"', () => {
    expect(leggiPreferenzaTema('scuro')).toBe('scuro')
    expect(leggiPreferenzaTema('chiaro')).toBe('chiaro')
    expect(leggiPreferenzaTema('sistema')).toBe('sistema')
    expect(leggiPreferenzaTema(null)).toBe('chiaro')
    expect(leggiPreferenzaTema('')).toBe('chiaro')
    expect(leggiPreferenzaTema('auto')).toBe('chiaro')
    expect(leggiPreferenzaTema('dark')).toBe('chiaro')
  })

  it('etichettaPreferenzaTema: una parola per scelta', () => {
    expect(etichettaPreferenzaTema('chiaro')).toBe('Chiaro')
    expect(etichettaPreferenzaTema('scuro')).toBe('Scuro')
    expect(etichettaPreferenzaTema('sistema')).toBe('Sistema')
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

  it('senza preferenza salvata parte chiaro anche con il sistema in scuro', () => {
    media.matches = true
    const servizio = crea()
    expect(servizio.preferenza()).toBe('chiaro')
    expect(servizio.effettivo()).toBe('chiaro')
    expect(doc.documentElement.getAttribute('data-theme')).toBe('light')
    expect(link.getAttribute('href')).toBe('tema-primeng-chiaro.css')
  })

  it('con preferenza "sistema" salvata e sistema scuro parte scuro', () => {
    localStorage.setItem('wf_tema', 'sistema')
    media.matches = true
    const servizio = crea()
    expect(servizio.preferenza()).toBe('sistema')
    expect(servizio.effettivo()).toBe('scuro')
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(link.getAttribute('href')).toBe('tema-primeng-scuro.css')
  })

  it('con preferenza "sistema" reagisce al cambio del sistema operativo', () => {
    localStorage.setItem('wf_tema', 'sistema')
    const servizio = crea()
    expect(servizio.effettivo()).toBe('chiaro')
    media.cambia(true)
    TestBed.flushEffects()
    expect(servizio.effettivo()).toBe('scuro')
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('cicla la preferenza (chiaro, scuro, sistema), la salva sempre e la applica', () => {
    const servizio = crea()
    servizio.cicla()
    TestBed.flushEffects()
    expect(servizio.preferenza()).toBe('scuro')
    expect(localStorage.getItem('wf_tema')).toBe('scuro')
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(link.getAttribute('href')).toBe('tema-primeng-scuro.css')

    servizio.cicla()
    TestBed.flushEffects()
    expect(servizio.preferenza()).toBe('sistema')
    expect(localStorage.getItem('wf_tema')).toBe('sistema')

    servizio.cicla()
    TestBed.flushEffects()
    expect(servizio.preferenza()).toBe('chiaro')
    expect(localStorage.getItem('wf_tema')).toBe('chiaro')
  })

  it('legge la preferenza salvata', () => {
    localStorage.setItem('wf_tema', 'scuro')
    const servizio = crea()
    expect(servizio.preferenza()).toBe('scuro')
    expect(servizio.effettivo()).toBe('scuro')
  })

  it('imposta("sistema") scrive "sistema" e non cancella la chiave', () => {
    const servizio = crea()
    servizio.imposta('sistema')
    expect(localStorage.getItem('wf_tema')).toBe('sistema')
  })

  it('aggiorna theme-color in tutti i meta, in chiaro e in scuro', () => {
    const meta = [1, 2].map(() => {
      const m = document.createElement('meta')
      m.setAttribute('name', 'theme-color')
      document.head.appendChild(m)
      return m
    })
    try {
      const servizio = crea()
      meta.forEach(m => expect(m.getAttribute('content')).toBe('#f3f2ef'))
      servizio.imposta('scuro')
      TestBed.flushEffects()
      meta.forEach(m => expect(m.getAttribute('content')).toBe('#131311'))
    } finally {
      meta.forEach(m => m.remove())
    }
  })

  it('con lo storage bloccato vale chiaro e non lancia', () => {
    const spy = spyOn(Storage.prototype, 'getItem').and.throwError('bloccato')
    const spyScrivi = spyOn(Storage.prototype, 'setItem').and.throwError('bloccato')
    let servizio!: TemaService
    expect(() => (servizio = crea())).not.toThrow()
    expect(servizio.effettivo()).toBe('chiaro')
    expect(() => servizio.imposta('scuro')).not.toThrow()
    expect(spy).toHaveBeenCalled()
    expect(spyScrivi).toHaveBeenCalled()
  })
})
