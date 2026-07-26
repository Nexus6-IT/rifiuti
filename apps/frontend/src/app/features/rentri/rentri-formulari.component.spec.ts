import { ComponentFixture, TestBed } from '@angular/core/testing'
import { RouterTestingModule } from '@angular/router/testing'
import { signal } from '@angular/core'
import { of, throwError } from 'rxjs'
import { RentriFormulariComponent } from './rentri-formulari.component'
import { RentriFormulariService, FormularioTrovato } from './rentri-formulari.service'
import { FirService } from '../fir/fir.service'
import { AuthService } from '../../core/services/auth.service'
import { ToastService } from '../../core/services/toast.service'
import { FIR, FIRStato } from '../../shared/models/fir.model'

function formulario(overrides: Partial<FormularioTrovato> = {}): FormularioTrovato {
  return {
    numeroFir: 'TVXYZ1234AB',
    identificativoSoggetto: 'RSSMRA80A01H501U',
    codiceEer: '150101',
    descrizioneRifiuto: 'Imballaggi in carta e cartone',
    stato: 'EMESSO',
    visibilitaGiaAcquisita: false,
    giaAgganciatoLocalmente: false,
    ...overrides,
  }
}

function firLocale(overrides: Partial<FIR> = {}): FIR {
  return {
    id: 'fir-1',
    numeroProgressivo: 'FIR-2026-000001',
    anno: 2026,
    stato: FIRStato.BOZZA,
    produttoreId: 'p1',
    trasportatoreId: 't1',
    destinatarioId: 'd1',
    produttore: { ragioneSociale: 'Acme SRL', partitaIva: '12345678901' },
    rifiuto: { cerCode: '150101', quantita: 10, unitaMisura: 'kg' },
    createdAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  }
}

/**
 * TDD per la pagina di ricerca/aggancio dei formulari RENTRI (R2 Task 8).
 *
 * Il criterio di valore non negoziabile: la ricerca vive qui (area RENTRI,
 * l'unica cosa che non appartiene a un singolo formulario), ma l'esito
 * dell'aggancio atterra dove l'utente già lavora (lista/dettaglio FIR) — qui
 * verifichiamo solo il comportamento di QUESTA pagina: chi può cercare, cosa
 * succede quando un formulario è già nel gestionale, e che il selettore del
 * ramo "collega a un FIR esistente" offra SOLO i FIR ancora liberi.
 */
