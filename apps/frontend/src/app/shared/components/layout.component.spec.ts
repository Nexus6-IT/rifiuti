import { HttpClientTestingModule } from '@angular/common/http/testing'
import { MessageService } from 'primeng/api'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { Component } from '@angular/core'
import { provideLocationMocks } from '@angular/common/testing'
import { provideRouter, Router } from '@angular/router'
import { ButtonModule } from 'primeng/button'
import { signal } from '@angular/core'
import { Observable, of, throwError } from 'rxjs'
import { FeatureFlagsService } from '../../core/services/feature-flags.service'
import { LegamiService } from '../../features/legami/legami.service'
import { LayoutComponent, ordinaAziendePerGruppo } from './layout.component'

describe('ordinaAziendePerGruppo', () => {
  it('mette ogni figlia sotto la propria madre e la marca come annidata', () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'beta', name: 'Beta Srl', parentTenantId: 'madre' },
      { id: 'madre', name: 'Gruppo Madre Srl', parentTenantId: null },
      { id: 'alfa', name: 'Alfa Srl', parentTenantId: 'madre' },
    ])

    expect(risultato.map(a => a.id)).toEqual(['madre', 'alfa', 'beta'])
    expect(risultato.map(a => a.annidata)).toEqual([false, true, true])
  })

  it('lascia in elenco piatto le aziende senza gruppo', () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'due', name: 'Due Srl', parentTenantId: null },
      { id: 'uno', name: 'Uno Srl', parentTenantId: null },
    ])

    expect(risultato.map(a => a.id)).toEqual(['due', 'uno'])
    expect(risultato.every(a => !a.annidata)).toBe(true)
  })

  it("non perde le figlie la cui madre non e' accessibile all'utente", () => {
    const risultato = ordinaAziendePerGruppo([
      { id: 'orfana', name: 'Orfana Srl', parentTenantId: 'madre-non-visibile' },
      { id: 'uno', name: 'Uno Srl', parentTenantId: null },
    ])

    expect(risultato.map(a => a.id).sort()).toEqual(['orfana', 'uno'])
    expect(risultato.find(a => a.id === 'orfana')?.annidata).toBe(false)
  })
})

describe('LayoutComponent: voce di menu Pese', () => {
  it('la voce Pese punta a /pese ed è gated dalla feature pese', () => {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [provideRouter([]), MessageService],
    })
    const layout = TestBed.createComponent(LayoutComponent).componentInstance
    const voce = layout.navMain.find(v => v.route === '/pese')
    expect(voce).toEqual(jasmine.objectContaining({ label: 'Pese', feature: 'pese' }))
  })
})

describe('LayoutComponent: voce di menu Clienti', () => {
  it('la voce Clienti sostituisce quella temporanea delle tabelle di fatturazione', () => {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [provideRouter([]), MessageService],
    })
    const layout = TestBed.createComponent(LayoutComponent).componentInstance
    const voce = layout.navMain.find(v => v.route === '/clienti')
    expect(voce).toEqual(
      jasmine.objectContaining({ label: 'Clienti', icon: 'pi pi-users', feature: 'contratti' })
    )
    expect(layout.navMain.find(v => v.label === 'Tabelle di fatturazione')).toBeUndefined()
  })

  it('"Contratti clienti" segue "Clienti" e porta a /contratti-clienti (D20)', () => {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [provideRouter([]), MessageService],
    })
    const nav = TestBed.createComponent(LayoutComponent).componentInstance.navMain
    const i = nav.findIndex(v => v.route === '/clienti')
    expect(nav[i + 1]).toEqual(
      jasmine.objectContaining({
        label: 'Contratti clienti',
        route: '/contratti-clienti',
        icon: 'pi pi-file-edit',
        feature: 'contratti',
      })
    )
  })
})

