import { Type } from '@angular/core'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { ConfirmationService, MessageService } from 'primeng/api'
import { of } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { apriMenuRiga, chiudiMenuRiga, scegliVoceRiga } from '../clienti/tabelle/azioni-test-utils'
import { stabilizza } from '../clienti/tabelle/tabelle-test-utils'
import { DestinatariListComponent } from './destinatari-list.component'
import { ProduttoriListComponent } from './produttori-list.component'
import { RegistryService } from './registry.service'
import { TrasportatoriListComponent } from './trasportatori-list.component'

/**
 * Task 11 (giro 2): Produttori, Trasportatori e Destinatari hanno un solo pattern di lista:
 * una azione sulla riga («Modifica <ragione sociale>») e il menu ⋯ con «Sedi (n)» ed «Elimina»,
 * colonne vuote nascoste, lista a due righe sul telefono, niente paginatore a zero righe, un
 * solo bottone primario, nessun maiuscolo spaziato.
 */
const NOME_LUNGO =
  'Acciaierie e Lavorazioni Metalliche della Valdelsa Societa Per Azioni Unipersonale S.r.l.'
const INDIRIZZO = { via: 'Via Roma', civico: '1', cap: '20100', comune: 'Milano', provincia: 'MI' }

interface Caso {
  area: 'produttori' | 'trasportatori' | 'destinatari'
  componente: Type<unknown>
  metodoLista: string
  /** Colonna con il numero di iscrizione/autorizzazione (assente per i produttori). */
  colonnaNumero: string | null
  riga: (over?: Record<string, unknown>) => Record<string, unknown>
}

