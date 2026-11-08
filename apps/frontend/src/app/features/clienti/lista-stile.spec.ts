import { registerLocaleData } from '@angular/common'
import localeIt from '@angular/common/locales/it'
import { LOCALE_ID } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { MessageService } from 'primeng/api'
import { of } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { ListinoService } from '../listino/listino.service'
import { AddebitiListComponent } from '../listino/addebiti-list.component'
import { AddebitoDialogComponent } from '../listino/addebito-dialog.component'
import { VariazioneArchivioDialogComponent } from '../listino/variazione-archivio-dialog.component'
import { RegistryService } from '../registry/registry.service'
import { AgenteDialogComponent } from './agente-dialog.component'
import { AgentiListComponent } from './agenti-list.component'
import { ClienteDialogComponent } from './cliente-dialog.component'
import { ClientiListComponent } from './clienti-list.component'
import { ClientiService } from './clienti.service'
import { TabelleFatturazioneService } from './tabelle-fatturazione.service'
import { apriMenuRiga, chiudiMenuRiga } from './tabelle/azioni-test-utils'
import { CodificheGrigliaComponent } from './tabelle/codifiche-griglia.component'
import { ContiCorrentiComponent } from './tabelle/conti-correnti.component'
import { SpeseAccessorieComponent } from './tabelle/spese-accessorie.component'
import { stabilizza, tabellaFinta } from './tabelle/tabelle-test-utils'

registerLocaleData(localeIt, 'it-IT')

/**
 * Task 6 (giro 2): le liste di Clienti, Agenti, Archivio addebiti e Tabelle di fatturazione
 * seguono il pattern delle liste: una azione sulla riga e le altre nel menu ⋯, colonne vuote
 * nascoste, numeri a destra, niente paginatore a zero righe, un solo bottone primario.
 */
const NOME_LUNGO =
  'Acciaierie e Lavorazioni Metalliche della Valdelsa Societa Per Azioni Unipersonale S.r.l.'

const ditta = (ragioneSociale: string, piva: string | null = '12345678903') => ({
  id: 'd1',
  ragioneSociale,
  partitaIva: piva,
  codiceFiscale: null,
  privato: false,
})

const cliente = (over: Record<string, unknown> = {}) =>
  ({
    id: 'cl1',
    versione: 4,
    attivo: true,
    codice: 'CL1',
    codiceDestinatario: 'ABCDEFG',
    ditta: ditta('Verdi Servizi S.r.l.'),
    condizionePagamento: { id: 'c1', codice: '30FM', descrizione: '30 gg fine mese' },
    agente: { id: 'a1', codice: 'AG1', descrizione: 'Rossi Provvigioni' },
    contratti: 7,
    eliminabile: true,
    ...over,
  }) as never

const agente = (over: Record<string, unknown> = {}) =>
  ({
    id: 'a1',
    versione: 2,
    attivo: true,
    codice: 'AG1',
    ditta: ditta('Rossi Provvigioni S.n.c.'),
    clienti: 12,
    contratti: 5,
    eliminabile: true,
    ...over,
  }) as never

const addebito = (over: Record<string, unknown> = {}) =>
  ({
    id: 'ad1',
    codice: '00001',
    descrizione: 'Trasporto rifiuti',
    gruppo: { id: 'g1', codice: '001', descrizione: 'Trasporti' },
    unitaMisura: 'KG',
    tipo: 'V',
    etichettaTipo: 'Quantita',
    listini: [{ numero: 1, prezzo: '5.00', sconto: null, provvigione: null }],
    attivo: true,
    versione: 4,
    eliminabile: true,
    ...over,
  }) as never

const css = (el: Element) => getComputedStyle(el)
const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
  document.body.querySelector<T>(sel)
const intestazioni = (): string[] =>
  Array.from(document.body.querySelectorAll('thead th')).map(t => (t.textContent ?? '').trim())
const primari = (): HTMLElement[] => Array.from(document.body.querySelectorAll('.wf-primario'))

