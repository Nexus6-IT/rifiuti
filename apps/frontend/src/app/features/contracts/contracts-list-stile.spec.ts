import { registerLocaleData } from '@angular/common'
import localeIt from '@angular/common/locales/it'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { MessageService } from 'primeng/api'
import { of, throwError } from 'rxjs'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { CerService } from '../cer/cer.service'
import { RegistryService } from '../registry/registry.service'
import { apriMenuRiga, chiudiMenuRiga } from '../clienti/tabelle/azioni-test-utils'
import { ContractsListComponent } from './contracts-list.component'
import { CAMPI_CONTRATTO, Contract, ContractsService } from './contracts.service'

registerLocaleData(localeIt, 'it-IT')

/**
 * Task 12 (giro 2): la lista dei contratti del produttore segue il pattern delle liste: una azione
 * sulla riga e le altre nel menu ⋯, colonne vuote nascoste, lista a due righe sul telefono,
 * niente paginatore a zero righe, un solo bottone primario, niente «Aggiorna».
 */
const NOME_LUNGO =
  'Acciaierie e Lavorazioni Metalliche della Valdelsa Societa Per Azioni Unipersonale S.r.l.'

const contratto = (over: Partial<Contract> = {}): Contract =>
  ({
    id: 'c1',
    contractNumber: 'CTR-2026-001',
    contractType: 'WASTE_TRANSPORT',
    status: 'DRAFT',
    startDate: '2026-01-15T00:00:00.000Z',
    endDate: '2026-12-31T00:00:00.000Z',
    versione: 3,
    modificabili: [...CAMPI_CONTRATTO],
    eliminabile: true,
    counterparty: {
      id: 'x1',
      ragioneSociale: 'Verdi Trasporti S.r.l.',
      partitaIVA: '12345678903',
      codiceFiscale: null,
    },
    ...over,
  }) as unknown as Contract

const css = (el: Element) => getComputedStyle(el)
const q = <T extends HTMLElement = HTMLElement>(sel: string): T | null =>
  document.body.querySelector<T>(sel)
const intestazioni = (): string[] =>
  Array.from(document.body.querySelectorAll('thead th')).map(t => (t.textContent ?? '').trim())
const primari = (): HTMLElement[] => Array.from(document.body.querySelectorAll('.wf-primario'))

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

