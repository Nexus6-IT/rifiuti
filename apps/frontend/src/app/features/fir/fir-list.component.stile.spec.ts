import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { provideRouter } from '@angular/router'
import { MessageService, ConfirmationService } from 'primeng/api'
import { of } from 'rxjs'
import { FirListComponent } from './fir-list.component'
import { FirService } from './fir.service'
import { FIR, FIRStato } from '../../shared/models/fir.model'
import { RegistryService } from '../registry/registry.service'
import { ExportService } from '../../core/services/export.service'
import { RENTRISyncService } from './services/rentri-sync.service'
import { AuthService } from '../../core/services/auth.service'
import { PeseService } from '../pese/pese.service'
import { RentriBlocchiService } from '../rentri/rentri-blocchi.service'
import { FeatureFlagsService } from '../../core/services/feature-flags.service'

/**
 * Lista FIR, giro 2: stati con tono (pillola), un solo bottone primario, nessun paginatore sotto
 * una pagina, e lo stato vuoto leggibile per intero anche a 390 px (bug 31: la tabella larga
 * 60 rem spingeva il messaggio centrato fuori dallo schermo).
 */
function fir(id: string, stato: FIRStato): FIR {
  return {
    id,
    numeroProgressivo: `FIR-2026-0000${id}`,
    stato,
    rifiuto: { cerCode: '150101', quantita: 100, unitaMisura: 'kg' },
    rentriSyncStatus: 'PENDING',
    createdAt: new Date('2026-11-05T10:00:00Z'),
  } as unknown as FIR
}

describe('FirListComponent: stile del giro 2', () => {
  let fixture: ComponentFixture<FirListComponent>
  let firService: jasmine.SpyObj<FirService>

  function monta(items: FIR[]): void {
    firService = jasmine.createSpyObj('FirService', ['getFIRList'])
    firService.getFIRList.and.returnValue(of({ items, total: items.length }) as never)
    const reg = jasmine.createSpyObj('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
    ])
    for (const m of ['getProduttori', 'getTrasportatori', 'getDestinatari'])
      reg[m].and.returnValue(of({ items: [], total: 0 }))
    TestBed.configureTestingModule({
      imports: [FirListComponent, NoopAnimationsModule, HttpClientTestingModule],
      providers: [
        { provide: FirService, useValue: firService },
        { provide: RegistryService, useValue: reg },
        {
          provide: AuthService,
          useValue: { currentUser: () => ({ id: 'u1', email: 'u@test.invalid', role: 'ADMIN' }) },
        },
        {
          provide: RENTRISyncService,
          useValue: jasmine.createSpyObj('RENTRISyncService', ['syncFIR', 'confermaLegame']),
        },
        provideRouter([]),
        MessageService,
        ConfirmationService,
        ExportService,
      ],
    })
    fixture = TestBed.createComponent(FirListComponent)
    fixture.detectChanges()
  }

  afterEach(() => fixture?.destroy())

  it('lo stato e una pillola col suo tono: Bozza e Annullato neutri, Emesso contorno, In transito giallo, Consegnato verde', () => {
    monta([
      fir('1', FIRStato.BOZZA),
      fir('2', FIRStato.EMESSO),
      fir('3', FIRStato.IN_TRANSITO),
      fir('4', FIRStato.CONSEGNATO),
      fir('5', FIRStato.ANNULLATO),
    ])
    const tono = (id: string): string =>
      fixture.nativeElement.querySelector(`[data-testid="fir-stato-${id}"] .pillola`).className
    expect(tono('1')).toContain('tono-none')
    expect(tono('2')).toContain('tono-todo')
    expect(tono('3')).toContain('tono-warn')
    expect(tono('4')).toContain('tono-ok')
    expect(tono('5')).toContain('tono-none')
    expect(tono('5')).toContain('pillola--barrata')
    expect(
      fixture.nativeElement.querySelector('[data-testid="fir-stato-3"]').textContent.trim()
    ).toBe('In transito')
    expect(fixture.nativeElement.querySelector('[data-testid^="fir-stato-"] .p-tag')).toBeNull()
  })

  it('«Nuovo FIR» e l unico bottone primario', () => {
    monta([fir('1', FIRStato.BOZZA)])
    const primari = fixture.nativeElement.querySelectorAll('.wf-primario')
    expect(primari.length).toBe(1)
    expect(primari[0].textContent).toContain('Nuovo FIR')
  })

  it('con le righe in una sola pagina non c e paginatore', () => {
    monta([fir('1', FIRStato.BOZZA), fir('2', FIRStato.EMESSO)])
    expect(fixture.nativeElement.querySelector('.p-paginator')).toBeNull()
  })

  it('lista vuota a 390 px: il testo dello stato vuoto si legge per intero, senza scorrere di lato', () => {
    monta([])
    const radice = fixture.nativeElement as HTMLElement
    radice.style.display = 'block'
    radice.style.width = '390px'
    document.body.appendChild(radice)
    fixture.detectChanges()
    expect(radice.querySelector('.p-paginator')).toBeNull()
    const vuoto = radice.querySelector<HTMLElement>('.empty-state')!
    expect(vuoto.textContent).toContain('Nessun FIR trovato')
    const testo = vuoto.querySelector<HTMLElement>('p:not(.empty-state__title)')!
    expect(testo.scrollWidth).toBeLessThanOrEqual(testo.clientWidth)
    expect(getComputedStyle(testo).textOverflow).not.toBe('ellipsis')
    const scorrevole = radice.querySelector<HTMLElement>('.table-responsive')!
    expect(scorrevole.scrollWidth).toBeLessThanOrEqual(scorrevole.clientWidth)
    const dentro = vuoto.getBoundingClientRect()
    expect(dentro.left).toBeGreaterThanOrEqual(radice.getBoundingClientRect().left)
    expect(dentro.right).toBeLessThanOrEqual(radice.getBoundingClientRect().right + 1)
  })
})
