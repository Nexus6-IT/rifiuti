import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { DatePipe } from '@angular/common'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
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
import { LegamiService } from '../legami/legami.service'
import { ClientiService } from '../clienti/clienti.service'
import { ATTESA_PROPOSTA_MS } from '../legami/blocco-fatturazione.component'
import { proposta } from '../legami/blocco-fatturazione.test-util'
import { PropostaLegame } from '../legami/legami.model'

const registro: RegistroVista = {
  id: 'r1',
  unitaLocaleId: 'u1',
  numIscrSito: null,
  denominazione: 'Sede',
  codice: 'CARICO_SCARICO',
  attivo: true,
  principale: true,
}

const q = (testid: string): HTMLElement | null =>
  document.body.querySelector(`[data-testid="${testid}"]`)

/**
 * Il blocco «Fatturazione» dentro il dialog reale di registrazione: i bug di stato fra form e
 * blocco (errore rimasto indietro, conferma di un altro cliente) si vedono solo qui.
 */
describe('Registro - blocco Fatturazione nel dialog reale', () => {
  let servizio: jasmine.SpyObj<RegistroService>
  let fixture: ComponentFixture<RegistroComponent>
  let risposta: PropostaLegame

  function apri(): RegistroComponent {
    fixture = TestBed.createComponent(RegistroComponent)
    fixture.detectChanges()
    const c = fixture.componentInstance
    c.apriForm()
    c.form.patchValue({
      causale: 'SCARICO_A_TERZI',
      cerCode: '17 04 05',
      quantity: 10,
      movementDate: new Date(2026, 9, 20),
    })
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    tick()
    fixture.detectChanges()
    return c
  }

  /** Cambia un campo del form e lascia passare debounce e risposta. */
  function cambia(c: RegistroComponent, valori: Record<string, unknown>): void {
    c.form.patchValue(valori)
    fixture.detectChanges()
    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    tick()
    fixture.detectChanges()
  }

  beforeEach(() => {
    risposta = proposta()
    servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'lista',
      'listRegistri',
      'assicuraRegistri',
      'getProgressivoIniziale',
      'registra',
    ])
    servizio.lista.and.returnValue(of({ items: [], total: 0, page: 1, limit: 20, totalPages: 1 }))
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
    servizio.registra.and.returnValue(
      of({ progressiveNumber: 1, progressiveYear: 2026 } as unknown as Movimento)
    )
    TestBed.configureTestingModule({
      imports: [RegistroComponent, HttpClientTestingModule],
      providers: [
        provideNoopAnimations(),
        DatePipe,
        { provide: RegistroService, useValue: servizio },
        {
          provide: LegamiService,
          useValue: {
            proposta: () => of(risposta),
          },
        },
        {
          provide: ClientiService,
          useValue: { clienti: { list: () => of({ elementi: [], totale: 0 }) } },
        },
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
  })

  afterEach(() => fixture?.destroy())

  it('causale fatturabile: il blocco compare nel dialog e la registrazione porta il legame', fakeAsync(() => {
    const c = apri()
    expect(q('blocco-fatturazione')).not.toBeNull()
    c.salva()
    const corpo = servizio.registra.calls.mostRecent().args[0]
    expect(corpo.legame?.azione).toBe('PROPOSTA')
    expect(corpo.legame?.righe?.length).toBe(2)
  }))

  it('C1: campo in errore, poi causale non fatturabile: la registrazione parte senza legame', fakeAsync(() => {
    const c = apri()
    const qta = document.body.querySelector<HTMLInputElement>('#qta-ra-1')!
    qta.focus()
    const dt = new DataTransfer()
    dt.setData('text', '0')
    qta.value = ''
    qta.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    )
    qta.dispatchEvent(new Event('blur'))
    fixture.detectChanges()
    expect(c.bloccoFatturazioneValido).toBeFalse()

    risposta = proposta({ fatturabile: false })
    cambia(c, { causale: 'ALTRA' })
    expect(q('blocco-fatturazione')).toBeNull()
    expect(c.bloccoFatturazioneValido).toBeTrue()

    c.salva()
    expect(servizio.registra).toHaveBeenCalledTimes(1)
    expect(Object.keys(servizio.registra.calls.mostRecent().args[0])).not.toContain('legame')
  }))

  it('I1: conferma attiva, poi un altro FIR: mentre aggiorna non registra, poi l’azione è PROPOSTA', fakeAsync(() => {
    const c = apri()
    ;(q('fatt-conferma') as HTMLButtonElement).click()
    fixture.detectChanges()
    expect(c.legame?.azione).toBe('CONFERMA')

    risposta = proposta({ cliente: { id: 'cl-2', etichetta: 'Verdi Spa', fonte: 'FIR' } })
    c.form.patchValue({ firId: 'fir-2' })
    fixture.detectChanges()
    tick(50)
    // proposta in volo: nessun legame vecchio e Registra aspetta
    expect(c.legame).toBeNull()
    c.salva()
    expect(servizio.registra).not.toHaveBeenCalled()

    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    tick()
    expect(c.legame?.azione).toBe('PROPOSTA')
    c.salva()
    expect(servizio.registra.calls.mostRecent().args[0].legame?.azione).toBe('PROPOSTA')
  }))
})
