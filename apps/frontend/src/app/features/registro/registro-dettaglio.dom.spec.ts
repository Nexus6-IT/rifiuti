import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { HttpErrorResponse } from '@angular/common/http'
import { DatePipe } from '@angular/common'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { Observable, of, throwError } from 'rxjs'
import { RegistroComponent } from './registro.component'
import { Movimento, RegistroService, RegistroVista } from './registro.service'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'
import { LegamiService } from '../legami/legami.service'
import { ClientiService } from '../clienti/clienti.service'
import { riga } from '../legami/blocco-fatturazione.test-util'
import { LegameVista } from '../legami/legami.model'

const registro: RegistroVista = {
  id: 'r1',
  unitaLocaleId: 'u1',
  numIscrSito: null,
  denominazione: 'Sede',
  codice: 'CARICO_SCARICO',
  attivo: true,
  principale: true,
}

const movimento = {
  id: 'm1',
  registroId: 'r1',
  progressiveNumber: 12,
  progressiveYear: 2026,
  type: 'SCARICO',
  movementDate: '2026-10-20T00:00:00.000Z',
  causale: 'SCARICO_A_TERZI',
  cerCode: '17 04 05',
  quantity: 120,
  unit: 'KG',
  stato: 'VIGENTE',
  tipoAnnotazione: 'ORDINARIA',
} as unknown as Movimento

const legame = (parziale: Partial<LegameVista> = {}): LegameVista => ({
  id: 'lg-1',
  movimentoOriginaleId: 'm1',
  movimentoVigenteId: 'm1',
  stato: 'FATTURATO',
  dataMovimento: '2026-10-20',
  cliente: { id: 'cl-1', etichetta: 'Rossi Srl', fonte: 'FIR' },
  dettaglioCliente: null,
  contratto: null,
  elenco: null,
  righe: [riga()],
  motivi: [],
  avvisi: [],
  motivoEsclusione: null,
  confermatoIl: null,
  fatturatoIl: '2026-11-10T00:00:00.000Z',
  riferimentoFattura: null,
  scostamentoDopoFattura: true,
  scostamentoIl: null,
  versione: 4,
  ...parziale,
})

const q = (testid: string): HTMLElement | null =>
  document.body.querySelector(`[data-testid="${testid}"]`)

/** Il riquadro «Fatturazione» dentro il dettaglio del movimento, nel registro reale. */
describe('Registro - dettaglio del movimento con il legame', () => {
  let fixture: ComponentFixture<RegistroComponent>
  let legami: jasmine.SpyObj<LegamiService>
  let ruolo: string

  function apri(risposta: Observable<LegameVista>): void {
    legami.perMovimento.and.returnValue(risposta)
    fixture = TestBed.createComponent(RegistroComponent)
    fixture.detectChanges()
    const occhio = q('registro-dettaglio-m1')!.querySelector('button') as HTMLButtonElement
    occhio.focus()
    occhio.click()
    fixture.detectChanges()
    tick()
    fixture.detectChanges()
  }

  beforeEach(() => {
    const servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'lista',
      'listRegistri',
      'assicuraRegistri',
      'getProgressivoIniziale',
    ])
    servizio.lista.and.returnValue(
      of({ items: [movimento], total: 1, page: 1, limit: 20, totalPages: 1 })
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
    legami = jasmine.createSpyObj<LegamiService>('LegamiService', [
      'perMovimento',
      'modifica',
      'conferma',
      'proposta',
    ])
    ruolo = 'OPERATOR'
    TestBed.configureTestingModule({
      imports: [RegistroComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        DatePipe,
        { provide: RegistroService, useValue: servizio },
        { provide: LegamiService, useValue: legami },
        {
          provide: ClientiService,
          useValue: { clienti: { list: () => of({ elementi: [], totale: 0 }) } },
        },
        {
          provide: ToastService,
          useValue: jasmine.createSpyObj('ToastService', ['error', 'success', 'info', 'warn']),
        },
        { provide: ExportService, useValue: {} },
        { provide: AuthService, useValue: { currentUser: () => ({ role: ruolo }) } },
        { provide: AdminTenantContextService, useValue: { selectedTenantName: () => 'Azienda' } },
        {
          provide: CompanyService,
          useValue: { loadActiveCompany: () => of(null), activeCompany: () => null },
        },
        { provide: FirService, useValue: { getFIRList: () => of({ items: [] }) } },
        { provide: RegistryService, useValue: { getProduttori: () => of({ items: [] }) } },
      ],
    })
  })

  afterEach(() => fixture?.destroy())

  it('«Dettaglio» apre il movimento col riquadro del legame (letto per id del movimento)', fakeAsync(() => {
    apri(of(legame()))
    expect(q('registro-dettaglio')?.textContent).toContain('17 04 05')
    expect(legami.perMovimento).toHaveBeenCalledOnceWith('m1')
    expect(q('riquadro-legame')).not.toBeNull()
    expect(q('riquadro-avviso-AVVISO_SCOSTAMENTO')).not.toBeNull()
    expect(q('registro-dettaglio-senza-legame')).toBeNull()
  }))

  it('movimento senza legame (404): niente riquadro, il dettaglio lo dice', fakeAsync(() => {
    apri(throwError(() => new HttpErrorResponse({ status: 404 })))
    expect(q('riquadro-legame')).toBeNull()
    expect(q('registro-dettaglio-senza-legame')?.textContent).toContain('non è collegato')
  }))

  it('VIEWER: vede il riquadro in sola lettura, nessuna rotta di scrittura', fakeAsync(() => {
    ruolo = 'VIEWER'
    apri(of(legame({ stato: 'PROPOSTO', scostamentoDopoFattura: false })))
    expect(q('riquadro-legame')).not.toBeNull()
    expect(q('riquadro-azioni')).toBeNull()
    expect(document.body.querySelector('#prezzo-ra-1')).toBeNull()
    expect(legami.modifica).not.toHaveBeenCalled()
    expect(legami.conferma).not.toHaveBeenCalled()
  }))

  it('all’apertura il focus entra nella finestra del dettaglio', fakeAsync(() => {
    apri(of(legame()))
    flush()
    fixture.detectChanges()
    const dialog = q('registro-dettaglio')?.closest('.p-dialog')
    expect(dialog).not.toBeNull()
    expect(dialog!.contains(document.activeElement)).toBeTrue()
  }))

  it('alla chiusura il focus torna al pulsante «Dettaglio»', fakeAsync(() => {
    apri(of(legame()))
    fixture.componentInstance.chiudiDettaglio()
    fixture.detectChanges()
    tick(100)
    expect(document.activeElement).toBe(
      q('registro-dettaglio-m1')!.querySelector('button') as HTMLButtonElement
    )
  }))
})