const base = {
  id: 'r1',
  ragioneSociale: 'ACME S.r.l.',
  partitaIVA: '12345678903',
  codiceFiscale: null,
  pec: 'acme@pec.it',
  dittaId: 'dit1',
  sedeId: 'sed1',
  numeroSedi: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const CASI: Caso[] = [
  {
    area: 'produttori',
    componente: ProduttoriListComponent,
    metodoLista: 'getProduttori',
    colonnaNumero: null,
    riga: over => ({ ...base, sedeLegale: INDIRIZZO, ...over }),
  },
  {
    area: 'trasportatori',
    componente: TrasportatoriListComponent,
    metodoLista: 'getTrasportatori',
    colonnaNumero: 'N. iscrizione Albo',
    riga: over => ({ ...base, sedeLegale: INDIRIZZO, numeroIscrizione: 'MI/000123', ...over }),
  },
  {
    area: 'destinatari',
    componente: DestinatariListComponent,
    metodoLista: 'getDestinatari',
    colonnaNumero: 'N. autorizzazione',
    riga: over => ({ ...base, sede: INDIRIZZO, numeroAutorizzazione: 'AUT/2026/1', ...over }),
  },
]

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

for (const caso of CASI) {
  describe(`Lista ${caso.area} (pattern delle liste, Task 11)`, () => {
    let fixture: ComponentFixture<unknown>
    let servizio: jasmine.SpyObj<RegistryService>
    let ruolo = 'ADMIN'

    async function apri(role = 'ADMIN', righe: Record<string, unknown>[] = [caso.riga()]) {
      ;(servizio as unknown as Record<string, jasmine.Spy>)[caso.metodoLista].and.returnValue(
        of({ items: righe, total: righe.length, page: 1, limit: 10, totalPages: 1 })
      )
      ruolo = role
      fixture = TestBed.createComponent(caso.componente)
      await stabilizza(fixture)
    }

    const riga = (id = 'r1') => q(`[data-testid="${caso.area}-row-${id}"]`)!

    beforeEach(() => {
      servizio = jasmine.createSpyObj<RegistryService>('RegistryService', [
        'getProduttori',
        'getTrasportatori',
        'getDestinatari',
        'deleteProduttore',
        'deleteTrasportatore',
        'deleteDestinatario',
        'getDitta',
        'cercaDitta',
      ])
      servizio.getDitta.and.returnValue(
        of({
          id: 'dit1',
          ragioneSociale: 'ACME S.r.l.',
          partitaIva: null,
          codiceFiscale: null,
          partitaIvaDaVerificare: false,
          privato: false,
          sedi: [],
          ruoli: {},
        })
      )
      TestBed.configureTestingModule({
        imports: [caso.componente],
        providers: [
          provideNoopAnimations(),
          { provide: RegistryService, useValue: servizio },
          { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
          MessageService,
          ConfirmationService,
        ],
      })
    })
    afterEach(() => {
      chiudiMenuRiga()
      fixture?.destroy()
      document.querySelectorAll('.p-dialog-mask, .p-confirm-dialog').forEach(e => e.remove())
    })

    it('la colonna PEC senza dati sparisce; con almeno un dato si vede', async () => {
      await apri('ADMIN', [caso.riga({ pec: undefined }), caso.riga({ id: 'r2', pec: '' })])
      expect(intestazioni()).not.toContain('PEC')
      fixture.destroy()
      await apri('ADMIN', [caso.riga({ pec: undefined }), caso.riga({ id: 'r2' })])
      expect(intestazioni()).toContain('PEC')
    })

    it('la colonna del numero di iscrizione/autorizzazione senza dati sparisce', async function () {
      if (!caso.colonnaNumero) {
        pending('i produttori non hanno questa colonna')
        return
      }
      const chiave = caso.area === 'trasportatori' ? 'numeroIscrizione' : 'numeroAutorizzazione'
      await apri('ADMIN', [caso.riga({ [chiave]: '' })])
      expect(intestazioni()).not.toContain(caso.colonnaNumero)
      fixture.destroy()
      await apri()
      expect(intestazioni()).toContain(caso.colonnaNumero)
    })

    it('sulla riga una sola azione («Modifica <nome>») e il ⋯ con «Sedi (n)» ed «Elimina» in fondo', async () => {
      await apri()
      expect(riga().querySelectorAll('[data-testid="azione-principale"]').length).toBe(1)
      expect(riga().querySelectorAll('[data-testid="azioni-altre"]').length).toBe(1)
      expect(riga().querySelectorAll('button').length).toBe(2)
      expect(
        riga().querySelector('[data-testid="azione-principale"]')!.getAttribute('aria-label')
      ).toBe('Modifica ACME S.r.l.')
      expect(riga().querySelector('[data-testid="azioni-altre"]')!.getAttribute('aria-label')).toBe(
        'Altre azioni per ACME S.r.l.'
      )
      expect(await apriMenuRiga(fixture, riga())).toEqual(['Sedi (3)', 'Elimina'])
    })

    it('senza ditta nel menu c e solo «Elimina»; «Sedi» vale 1 se manca numeroSedi', async () => {
      await apri('ADMIN', [caso.riga({ dittaId: undefined })])
      expect(await apriMenuRiga(fixture, riga())).toEqual(['Elimina'])
      chiudiMenuRiga()
      fixture.destroy()
      await apri('ADMIN', [caso.riga({ numeroSedi: undefined })])
      expect(await apriMenuRiga(fixture, riga())).toEqual(['Sedi (1)', 'Elimina'])
    })

    it('«Sedi (n)» dal menu apre il dialog delle sedi della ditta', async () => {
      await apri()
      await scegliVoceRiga(fixture, riga(), 'Sedi')
      expect(servizio.getDitta).toHaveBeenCalledOnceWith('dit1')
      expect(document.body.textContent).toContain('Sedi di ACME S.r.l.')
    })

    it('«Elimina» chiede conferma: bottone rosso «Elimina», «Annulla» in testo', async () => {
      await apri()
      await scegliVoceRiga(fixture, riga(), 'Elimina')
      await stabilizza(fixture)
      const accetta = q('.p-confirm-dialog-accept')!
      expect(accetta.textContent).toContain('Elimina')
      expect(accetta.classList).toContain('p-button-danger')
      expect(q('.p-confirm-dialog-reject')!.textContent).toContain('Annulla')
      expect(document.body.textContent).toContain('ACME S.r.l.')
    })

    it('la P.IVA e a destra e in mono, il prefisso no', async () => {
      await apri()
      const th = Array.from(document.body.querySelectorAll('thead th'))
      const i = th.findIndex(t => (t.textContent ?? '').trim() === 'P.IVA / C.F.')
      expect(th[i].classList).toContain('num-col')
      const cella = riga().querySelectorAll('td')[i]
      expect(cella.classList).toContain('num-col')
      expect(css(cella).textAlign).toBe('right')
      expect(css(cella).fontFamily).not.toContain('Geist Mono')
      expect(css(cella.querySelector('.mono')!).fontFamily).toContain('Geist Mono')
      expect(cella.querySelector('.mono')!.textContent!.trim()).toBe('12345678903')
    })

    it('la tabella e una lista-telefono; con zero righe: stato vuoto uguale per le tre, senza paginatore', async () => {
      await apri('ADMIN', [])
      expect(q('.p-datatable')!.classList).toContain('lista-telefono')
      expect(q('.empty-state__title')!.textContent).toContain('Nessun')
      expect(q('.p-paginator')).toBeNull()
    })

    it('nessun maiuscolo spaziato in tutta la pagina', async () => {
      await apri()
      const colpevoli = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('*')
      ).filter(e => css(e).textTransform === 'uppercase')
      expect(colpevoli.map(e => e.className)).toEqual([])
    })

    it('la ricerca e un campo search con la sua aria-label', async () => {
      await apri()
      const campo = q<HTMLInputElement>('.barra-filtri__ricerca input')!
      expect(campo.type).toBe('search')
      expect(campo.getAttribute('aria-label')).toContain('Cerca')
    })

    it('un solo bottone primario: Nuovo; con zero righe resta uno solo (lo stato vuoto non ne aggiunge)', async () => {
      await apri()
      expect(primari().length).toBe(1)
      expect(primari()[0].textContent).toContain('Nuovo')
      fixture.destroy()
      await apri('ADMIN', [])
      expect(primari().length).toBe(1)
    })

    it('VIEWER senza ditta: nessuna azione, nessuna colonna Azioni, nessun primario', async () => {
      await apri('VIEWER', [caso.riga({ dittaId: undefined })])
      expect(q('[data-testid="azioni-altre"]')).toBeNull()
      expect(q('[data-testid="azione-principale"]')).toBeNull()
      expect(intestazioni()).not.toContain('Azioni')
      expect(primari().length).toBe(0)
    })

    it('VIEWER con ditta: solo «Sedi» sulla riga come azione principale, senza ⋯', async () => {
      await apri('VIEWER')
      expect(intestazioni()).toContain('Azioni')
      expect(riga().querySelectorAll('button').length).toBe(1)
      expect(
        riga().querySelector('[data-testid="azione-principale"]')!.getAttribute('aria-label')
      ).toBe('Sedi di ACME S.r.l.')
      expect(q('[data-testid="azioni-altre"]')).toBeNull()
    })

    it('a 390px un nome di 80 caratteri non fa scorrere la pagina; ⋯ da 44px; colonne secondarie nascoste', async () => {
      await apri('ADMIN', [caso.riga({ ragioneSociale: NOME_LUNGO })])
      const { doc, iframe } = await inIframe390(fixture.nativeElement as HTMLElement)
      try {
        const win = doc.defaultView as Window
        expect(win.innerWidth).toBe(390)
        expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual(doc.documentElement.clientWidth)
        const kebab = doc.querySelector('[data-testid="azioni-altre"]') as HTMLElement
        const r = kebab.getBoundingClientRect()
        expect(r.width).toBeGreaterThanOrEqual(44)
        expect(r.height).toBeGreaterThanOrEqual(44)
        expect(r.right).toBeLessThanOrEqual(390)
        const nascosta = doc.querySelector('tbody td.m-hide') as Element
        expect(win.getComputedStyle(nascosta).display).toBe('none')
        const tr = doc.querySelector('tbody tr') as HTMLElement
        expect(win.getComputedStyle(tr).display).toBe('grid')
        // il testo della riga non tocca il bordo del riquadro
        const riquadro = doc.querySelector('.registry-panel') as HTMLElement
        const nome = doc.querySelector('tbody td.chi') as HTMLElement
        expect(
          nome.getBoundingClientRect().left - riquadro.getBoundingClientRect().left
        ).toBeGreaterThanOrEqual(16)
      } finally {
        iframe.remove()
      }
    })

    it('la radice della pagina non ha padding laterale (il gutter e della shell)', async () => {
      await apri()
      const radice = q('.page')!
      expect(css(radice).paddingLeft).toBe('0px')
      expect(css(radice).paddingRight).toBe('0px')
    })
  })
}