describe('RentriFormulariComponent', () => {
  let fixture: ComponentFixture<RentriFormulariComponent>
  let component: RentriFormulariComponent
  let service: jasmine.SpyObj<RentriFormulariService>
  let firService: jasmine.SpyObj<FirService>
  let toast: jasmine.SpyObj<ToastService>
  let authStub: { currentUser: ReturnType<typeof signal> }

  function setup(role: string | undefined): void {
    authStub = { currentUser: signal(role ? { id: 'u1', email: 'u@test.com', role } : null) }
    service = jasmine.createSpyObj<RentriFormulariService>('RentriFormulariService', [
      'cerca',
      'aggancia',
      'rilasciaLegame',
    ])
    firService = jasmine.createSpyObj<FirService>('FirService', ['getFIRList'])
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error'])

    TestBed.configureTestingModule({
      imports: [RentriFormulariComponent, RouterTestingModule],
      providers: [
        { provide: RentriFormulariService, useValue: service },
        { provide: FirService, useValue: firService },
        { provide: AuthService, useValue: authStub },
        { provide: ToastService, useValue: toast },
      ],
    })

    fixture = TestBed.createComponent(RentriFormulariComponent)
    component = fixture.componentInstance
  }

  it('mostra il gate "accesso riservato" per un VIEWER, senza cercare', () => {
    setup('VIEWER')
    fixture.detectChanges()

    expect(component.isAutorizzato()).toBeFalse()
    expect(service.cerca).not.toHaveBeenCalled()
    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="rentri-formulari-non-autorizzato"]')).toBeTruthy()
  })

  it('cerca automaticamente per un OPERATOR e mostra i risultati', () => {
    setup('OPERATOR')
    service.cerca.and.returnValue(
      of({
        risultati: [formulario()],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 1 },
      })
    )

    fixture.detectChanges()

    expect(service.cerca).toHaveBeenCalled()
    expect(component.risultati()).toEqual([formulario()])
    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="rentri-formulari-row-TVXYZ1234AB"]')).toBeTruthy()
  })

  it('mostra "Già nel gestionale" e disabilita il pulsante per un formulario già agganciato', () => {
    setup('ADMIN')
    service.cerca.and.returnValue(
      of({
        risultati: [formulario({ giaAgganciatoLocalmente: true, firIdLocale: 'fir-9' })],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 1 },
      })
    )
    fixture.detectChanges()

    expect(component.statoRigaLabel(formulario({ giaAgganciatoLocalmente: true }))).toBe(
      'Già nel gestionale'
    )
    const el: HTMLElement = fixture.nativeElement
    // `data-testid` è sull'host `<p-button>`: il vero <button> nativo
    // disabilitato è annidato dentro il suo template.
    const hostButton = el.querySelector('[data-testid="rentri-formulari-aggancia-TVXYZ1234AB"]')
    const nativeButton = hostButton?.querySelector('button') as HTMLButtonElement
    expect(nativeButton.disabled).toBeTrue()
  })

  it('mostra un errore leggibile quando la ricerca fallisce', () => {
    setup('ADMIN')
    service.cerca.and.returnValue(
      throwError(() => ({ error: { message: 'Configura prima la tua unità locale RENTRI' } }))
    )
    fixture.detectChanges()

    expect(component.errore()).toBe('Configura prima la tua unità locale RENTRI')
  })

  it('apre il dialog di aggancio senza alcuna modalità pre-selezionata (mai un default silenzioso)', () => {
    setup('ADMIN')
    service.cerca.and.returnValue(
      of({
        risultati: [formulario()],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 1 },
      })
    )
    fixture.detectChanges()

    component.apriDialogAggancio(formulario())

    expect(component.dialogVisibile()).toBeTrue()
    expect(component.modalitaScelta).toBeNull()
    expect(component.puoConfermareAggancio()).toBeFalse()
  })

  it('agganciando come NUOVO chiama il servizio con modalita=NUOVO', () => {
    setup('ADMIN')
    service.cerca.and.returnValue(
      of({
        risultati: [formulario()],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 1 },
      })
    )
    fixture.detectChanges()
    service.aggancia.and.returnValue(of({ firId: 'fir-nuovo', numeroFir: 'TVXYZ1234AB' }))

    component.apriDialogAggancio(formulario())
    component.modalitaScelta = 'NUOVO'
    expect(component.puoConfermareAggancio()).toBeTrue()

    component.confermaAggancio()

    expect(service.aggancia).toHaveBeenCalledWith(
      'TVXYZ1234AB',
      { modalita: 'NUOVO' },
      { visibilitaGiaAcquisita: false }
    )
    expect(toast.success).toHaveBeenCalled()
  })

  it('il selettore "collega a un formulario esistente" offre SOLO i FIR ancora liberi (senza rentriNumeroFir)', () => {
    setup('ADMIN')
    service.cerca.and.returnValue(
      of({
        risultati: [formulario()],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 1 },
      })
    )
    fixture.detectChanges()

    firService.getFIRList.and.returnValue(
      of({
        items: [
          firLocale({ id: 'fir-libero', rentriNumeroFir: null }),
          firLocale({ id: 'fir-legato', rentriNumeroFir: 'RENTRI-GIA-LEGATO' }),
        ],
        total: 2,
        page: 1,
        limit: 200,
        totalPages: 1,
      })
    )

    component.apriDialogAggancio(formulario())
    component.modalitaScelta = 'ESISTENTE'
    component.onModalitaEsistenteScelta()

    expect(component.firLiberi().map(f => f.id)).toEqual(['fir-libero'])
    expect(component.firLiberi().map(f => f.id)).not.toContain('fir-legato')
  })

  it('non permette la conferma in modalità ESISTENTE finché non è scelto un FIR locale', () => {
    setup('ADMIN')
    service.cerca.and.returnValue(
      of({
        risultati: [formulario()],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 1 },
      })
    )
    fixture.detectChanges()
    firService.getFIRList.and.returnValue(
      of({ items: [firLocale({ id: 'fir-libero' })], total: 1, page: 1, limit: 200, totalPages: 1 })
    )

    component.apriDialogAggancio(formulario())
    component.modalitaScelta = 'ESISTENTE'
    component.onModalitaEsistenteScelta()

    expect(component.puoConfermareAggancio()).toBeFalse()

    component.firLocaleSelezionato = 'fir-libero'
    expect(component.puoConfermareAggancio()).toBeTrue()
  })

  it('agganciando come ESISTENTE chiama il servizio con modalita=ESISTENTE e il firId scelto', () => {
    setup('ADMIN')
    service.cerca.and.returnValue(
      of({
        risultati: [formulario()],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 1 },
      })
    )
    fixture.detectChanges()
    firService.getFIRList.and.returnValue(
      of({ items: [firLocale({ id: 'fir-libero' })], total: 1, page: 1, limit: 200, totalPages: 1 })
    )
    service.aggancia.and.returnValue(of({ firId: 'fir-libero', numeroFir: 'TVXYZ1234AB' }))

    component.apriDialogAggancio(formulario())
    component.modalitaScelta = 'ESISTENTE'
    component.onModalitaEsistenteScelta()
    component.firLocaleSelezionato = 'fir-libero'

    component.confermaAggancio()

    expect(service.aggancia).toHaveBeenCalledWith(
      'TVXYZ1234AB',
      { modalita: 'ESISTENTE', firId: 'fir-libero' },
      { visibilitaGiaAcquisita: false }
    )
  })

  it("mostra un errore leggibile se l'aggancio fallisce (es. 409 già agganciato altrove)", () => {
    setup('ADMIN')
    service.cerca.and.returnValue(
      of({
        risultati: [formulario()],
        paging: { page: 1, pageSize: 100, pageCount: 1, totalRecordCount: 1 },
      })
    )
    fixture.detectChanges()
    service.aggancia.and.returnValue(
      throwError(() => ({
        error: { message: 'Questo formulario è già collegato a un altro FIR nel gestionale' },
      }))
    )

    component.apriDialogAggancio(formulario())
    component.modalitaScelta = 'NUOVO'
    component.confermaAggancio()

    expect(toast.error).toHaveBeenCalledWith(
      'Questo formulario è già collegato a un altro FIR nel gestionale'
    )
  })
})