describe('LayoutComponent: voce di menu «Da collegare»', () => {
  async function crea(contatori: unknown): Promise<HTMLElement> {
    // Come il servizio vero: `aggiornaContatori` rilegge e scrive il signal (0 se fallisce).
    const daCollegare = signal(0)
    const servizio = {
      daCollegare,
      aggiornaContatori: () =>
        (contatori as Observable<{ daCollegare: number }>).subscribe({
          next: c => daCollegare.set(c.daCollegare),
          error: () => daCollegare.set(0),
        }),
    }
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: LegamiService, useValue: servizio },
      ],
    })
    const ff = TestBed.inject(FeatureFlagsService)
    spyOn(ff, 'load').and.returnValue(
      of({ features: ['contratti'], tier: null, userLimitTotal: null })
    )
    spyOn(ff, 'has').and.returnValue(true)
    const fixture = TestBed.createComponent(LayoutComponent)
    // Niente `whenStable`: il layout ha timer propri che non finiscono mai. Gli observable sono sincroni.
    fixture.detectChanges()
    fixture.detectChanges()
    return fixture.nativeElement as HTMLElement
  }

  it('la voce porta a /legami/da-collegare ed è gated dalla feature contratti', () => {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [provideRouter([]), MessageService],
    })
    const voce = TestBed.createComponent(LayoutComponent).componentInstance.navMain.find(
      v => v.route === '/legami/da-collegare'
    )
    expect(voce).toEqual(
      jasmine.objectContaining({
        label: 'Da collegare',
        feature: 'contratti',
        contatoreLegami: true,
      })
    )
  })

  it('contatore del menu: mostra il totale della lista', async () => {
    const el = await crea(of({ daCollegare: 7, proposti: 2, mancanti: 3, daRiallineare: 2 }))
    expect(el.querySelector('[data-testid="contatore-legami"]')?.textContent?.trim()).toBe('7')
  })

  it('contatore a zero o errore: nessun numero accanto alla voce', async () => {
    const el = await crea(throwError(() => new Error('rete')))
    expect(el.querySelector('[data-testid="contatore-legami"]')).toBeNull()
  })
})

@Component({
  standalone: true,
  imports: [ButtonModule],
  template: `
    <p-button label="Base" data-testid="bottone-base" />
    <p-button label="Primario" styleClass="wf-primario" data-testid="bottone-primario" />
  `,
})
class BottoniProvaComponent {}