describe('ContractsListComponent: pattern delle liste (Task 12)', () => {
  let fixture: ComponentFixture<ContractsListComponent>
  let contracts: jasmine.SpyObj<ContractsService>
  let ruoloCorrente = 'OPERATOR'

  async function apri(righe: Contract[] = [contratto()], ruolo = 'OPERATOR') {
    ruoloCorrente = ruolo
    contracts.list.and.returnValue(of(righe))
    fixture = TestBed.createComponent(ContractsListComponent)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
  }

  beforeEach(() => {
    contracts = jasmine.createSpyObj<ContractsService>('ContractsService', [
      'list',
      'getById',
      'elimina',
      'updateStatus',
      'nextNumber',
      'create',
      'update',
    ])
    const vuoto = of({ items: [], total: 0, page: 1, limit: 10, totalPages: 0 })
    const registry = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
    ])
    registry.getProduttori.and.returnValue(vuoto)
    registry.getTrasportatori.and.returnValue(vuoto)
    registry.getDestinatari.and.returnValue(vuoto)
    const cer = jasmine.createSpyObj<CerService>('CerService', ['searchCER'])
    cer.searchCER.and.returnValue(of([]))
    TestBed.configureTestingModule({
      imports: [ContractsListComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ContractsService, useValue: contracts },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('T', ['error', 'success', 'warn']),
        },
        { provide: RegistryService, useValue: registry },
        { provide: CerService, useValue: cer },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruoloCorrente }) } },
      ],
    })
  })
  afterEach(() => {
    chiudiMenuRiga()
    fixture?.destroy()
  })

  it('sulla riga una sola azione (Modifica) e il bottone ⋯ con Cambia stato ed Elimina in fondo', async () => {
    await apri()
    const riga = q('[data-testid="contratti-riga-c1"]')!
    expect(riga.querySelectorAll('[data-testid="azione-principale"]').length).toBe(1)
    expect(riga.querySelectorAll('[data-testid="azioni-altre"]').length).toBe(1)
    expect(riga.querySelectorAll('button').length).toBe(2)
    expect(
      riga.querySelector('[data-testid="azione-principale"]')!.getAttribute('aria-label')
    ).toBe('Modifica il contratto CTR-2026-001')
    expect(riga.querySelector('[data-testid="azioni-altre"]')!.getAttribute('aria-label')).toBe(
      'Altre azioni per CTR-2026-001'
    )
    const voci = await apriMenuRiga(fixture, riga)
    expect(voci).toEqual(['Cambia stato', 'Elimina'])
  })

  it('un contratto non eliminabile non ha «Elimina»; uno senza transizioni ha «Cambia stato» disabilitato col motivo', async () => {
    await apri([contratto({ status: 'TERMINATED', eliminabile: false, modificabili: [] })])
    const riga = q('[data-testid="contratti-riga-c1"]')!
    const voci = await apriMenuRiga(fixture, riga)
    expect(voci.length).toBe(1)
    expect(voci[0]).toContain('Cambia stato')
    expect(voci[0]).toContain('Non disponibile')
    expect(
      q('.p-menu [role="menuitem"] [aria-disabled="true"], .p-menu .p-disabled')
    ).not.toBeNull()
  })

  it('Modifica non disponibile: il motivo e nel nome accessibile e nel title', async () => {
    await apri([contratto({ status: 'PENDING_APPROVAL', modificabili: [] })])
    const b = q('[data-testid="azione-principale"]') as HTMLButtonElement
    expect(b.disabled).toBeTrue()
    expect(b.getAttribute('aria-label')).toContain('Riporta il contratto in bozza')
    expect(b.getAttribute('title')).toContain('Riporta il contratto in bozza')
  })

  it('niente «Aggiorna»; resta «Riprova» nello stato di errore', async () => {
    await apri()
    expect(q('button[aria-label="Aggiorna l\'elenco dei contratti"]')).toBeNull()
    expect(document.body.textContent).not.toContain('Aggiorna')
    fixture.destroy()
    contracts.list.and.returnValue(throwError(() => new Error('x')))
    fixture = TestBed.createComponent(ContractsListComponent)
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(document.body.textContent).toContain('Riprova')
  })

  it('un solo bottone primario: Nuovo contratto', async () => {
    await apri()
    expect(primari().length).toBe(1)
    expect(primari()[0].textContent).toContain('Nuovo contratto')
  })

  it('la tabella e una lista-telefono; con zero righe: stato vuoto e niente paginatore', async () => {
    await apri([])
    expect(q('.p-datatable')!.classList).toContain('lista-telefono')
    expect(document.body.textContent).toContain('Nessun contratto')
    expect(q('.p-paginator')).toBeNull()
    expect(q('.p-datatable-thead')).not.toBeNull()
  })

  it('il paginatore compare solo oltre una pagina di righe', async () => {
    await apri(Array.from({ length: 10 }, (_, i) => contratto({ id: `c${i}` })))
    expect(q('.p-paginator')).toBeNull()
    fixture.destroy()
    await apri(Array.from({ length: 11 }, (_, i) => contratto({ id: `c${i}` })))
    expect(q('.p-paginator')).not.toBeNull()
  })

  it('la colonna Periodo senza dati sparisce, con almeno una data si vede', async () => {
    await apri([contratto({ startDate: null as never, endDate: null })])
    expect(intestazioni()).not.toContain('Periodo')
    fixture.destroy()
    await apri()
    expect(intestazioni()).toContain('Periodo')
  })

  it('numero contratto e P. IVA in mono solo sul numero; nessun maiuscolo spaziato', async () => {
    await apri()
    const riga = q('[data-testid="contratti-riga-c1"]')!
    const numero = riga.querySelector('.mono-numero') as HTMLElement
    expect(numero.textContent!.trim()).toBe('CTR-2026-001')
    expect(css(numero).fontFamily).toContain('Geist Mono')
    expect(css(numero.closest('td')!).whiteSpace).toBe('nowrap')
    const piva = riga.querySelector('.controparte__piva') as HTMLElement
    expect(css(piva).fontFamily).not.toContain('Geist Mono')
    expect(css(piva.querySelector('.mono')!).fontFamily).toContain('Geist Mono')
    expect(piva.querySelector('.mono')!.textContent!.trim()).toBe('12345678903')
    for (const th of Array.from(document.body.querySelectorAll('thead th'))) {
      expect(css(th).textTransform).not.toBe('uppercase')
    }
  })

  it('la radice della pagina non ha padding laterale (il gutter e della shell)', async () => {
    await apri()
    const radice = q('.page')!
    expect(css(radice).paddingLeft).toBe('0px')
    expect(css(radice).paddingRight).toBe('0px')
  })

  it('a 390px un nome di 80 caratteri non scorre in orizzontale; ⋯ da 44px; colonne secondarie nascoste', async () => {
    await apri([
      contratto({
        counterparty: {
          id: 'x',
          ragioneSociale: NOME_LUNGO,
          partitaIVA: '12345678903',
          codiceFiscale: null,
        } as never,
      }),
    ])
    const { doc, iframe } = await inIframe390(q('.page')!)
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
      const tr = doc.querySelector('tbody tr') as HTMLElement
      expect(win.getComputedStyle(tr).display).toBe('grid')
    } finally {
      iframe.remove()
    }
  })

  describe('ruoli', () => {
    it('OPERATOR: Nuovo contratto, colonna Azioni, Modifica e ⋯', async () => {
      await apri([contratto()], 'OPERATOR')
      expect(document.body.textContent).toContain('Nuovo contratto')
      expect(intestazioni()).toContain('Azioni')
      expect(q('[data-testid="azione-principale"]')).not.toBeNull()
      expect(q('[data-testid="azioni-altre"]')).not.toBeNull()
    })

    it("VIEWER: legge l'elenco, senza Nuovo contratto, colonna Azioni, Modifica e ⋯", async () => {
      await apri([contratto()], 'VIEWER')
      expect(document.body.textContent).toContain('CTR-2026-001')
      expect(document.body.textContent).not.toContain('Nuovo contratto')
      expect(primari().length).toBe(0)
      expect(intestazioni()).not.toContain('Azioni')
      expect(q('[data-testid="azione-principale"]')).toBeNull()
      expect(q('[data-testid="azioni-altre"]')).toBeNull()
      const celle = q('[data-testid="contratti-riga-c1"]')!.querySelectorAll('td').length
      expect(celle).toBe(intestazioni().length)
    })

    it('VIEWER con zero righe: lo stato vuoto copre tutte le colonne', async () => {
      await apri([], 'VIEWER')
      const td = q('tbody td[colspan]')!
      expect(Number(td.getAttribute('colspan'))).toBe(intestazioni().length)
    })
  })

  describe('cambio di stato verso uno stato finale', () => {
    const apriDialog = async (stato: 'ACTIVE' | 'TERMINATED' | 'EXPIRED') => {
      await apri([contratto({ status: 'ACTIVE' })])
      const c = fixture.componentInstance
      c.openStatusDialog(contratto({ status: 'ACTIVE' }))
      c.targetStatus = stato
      fixture.detectChanges()
      await fixture.whenStable()
      fixture.detectChanges()
    }
    const conferma = () =>
      Array.from(document.body.querySelectorAll<HTMLButtonElement>('.p-dialog-footer button')).find(
        b => b.textContent?.includes('Conferma')
      )!

    it('Risolto: bottone rosso e avviso «non si potrà tornare indietro»', async () => {
      await apriDialog('TERMINATED')
      expect(conferma().classList).toContain('p-button-danger')
      expect(q('[data-testid="avviso-terminale"]')!.textContent).toContain(
        'Non si potrà tornare indietro'
      )
    })

    it('Scaduto: bottone rosso e avviso', async () => {
      await apriDialog('EXPIRED')
      expect(conferma().classList).toContain('p-button-danger')
      expect(q('[data-testid="avviso-terminale"]')).not.toBeNull()
    })

    it('Sospeso o Attivo: bottone normale, nessun avviso', async () => {
      await apriDialog('ACTIVE')
      expect(conferma().classList).not.toContain('p-button-danger')
      expect(q('[data-testid="avviso-terminale"]')).toBeNull()
    })
  })
})