/** Copia in un iframe largo 390px il blocco `sezione` con gli stessi stili: la media query vale per il suo viewport. */
async function inIframe390(
  sezione: HTMLElement
): Promise<{ doc: Document; iframe: HTMLIFrameElement }> {
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'width:390px;height:800px;border:0;position:fixed;left:0;top:0'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument as Document
  doc.open()
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
  doc.close()
  const caricamenti: Promise<void>[] = []
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(n => {
    const copia = n.cloneNode(true) as HTMLElement
    if (copia.tagName === 'LINK') {
      caricamenti.push(new Promise(ok => copia.addEventListener('load', () => ok())))
    }
    doc.head.appendChild(copia)
  })
  doc.body.innerHTML = `<main style="padding:0 16px">${sezione.outerHTML}</main>`
  await Promise.all(caricamenti)
  return { doc, iframe }
}

describe('Liste del Task 6 (pattern delle liste)', () => {
  afterEach(() => chiudiMenuRiga())

  describe('voce pericolosa del menu ⋯', () => {
    const colore = (tema: 'light' | 'dark'): { voce: string; attesa: string } => {
      document.documentElement.setAttribute('data-theme', tema)
      const radice = document.createElement('div')
      radice.innerHTML = `<div class="p-menu"><ul>
        <li class="p-menuitem azione-pericolosa"><div class="p-menuitem-content"><a class="p-menuitem-link"><span class="p-menuitem-icon"></span><span class="p-menuitem-text">Elimina</span></a></div></li>
        <li class="p-menuitem"><div class="p-menuitem-content"><a class="p-menuitem-link"><span class="p-menuitem-text">Disattiva</span></a></div></li>
        </ul></div><i class="sonda" style="color: var(--color-danger)"></i>`
      document.body.appendChild(radice)
      const voce = getComputedStyle(
        radice.querySelector('.azione-pericolosa .p-menuitem-text')!
      ).color
      const attesa = getComputedStyle(radice.querySelector('.sonda')!).color
      const normale = getComputedStyle(
        radice.querySelector('li:not(.azione-pericolosa) .p-menuitem-text')!
      ).color
      radice.remove()
      document.documentElement.removeAttribute('data-theme')
      expect(normale).not.toBe(attesa)
      return { voce, attesa }
    }
    it('«Elimina» e rossa (colore calcolato = --color-danger) in chiaro', () => {
      const { voce, attesa } = colore('light')
      expect(voce).toBe(attesa)
    })
    it('«Elimina» e rossa (colore calcolato = --color-danger) in scuro', () => {
      const { voce, attesa } = colore('dark')
      expect(voce).toBe(attesa)
    })
  })

  describe('Clienti', () => {
    let fixture: ComponentFixture<ClientiListComponent>
    let list: jasmine.Spy

    async function apri(role = 'ADMIN', elementi: unknown[] = [cliente()]) {
      list.and.returnValue(of({ elementi, totale: elementi.length }))
      TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
      fixture = TestBed.createComponent(ClientiListComponent)
      await stabilizza(fixture)
    }

    beforeEach(() => {
      list = jasmine.createSpy('list')
      TestBed.configureTestingModule({
        imports: [ClientiListComponent],
        providers: [
          provideNoopAnimations(),
          { provide: ClientiService, useValue: { clienti: { list } } },
          { provide: ToastService, useValue: jasmine.createSpyObj('T', ['error', 'success']) },
          { provide: TabelleFatturazioneService, useValue: {} },
          { provide: RegistryService, useValue: {} },
          MessageService,
          { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
        ],
      })
      TestBed.overrideComponent(ClienteDialogComponent, { set: { template: '' } })
    })
    afterEach(() => fixture?.destroy())

    it('la colonna Codice destinatario non si vede se nessuna riga ha il dato', async () => {
      await apri('ADMIN', [
        cliente({ codiceDestinatario: null }),
        cliente({ id: 'cl2', codiceDestinatario: '' }),
      ])
      expect(intestazioni()).not.toContain('Codice destinatario')
    })

    it('la colonna Codice destinatario si vede se almeno una riga ha il dato', async () => {
      await apri('ADMIN', [cliente({ codiceDestinatario: null }), cliente({ id: 'cl2' })])
      expect(intestazioni()).toContain('Codice destinatario')
    })

    it('le colonne Codice e Agente senza dati spariscono', async () => {
      await apri('ADMIN', [cliente({ codice: null, agente: null })])
      expect(intestazioni()).not.toContain('Codice')
      expect(intestazioni()).not.toContain('Agente')
    })

    it('sulla riga una sola azione (Modifica) e il bottone ⋯ con Disattiva ed Elimina in fondo', async () => {
      await apri()
      const riga = q('[data-testid="clienti-riga-cl1"]')!
      expect(riga.querySelectorAll('[data-testid="azione-principale"]').length).toBe(1)
      expect(riga.querySelectorAll('[data-testid="azioni-altre"]').length).toBe(1)
      expect(riga.querySelectorAll('button').length).toBe(2)
      expect(
        riga.querySelector('[data-testid="azione-principale"]')!.getAttribute('aria-label')
      ).toBe('Modifica il cliente Verdi Servizi S.r.l.')
      const voci = await apriMenuRiga(fixture, riga)
      expect(voci).toEqual(['Disattiva', 'Elimina'])
    })

    it('Riattiva per un cliente disattivo; niente Elimina se non eliminabile', async () => {
      await apri('ADMIN', [cliente({ attivo: false, eliminabile: false })])
      const voci = await apriMenuRiga(fixture, q('[data-testid="clienti-riga-cl1"]')!)
      expect(voci).toEqual(['Riattiva'])
    })

    it('P.IVA e Contratti sono colonne numeriche (num-col) e la P.IVA e in mono', async () => {
      await apri()
      const th = Array.from(document.body.querySelectorAll('thead th'))
      for (const nome of ['P.IVA / C.F.', 'Contratti']) {
        const colonna = th.findIndex(t => (t.textContent ?? '').trim() === nome)
        expect(th[colonna].classList).toContain('num-col')
        const cella = q('[data-testid="clienti-riga-cl1"]')!.querySelectorAll('td')[colonna]
        expect(cella.classList).toContain('num-col')
        expect(css(cella).textAlign).toBe('right')
      }
      const piva = q('[data-testid="clienti-riga-cl1"]')!.querySelectorAll('td')[1]
      expect(css(piva).fontFamily).not.toContain('Geist Mono')
      expect(css(piva.querySelector('.mono')!).fontFamily).toContain('Geist Mono')
      expect(piva.querySelector('.mono')!.textContent!.trim()).toBe('12345678903')
    })

    it('la tabella e una lista-telefono; con zero righe: testo dello stato vuoto, senza paginatore', async () => {
      await apri('ADMIN', [])
      expect(q('.p-datatable')!.classList).toContain('lista-telefono')
      expect(document.body.textContent).toContain('Nessun cliente.')
      expect(q('.p-paginator')).toBeNull()
    })

    it('la ricerca e larga almeno 320px e il segnaposto ci sta per intero; aria-label invariata', async () => {
      await apri()
      const campo = q<HTMLInputElement>('[data-testid="clienti-cerca"]')!
      expect(campo.getAttribute('aria-label')).toBe('Cerca un cliente')
      const contenitore = campo.closest('.barra-filtri__ricerca') as HTMLElement
      expect(css(contenitore).minWidth).toBe('320px')
      const ctx = document.createElement('canvas').getContext('2d')!
      const stile = css(campo)
      ctx.font = `${stile.fontWeight} ${stile.fontSize} ${stile.fontFamily}`
      const larghezzaTesto = ctx.measureText(campo.placeholder).width
      const utile = 320 - parseFloat(stile.paddingLeft) - parseFloat(stile.paddingRight)
      expect(larghezzaTesto).toBeLessThanOrEqual(utile)
    })

    it('un solo bottone primario: Nuovo cliente; gli altri tre sono a contorno', async () => {
      await apri()
      expect(primari().length).toBe(1)
      expect(primari()[0].textContent).toContain('Nuovo cliente')
    })

    it('VIEWER: niente ⋯, niente Modifica, niente colonna Azioni, nessun bottone primario', async () => {
      await apri('VIEWER')
      expect(q('[data-testid="azioni-altre"]')).toBeNull()
      expect(q('[data-testid="azione-principale"]')).toBeNull()
      expect(intestazioni()).not.toContain('Azioni')
      expect(primari().length).toBe(0)
    })

    it('la radice della pagina non ha padding laterale (il gutter e della shell)', async () => {
      await apri()
      const radice = q('section.pagina')!
      expect(css(radice).paddingLeft).toBe('0px')
      expect(css(radice).paddingRight).toBe('0px')
    })

    it('a 390px un nome di 80 caratteri non fa scorrere la pagina in orizzontale; ⋯ da 44px visibile', async () => {
      await apri('ADMIN', [cliente({ ditta: ditta(NOME_LUNGO) })])
      const { doc, iframe } = await inIframe390(q('section.pagina')!)
      try {
        const win = doc.defaultView as Window
        expect(win.innerWidth).toBe(390)
        expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual(doc.documentElement.clientWidth)
        const kebab = doc.querySelector('[data-testid="azioni-altre"]') as HTMLElement
        const r = kebab.getBoundingClientRect()
        expect(r.width).toBeGreaterThanOrEqual(44)
        expect(r.height).toBeGreaterThanOrEqual(44)
        expect(r.right).toBeLessThanOrEqual(390)
        const hide = doc.querySelector('td.m-hide') as Element
        expect(win.getComputedStyle(hide).display).toBe('none')
      } finally {
        iframe.remove()
      }
    })
  })

  describe('Agenti', () => {
    let fixture: ComponentFixture<AgentiListComponent>
    let list: jasmine.Spy

    async function apri(role = 'ADMIN', elementi: unknown[] = [agente()]) {
      list.and.returnValue(of({ elementi, totale: elementi.length }))
      TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
      fixture = TestBed.createComponent(AgentiListComponent)
      await stabilizza(fixture)
    }

    beforeEach(() => {
      list = jasmine.createSpy('list')
      TestBed.configureTestingModule({
        imports: [AgentiListComponent],
        providers: [
          provideNoopAnimations(),
          { provide: ClientiService, useValue: { agenti: { list } } },
          { provide: ToastService, useValue: jasmine.createSpyObj('T', ['error', 'success']) },
          { provide: TabelleFatturazioneService, useValue: {} },
          { provide: RegistryService, useValue: {} },
          MessageService,
          { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
        ],
      })
      TestBed.overrideComponent(AgenteDialogComponent, { set: { template: '' } })
    })
    afterEach(() => fixture?.destroy())

    it('la colonna Codice senza dati sparisce; Clienti e Contratti a destra', async () => {
      await apri('ADMIN', [agente({ codice: null })])
      expect(intestazioni()).not.toContain('Codice')
      const th = Array.from(document.body.querySelectorAll('thead th'))
      for (const nome of ['Clienti', 'Contratti']) {
        expect(th.find(t => (t.textContent ?? '').trim() === nome)!.classList).toContain('num-col')
      }
    })

    it('una azione sulla riga e il menu ⋯ con Disattiva ed Elimina', async () => {
      await apri()
      const riga = q('[data-testid="agenti-riga-a1"]')!
      expect(riga.querySelectorAll('button').length).toBe(2)
      expect(await apriMenuRiga(fixture, riga)).toEqual(['Disattiva', 'Elimina'])
    })

    it('zero righe: stato vuoto e nessun paginatore; lista-telefono', async () => {
      await apri('ADMIN', [])
      expect(document.body.textContent).toContain('Nessun agente.')
      expect(q('.p-paginator')).toBeNull()
      expect(q('.p-datatable')!.classList).toContain('lista-telefono')
    })

    it('Nuovo agente e l unico bottone primario', async () => {
      await apri()
      expect(primari().length).toBe(1)
    })

    it('VIEWER: senza azioni ne colonna Azioni', async () => {
      await apri('VIEWER')
      expect(primari().length).toBe(0)
      expect(q('[data-testid="azioni-altre"]')).toBeNull()
      expect(intestazioni()).not.toContain('Azioni')
    })
  })

  describe('Archivio addebiti', () => {
    let fixture: ComponentFixture<AddebitiListComponent>
    let list: jasmine.Spy

    async function apri(role = 'ADMIN', elementi: unknown[] = [addebito()]) {
      list.and.returnValue(of({ elementi, totale: elementi.length }))
      TestBed.overrideProvider(AuthService, { useValue: { currentUser: () => ({ role }) } })
      fixture = TestBed.createComponent(AddebitiListComponent)
      await stabilizza(fixture)
    }

    beforeEach(() => {
      list = jasmine.createSpy('list')
      TestBed.configureTestingModule({
        imports: [AddebitiListComponent],
        providers: [
          provideNoopAnimations(),
          { provide: LOCALE_ID, useValue: 'it-IT' },
          { provide: ListinoService, useValue: { addebiti: { list } } },
          { provide: ToastService, useValue: jasmine.createSpyObj('T', ['error', 'success']) },
          MessageService,
          { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
        ],
      })
      TestBed.overrideComponent(AddebitoDialogComponent, { set: { template: '' } })
      TestBed.overrideComponent(VariazioneArchivioDialogComponent, { set: { template: '' } })
    })
    afterEach(() => fixture?.destroy())

    it('il prezzo e a destra con due decimali all italiana', async () => {
      await apri()
      const riga = q('[data-testid="addebiti-riga-ad1"]')!
      const th = Array.from(document.body.querySelectorAll('thead th'))
      const i = th.findIndex(t => (t.textContent ?? '').trim() === 'Prezzo listino 1')
      expect(th[i].classList).toContain('num-col')
      const cella = riga.querySelectorAll('td')[i]
      expect((cella.textContent ?? '').trim()).toBe('5,00')
      expect(css(cella).textAlign).toBe('right')
    })

    it('principale Modifica, nel ⋯ Varia i prezzi, Disattiva ed Elimina', async () => {
      await apri()
      const riga = q('[data-testid="addebiti-riga-ad1"]')!
      expect(riga.querySelectorAll('button').length).toBe(2)
      expect(
        riga.querySelector('[data-testid="azione-principale"]')!.getAttribute('aria-label')
      ).toBe('Modifica l’addebito Trasporto rifiuti')
      expect(await apriMenuRiga(fixture, riga)).toEqual(['Varia i prezzi…', 'Disattiva', 'Elimina'])
    })

    it('le colonne U.M. e Prezzo senza dati spariscono', async () => {
      await apri('ADMIN', [addebito({ unitaMisura: '', listini: [] })])
      expect(intestazioni()).not.toContain('U.M.')
      expect(intestazioni()).not.toContain('Prezzo listino 1')
    })

    it('zero righe: stato vuoto, nessun paginatore; Nuovo addebito unico primario, Variazione prezzi a contorno', async () => {
      await apri('ADMIN', [])
      expect(document.body.textContent).toContain('Nessun addebito.')
      expect(q('.p-paginator')).toBeNull()
      expect(primari().length).toBe(1)
      expect(primari()[0].textContent).toContain('Nuovo addebito')
    })

    it('VIEWER: nessuna azione, nessuna colonna Azioni', async () => {
      await apri('VIEWER')
      expect(q('[data-testid="azioni-altre"]')).toBeNull()
      expect(q('[data-testid="azione-principale"]')).toBeNull()
      expect(intestazioni()).not.toContain('Azioni')
      expect(primari().length).toBe(0)
    })
  })

  describe('Tabelle di fatturazione', () => {
    it('Conti correnti: una azione + ⋯, colonna Banca vuota nascosta, lista-telefono, zero righe senza paginatore', async () => {
      const tabella = tabellaFinta()
      const conto = {
        id: 'k1',
        versione: 2,
        eliminabile: true,
        codice: 'BP',
        descrizione: 'Principale',
        banca: '',
        bic: null,
        attivo: true,
        ibanMascherato: 'IT60 **** 3456',
      }
      tabella.list.and.returnValue(of([conto]))
      TestBed.configureTestingModule({
        imports: [ContiCorrentiComponent],
        providers: [
          provideNoopAnimations(),
          { provide: TabelleFatturazioneService, useValue: { conti: tabella } },
          { provide: ToastService, useValue: jasmine.createSpyObj('T', ['error', 'success']) },
          { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
        ],
      })
      const fixture = TestBed.createComponent(ContiCorrentiComponent)
      await stabilizza(fixture)
      expect(intestazioni()).not.toContain('Banca')
      expect(q('.p-datatable')!.classList).toContain('lista-telefono')
      const riga = q('[data-testid="conto-riga-BP"]')!
      expect(riga.querySelectorAll('button').length).toBe(2)
      expect(await apriMenuRiga(fixture, riga)).toEqual(['Disattiva', 'Elimina'])
      expect(primari().length).toBe(1)
      chiudiMenuRiga()
      fixture.destroy()

      tabella.list.and.returnValue(of([]))
      const vuoto = TestBed.createComponent(ContiCorrentiComponent)
      await stabilizza(vuoto)
      expect(document.body.textContent).toContain('Nessun conto corrente.')
      expect(q('.p-paginator')).toBeNull()
      expect(q('.p-datatable')!.classList).toContain('senza-righe')
      vuoto.destroy()
    })

    it('Spese: importo a destra con due decimali all italiana', async () => {
      const tabella = tabellaFinta()
      tabella.list.and.returnValue(
        of([
          {
            id: 's1',
            versione: 1,
            eliminabile: false,
            tipo: 'BOLLO',
            codice: 'B1',
            descrizione: 'Bollo',
            importo: '2.00',
            attiva: true,
            codiceIvaId: null,
          },
        ])
      )
      TestBed.configureTestingModule({
        imports: [SpeseAccessorieComponent],
        providers: [
          provideNoopAnimations(),
          { provide: LOCALE_ID, useValue: 'it-IT' },
          { provide: TabelleFatturazioneService, useValue: { spese: tabella } },
          { provide: ListinoService, useValue: { codiciIva: { list: () => of([]) } } },
          { provide: ToastService, useValue: jasmine.createSpyObj('T', ['error', 'success']) },
          { provide: AuthService, useValue: { currentUser: () => ({ role: 'ADMIN' }) } },
        ],
      })
      const fixture = TestBed.createComponent(SpeseAccessorieComponent)
      await stabilizza(fixture)
      const th = Array.from(document.body.querySelectorAll('thead th'))
      const i = th.findIndex(t => (t.textContent ?? '').trim() === 'Importo')
      expect(th[i].classList).toContain('num-col')
      const cella = q('[data-testid="spesa-riga-B1"]')!.querySelectorAll('td')[i]
      expect((cella.textContent ?? '').trim()).toBe('2,00')
      // non eliminabile: nel menu solo Disattiva
      expect(await apriMenuRiga(fixture, q('[data-testid="spesa-riga-B1"]')!)).toEqual([
        'Disattiva',
      ])
      chiudiMenuRiga()
      fixture.destroy()
    })

    it('griglia delle codifiche: una azione + ⋯, VIEWER senza colonna Azioni', async () => {
      TestBed.configureTestingModule({
        imports: [CodificheGrigliaComponent],
        providers: [provideNoopAnimations()],
      })
      const fixture = TestBed.createComponent(CodificheGrigliaComponent)
      fixture.componentRef.setInput('righe', [
        {
          id: 'x1',
          genere: 'GRUPPO',
          codice: '01',
          descrizione: 'Trasporti',
          attiva: true,
          versione: 1,
          eliminabile: true,
        },
      ])
      fixture.componentRef.setInput('puoScrivere', true)
      fixture.componentRef.setInput(
        'testid',
        (a: string, c: { codice: string }) => `cod-${a}-${c.codice}`
      )
      await stabilizza(fixture)
      const riga = q('[data-testid="cod-riga-01"]')!
      expect(q('.p-datatable')!.classList).toContain('lista-telefono')
      expect(riga.querySelectorAll('button').length).toBe(2)
      expect(await apriMenuRiga(fixture, riga)).toEqual(['Disattiva', 'Elimina'])
      chiudiMenuRiga()
      fixture.componentRef.setInput('puoScrivere', false)
      await stabilizza(fixture)
      expect(q('[data-testid="azioni-altre"]')).toBeNull()
      expect(intestazioni()).not.toContain('Azioni')
      fixture.destroy()
    })
  })
})
