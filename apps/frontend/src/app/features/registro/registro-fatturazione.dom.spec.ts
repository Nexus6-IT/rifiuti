import { FeatureFlagsService } from '../../core/services/feature-flags.service'
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
  let contratti = true

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
    contratti = true
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
        {
          provide: FeatureFlagsService,
          useValue: { has: (k: string) => k !== 'contratti' || contratti },
        },
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

  const pulsante = (testid: string): HTMLButtonElement | null =>
    document.body.querySelector<HTMLButtonElement>(`[data-testid="${testid}"] button`)

  it('I1: azienda senza il modulo contratti: nessuna proposta, nessun blocco, solo «Registra»', fakeAsync(() => {
    contratti = false
    const proposta$ = spyOn(TestBed.inject(LegamiService), 'proposta').and.callThrough()
    apri()
    expect(proposta$).not.toHaveBeenCalled()
    expect(q('blocco-fatturazione')).toBeNull()
    expect(pulsante('registra')).not.toBeNull()
    expect(pulsante('registra-senza-collegare')).toBeNull()
    expect(pulsante('registra-e-conferma')).toBeNull()
  }))

  it('blocco visibile: il footer ha le due azioni e niente «Registra» singolo', fakeAsync(() => {
    apri()
    expect(q('blocco-fatturazione')).not.toBeNull()
    expect(pulsante('registra-senza-collegare')).not.toBeNull()
    expect(pulsante('registra-e-conferma')).not.toBeNull()
    expect(pulsante('registra')).toBeNull()
  }))

  it('«Registra senza collegare»: parte subito con legame PROPOSTA e tutte le righe', fakeAsync(() => {
    apri()
    pulsante('registra-senza-collegare')!.click()
    tick(100)
    const corpo = servizio.registra.calls.mostRecent().args[0]
    expect(corpo.legame?.azione).toBe('PROPOSTA')
    expect(corpo.legame?.righe?.length).toBe(2)
  }))

  it('«Registra e conferma legame»: parte subito con legame CONFERMA', fakeAsync(() => {
    apri()
    expect(pulsante('registra-e-conferma')!.disabled).toBeFalse()
    pulsante('registra-e-conferma')!.click()
    tick(100)
    expect(servizio.registra.calls.mostRecent().args[0].legame?.azione).toBe('CONFERMA')
  }))

  it('proposta incompleta: «conferma» disabilitato, «senza collegare» no', fakeAsync(() => {
    risposta = proposta({ cliente: null, righe: [], motivi: ['SENZA_CLIENTE'] })
    apri()
    expect(pulsante('registra-e-conferma')!.disabled).toBeTrue()
    expect(pulsante('registra-senza-collegare')!.disabled).toBeFalse()
  }))

  it('m6: campo in errore, «Registra senza collegare» disattivato col motivo collegato', fakeAsync(() => {
    apri()
    expect(pulsante('registra-senza-collegare')!.disabled).toBeFalse()
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
    fixture.detectChanges()
    const bottone = pulsante('registra-senza-collegare')!
    expect(bottone.disabled).toBeTrue()
    const motivo = document.body.querySelector('#registra-senza-collegare-motivo')
    expect(motivo?.textContent).toContain('correggi prima i campi in errore')
    expect(bottone.getAttribute('aria-describedby')).toBe('registra-senza-collegare-motivo')
    // m5: il campo in errore e' marcato e collegato al suo messaggio
    expect(qta.getAttribute('aria-invalid')).toBe('true')
    expect(qta.getAttribute('aria-describedby')).toBe('errore-quantita-ra-1')
    expect(document.body.querySelector('#errore-quantita-ra-1')).not.toBeNull()
  }))

  it('senza blocco (causale non fatturabile): un solo «Registra», senza legame', fakeAsync(() => {
    risposta = proposta({ fatturabile: false })
    apri()
    expect(q('blocco-fatturazione')).toBeNull()
    expect(pulsante('registra-senza-collegare')).toBeNull()
    expect(pulsante('registra-e-conferma')).toBeNull()
    pulsante('registra')!.click()
    tick(100)
    expect(Object.keys(servizio.registra.calls.mostRecent().args[0])).not.toContain('legame')
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
    tick(100)
    expect(servizio.registra).toHaveBeenCalledTimes(1)
    expect(Object.keys(servizio.registra.calls.mostRecent().args[0])).not.toContain('legame')
  }))

  it('I1: un altro FIR: mentre la proposta si aggiorna i pulsanti aspettano e il legame vecchio non parte', fakeAsync(() => {
    const c = apri()
    risposta = proposta({ cliente: { id: 'cl-2', etichetta: 'Verdi Spa', fonte: 'FIR' } })
    c.form.patchValue({ firId: 'fir-2' })
    fixture.detectChanges()
    tick(50)
    fixture.detectChanges()
    expect(c.legame).toBeNull()
    expect(pulsante('registra-senza-collegare')!.disabled).toBeTrue()
    expect(pulsante('registra-e-conferma')!.disabled).toBeTrue()
    c.salva('CONFERMA')
    expect(servizio.registra).not.toHaveBeenCalled()

    tick(ATTESA_PROPOSTA_MS)
    fixture.detectChanges()
    tick()
    fixture.detectChanges()
    expect(pulsante('registra-e-conferma')!.disabled).toBeFalse()
    pulsante('registra-e-conferma')!.click()
    tick(100)
    expect(servizio.registra.calls.mostRecent().args[0].legame?.azione).toBe('CONFERMA')
  }))
})