describe('LayoutComponent: shell Libro mastro', () => {
  let fixture: ComponentFixture<LayoutComponent>

  async function crea(url = '/dashboard'): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [LayoutComponent, HttpClientTestingModule],
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        provideLocationMocks(),
        MessageService,
      ],
    })
    const ff = TestBed.inject(FeatureFlagsService)
    spyOn(ff, 'load').and.returnValue(
      of({ features: ['contratti'], tier: null, userLimitTotal: null })
    )
    spyOn(ff, 'has').and.returnValue(true)
    await TestBed.inject(Router).navigateByUrl(url)
    fixture = TestBed.createComponent(LayoutComponent)
    fixture.detectChanges()
    fixture.detectChanges()
    TestBed.flushEffects()
    // La sidebar e' nascosta sotto i 992px: la si mostra per leggere gli stili calcolati.
    const sidebar = fixture.nativeElement.querySelector('.sidebar') as HTMLElement
    sidebar.style.display = 'flex'
    return fixture.nativeElement as HTMLElement
  }

  /** Il colore calcolato di un valore CSS (una variabile, per esempio), letto da un elemento di prova. */
  function coloreDi(valore: string, proprieta: 'color' | 'backgroundColor'): string {
    const prova = document.createElement('span')
    prova.style[proprieta] = valore
    document.body.appendChild(prova)
    const calcolato = getComputedStyle(prova)[proprieta]
    prova.remove()
    return calcolato
  }

  function voce(el: HTMLElement, testo: string): HTMLElement {
    const v = Array.from(el.querySelectorAll<HTMLElement>('.sidebar .nav-item')).find(a =>
      a.textContent?.includes(testo)
    )
    if (!v) throw new Error(`voce «${testo}» non trovata`)
    return v
  }

  beforeEach(() => {
    localStorage.removeItem('wf_tema')
  })
  afterEach(() => {
    localStorage.removeItem('wf_tema')
    localStorage.removeItem('wf_impersonator_token')
    document.documentElement.removeAttribute('data-theme')
  })

  it('non ha nessun h1: il titolo della pagina e quello del suo contenuto', async () => {
    const el = await crea()
    expect(el.querySelector('h1')).toBeNull()
  })

  it("«Registro C/S» ha l'icona del libro", async () => {
    const el = await crea()
    const icona = voce(el, 'Registro C/S').querySelector('.nav-item__icon')
    expect(icona?.classList).toContain('pi-book')
    expect(icona?.classList).not.toContain('pi-clipboard')
  })

  it("su /clienti/fatturazione c'e' una sola voce accesa, «Fatturazione da»", async () => {
    const el = await crea('/clienti/fatturazione')
    const accese = el.querySelectorAll('.sidebar .nav-item--active')
    expect(accese.length).toBe(1)
    expect(accese[0].textContent).toContain('Fatturazione da')
    expect(el.querySelectorAll('.sidebar [aria-current="page"]').length).toBe(1)
    expect(voce(el, 'Fatturazione da').getAttribute('aria-current')).toBe('page')
  })

  it('su /contratti-clienti/42/listino si accende «Contratti clienti», non «Contratti»', async () => {
    const el = await crea('/contratti-clienti/42/listino')
    const accese = Array.from(el.querySelectorAll('.sidebar .nav-item--active'))
    expect(accese.map(a => a.textContent?.trim())).toEqual(['Contratti clienti'])
  })

  it("sul telefono il contrassegno dell'azienda attiva sta nella barra stretta", async () => {
    const el = await crea()
    const layout = fixture.componentInstance
    expect(el.querySelector('.topbar .topbar__azienda')).toBeNull()
    layout.userTenants.set([
      { id: 'a', name: 'Alfa Srl' },
      { id: 'b', name: 'Beta Srl' },
    ])
    layout.currentUserTenantId.set('a')
    fixture.detectChanges()
    const contrassegno = el.querySelector('.topbar .topbar__azienda')
    expect(contrassegno?.textContent).toContain('Azienda attiva: Alfa Srl')
    expect(contrassegno?.querySelector('.contrassegno')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('il nome della pagina nella barra stretta viene dal percorso, anche fuori menu', async () => {
    expect((await crea('/notifications')).querySelector('.topbar__title')?.textContent).toBe(
      'Notifiche'
    )
  })

  it("la voce attiva non ha la barra a sinistra e l'icona non e' arancio", async () => {
    const el = await crea('/clienti')
    const attiva = voce(el, 'Clienti')
    expect(attiva.classList).toContain('nav-item--active')
    expect(getComputedStyle(attiva, '::before').content).toBe('none')
    const icona = attiva.querySelector('.nav-item__icon') as HTMLElement
    expect(getComputedStyle(icona).color).not.toBe(coloreDi('var(--brand-primary)', 'color'))
    expect(getComputedStyle(icona).color).toBe(coloreDi('var(--sidebar-active)', 'color'))
  })

  it('il pulsante del tema dice «Tema: Chiaro» e cicla Chiaro, Scuro, Sistema', async () => {
    const el = await crea()
    const tema = (): HTMLButtonElement => el.querySelector('.sidebar .tema') as HTMLButtonElement
    const clic = (): void => {
      tema().click()
      TestBed.flushEffects()
      fixture.detectChanges()
    }
    expect(tema().textContent?.trim()).toBe('Tema: Chiaro')
    expect(tema().getAttribute('aria-label')).toBe('Tema: Chiaro. Passa a scuro')

    clic()
    expect(tema().textContent?.trim()).toBe('Tema: Scuro')
    expect(tema().getAttribute('aria-label')).toBe('Tema: Scuro. Passa a sistema')

    clic()
    expect(tema().textContent?.trim()).toBe('Tema: Sistema')
    expect(tema().getAttribute('aria-label')).toBe('Tema: Sistema. Passa a chiaro')
    expect(localStorage.getItem('wf_tema')).toBe('sistema')
  })

  it("la navigazione desktop ha il suo nome e in fondo c'e' «Esci»", async () => {
    const el = await crea()
    expect(el.querySelector('nav.sidebar__nav')?.getAttribute('aria-label')).toBe(
      'Navigazione principale'
    )
    const esci = el.querySelector('.sidebar > .sidebar__footer button.esci')
    expect(esci?.textContent?.trim()).toBe('Esci')
  })

  it("il main ha id main-content e c'e' il banner di impersonificazione", async () => {
    localStorage.setItem('wf_impersonator_token', 'x')
    localStorage.setItem('wf_impersonating_name', 'Mario')
    try {
      const el = await crea()
      expect(el.querySelector('main#main-content')).not.toBeNull()
      expect(el.querySelector('.impersonation-banner')?.textContent).toContain('Stai impersonando')
    } finally {
      localStorage.removeItem('wf_impersonating_name')
    }
  })

  it('il gutter laterale sta su .main__inner: 24px da 992, 20px da 576, 16px sotto', async () => {
    const el = await crea()
    const atteso = window.innerWidth >= 992 ? 24 : window.innerWidth >= 576 ? 20 : 16
    const stile = getComputedStyle(el.querySelector('.main__inner') as HTMLElement)
    expect(stile.paddingLeft).toBe(`${atteso}px`)
    expect(stile.paddingRight).toBe(`${atteso}px`)
  })

  it("il .main non ha bordo ne' raggio ne' margini del foglio", async () => {
    const el = await crea()
    const stile = getComputedStyle(el.querySelector('main.main') as HTMLElement)
    expect(stile.borderTopWidth).toBe('0px')
    expect(stile.borderRadius).toBe('0px')
    expect(stile.marginRight).toBe('0px')
  })
})

describe('Token: pannello di marca di login e iscrizione', () => {
  it('i token del gradiente risolvono su un pannello scuro piatto, non su trasparente', () => {
    const prova = document.createElement('div')
    prova.style.background =
      'linear-gradient(135deg, var(--brand-panel-from) 0%, var(--brand-panel-mid) 62%, var(--brand-panel-to) 100%)'
    document.body.appendChild(prova)
    const stile = getComputedStyle(prova)
    expect(stile.backgroundImage).toContain('linear-gradient')
    expect(stile.backgroundImage.match(/rgb\(20, 20, 20\)/g)?.length).toBe(3)
    prova.remove()
  })
})

describe('Token: bottoni pieni', () => {
  function coloreDi(valore: string): string {
    const prova = document.createElement('span')
    prova.style.backgroundColor = valore
    document.body.appendChild(prova)
    const calcolato = getComputedStyle(prova).backgroundColor
    prova.remove()
    return calcolato
  }

  it("un p-button senza classe e' in inchiostro, con wf-primario e' arancio", () => {
    TestBed.configureTestingModule({ imports: [BottoniProvaComponent] })
    const fixture = TestBed.createComponent(BottoniProvaComponent)
    fixture.detectChanges()
    const el = fixture.nativeElement as HTMLElement
    const base = el.querySelector('[data-testid="bottone-base"] button') as HTMLElement
    const primario = el.querySelector('[data-testid="bottone-primario"] button') as HTMLElement
    expect(getComputedStyle(base).backgroundColor).toBe(coloreDi('var(--ink-fill)'))
    expect(getComputedStyle(primario).backgroundColor).toBe(coloreDi('var(--accent-fill)'))
    expect(getComputedStyle(base).backgroundColor).not.toBe(
      getComputedStyle(primario).backgroundColor
    )
  })
})
