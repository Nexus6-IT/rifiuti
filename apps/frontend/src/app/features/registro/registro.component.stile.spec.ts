import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { DatePipe } from '@angular/common'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { provideRouter } from '@angular/router'
import { of } from 'rxjs'
import { RegistroComponent } from './registro.component'
import { Movimento, RegistroService, RegistroVista } from './registro.service'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'

/**
 * Registro, giro 2: «Carico»/«Scarico» in sentence case con la freccia come icona grigia, «kg» in
 * grigio normale, «Nei termini» senza colore (tono `none`), il colore solo su «Fuori termine»;
 * il bottone «Registra movimento» e' l'unico primario.
 */
const registro: RegistroVista = {
  id: 'r1',
  unitaLocaleId: 'u1',
  numIscrSito: null,
  denominazione: 'Sede',
  codice: 'CARICO_SCARICO',
  attivo: true,
  principale: true,
}

const mov = (id: string, p: Record<string, unknown>): Movimento =>
  ({
    id,
    registroId: 'r1',
    progressiveNumber: 1,
    progressiveYear: 2026,
    type: 'CARICO',
    movementDate: '2026-10-20T00:00:00.000Z',
    causale: 'CARICO_DA_TERZI',
    cerCode: '17 04 05',
    quantity: 1240.5,
    unit: 'KG',
    stato: 'VIGENTE',
    tipoAnnotazione: 'ORDINARIA',
    fuoriTermine: false,
    ...p,
  }) as unknown as Movimento

describe('Registro: stile del giro 2', () => {
  let fixture: ComponentFixture<RegistroComponent>

  const riga = (id: string): HTMLElement =>
    fixture.nativeElement.querySelector(`[data-testid="registro-riga-${id}"]`)

  beforeEach(() => {
    const servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'lista',
      'listRegistri',
      'assicuraRegistri',
      'getProgressivoIniziale',
    ])
    servizio.lista.and.returnValue(
      of({
        items: [
          mov('a', { type: 'CARICO' }),
          mov('b', { type: 'SCARICO', unit: 'T', fuoriTermine: true, ritardoGg: 20 }),
        ],
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      })
    )
    servizio.assicuraRegistri.and.returnValue(of([registro]))
    servizio.listRegistri.and.returnValue(of([registro]))
    servizio.getProgressivoIniziale.and.returnValue(
      of({
        anno: 2026,
        registroId: 'r1',
        primoProgressivo: null,
        impostatoIl: null,
        haMovimenti: true,
        puoImpostare: false,
        puoRegistrare: true,
      })
    )
    TestBed.configureTestingModule({
      imports: [RegistroComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        DatePipe,
        { provide: RegistroService, useValue: servizio },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn']),
        },
        { provide: ExportService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: () => ({ role: 'OPERATOR' }) } },
        { provide: AdminTenantContextService, useValue: { selectedTenantName: () => 'Azienda' } },
        {
          provide: CompanyService,
          useValue: { loadActiveCompany: () => of(null), activeCompany: () => null },
        },
        { provide: FirService, useValue: { getFIRList: () => of({ items: [] }) } },
        { provide: RegistryService, useValue: { getProduttori: () => of({ items: [] }) } },
      ],
    })
    fixture = TestBed.createComponent(RegistroComponent)
    fixture.detectChanges()
  })

  afterEach(() => fixture?.destroy())

  it('il tipo e testo in sentence case con la freccia come icona grigia, non una pillola colorata', () => {
    const tipo = riga('a').querySelector<HTMLElement>('[data-testid="registro-tipo"]')!
    expect(tipo.textContent!.trim()).toBe('Carico')
    expect(riga('b').querySelector('[data-testid="registro-tipo"]')!.textContent!.trim()).toBe(
      'Scarico'
    )
    expect(riga('a').querySelector('td p-tag[ng-reflect-value="CARICO"]')).toBeNull()
    const freccia = tipo.querySelector<HTMLElement>('i.pi-arrow-down')!
    expect(freccia).not.toBeNull()
    expect(freccia.getAttribute('aria-hidden')).toBe('true')
    const sonda = document.createElement('span')
    sonda.style.color = 'var(--text-tertiary)'
    document.body.appendChild(sonda)
    expect(getComputedStyle(freccia).color).toBe(getComputedStyle(sonda).color)
    sonda.remove()
    expect(getComputedStyle(tipo).textTransform).toBe('none')
    expect(riga('b').querySelector('i.pi-arrow-up')).not.toBeNull()
  })

  it('l unita e in minuscolo, nel grigio del testo secondario e senza maiuscoletto', () => {
    const unita = riga('a').querySelector<HTMLElement>('.unit')!
    expect(unita.textContent!.trim()).toBe('kg')
    expect(riga('b').querySelector('.unit')!.textContent!.trim()).toBe('t')
    const sonda = document.createElement('span')
    sonda.style.color = 'var(--text-secondary)'
    document.body.appendChild(sonda)
    expect(getComputedStyle(unita).color).toBe(getComputedStyle(sonda).color)
    sonda.remove()
    const stile = getComputedStyle(unita)
    expect(stile.textTransform).toBe('none')
    expect(stile.fontVariantCaps).toBe('normal')
    expect(stile.fontWeight).toBe('400')
  })

  it('la quantita sta a destra e in cifre tabellari', () => {
    const cella = riga('a').querySelector<HTMLElement>('td.num-col')!
    expect(getComputedStyle(cella).textAlign).toBe('right')
    expect(getComputedStyle(cella.querySelector('.num')!).fontVariantNumeric).toContain(
      'tabular-nums'
    )
  })

  it('«Nei termini» non ha colore (tono none); il colore e solo su «Fuori termine»', () => {
    const neiTermini = riga('a').querySelector<HTMLElement>('app-pillola-stato .tono-none')!
    expect(neiTermini.textContent!.trim()).toBe('Nei termini')
    expect(riga('a').querySelector('.tono-ok, .p-tag-success')).toBeNull()
    const fuori = riga('b').querySelector<HTMLElement>('app-pillola-stato .tono-warn')!
    expect(fuori.textContent).toContain('Fuori termine')
    expect(riga('b').querySelector('.tono-none')).toBeNull()
  })

  it('un solo bottone primario: «Registra movimento»', () => {
    const primari = fixture.nativeElement.querySelectorAll('.wf-primario')
    expect(primari.length).toBe(1)
    expect(
      fixture.nativeElement.querySelector('[data-testid="registro-nuovo"] button').classList
    ).toContain('wf-primario')
  })
})
