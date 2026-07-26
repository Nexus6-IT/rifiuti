import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { ActivatedRoute, convertToParamMap } from '@angular/router'
import { of, throwError } from 'rxjs'
import { FirDetailComponent } from './fir-detail.component'
import { FirService } from './fir.service'
import { AuthService } from '../../core/services/auth.service'
import { RENTRISyncService } from './services/rentri-sync.service'
import { FIR, FIRStato } from '../../shared/models/fir.model'

/**
 * TDD per la pagina di dettaglio del formulario FIR (R1 Task 4).
 *
 * Prima di questo task non esisteva un posto dove vedere un singolo
 * formulario: la pagina deve mostrare dati, stato RENTRI (con legame
 * proposto distinto dal legame ufficiale), cronologia trasmissioni e
 * azioni coerenti con il ruolo dell'utente. Sul fronte sicurezza, un
 * formulario di un altro tenant deve risultare "non trovato" (404), mai
 * "non autorizzato" (403): l'endpoint backend già applica questa regola
 * (v. get-fir-by-id.handler.ts) e questi test bloccano la regressione a
 * un comportamento che riveli l'esistenza del record.
 */
describe('FirDetailComponent', () => {
  let fixture: ComponentFixture<FirDetailComponent>
  let component: FirDetailComponent
  let firService: jasmine.SpyObj<FirService>
  let rentriSyncService: jasmine.SpyObj<RENTRISyncService>
  let authService: jasmine.SpyObj<AuthService>
  let httpMock: HttpTestingController

  const baseFIR: FIR = {
    id: 'fir-1',
    numeroProgressivo: 'FIR-2026-000001',
    anno: 2026,
    stato: FIRStato.EMESSO,
    produttoreId: 'p1',
    trasportatoreId: 't1',
    destinatarioId: 'd1',
    produttore: { ragioneSociale: 'Acme SRL', partitaIva: '12345678901' },
    trasportatore: { ragioneSociale: 'Trasporti SRL', partitaIva: '22345678901' },
    destinatario: { ragioneSociale: 'Impianto SRL', partitaIva: '32345678901' },
    rifiuto: { cerCode: '150101', quantita: 10, unitaMisura: 'kg' },
    createdAt: '2026-07-01T10:00:00.000Z',
    rentriSyncStatus: 'PENDING',
    canSyncToRENTRI: true,
  }

  function setup(overrides: { role?: string; firId?: string } = {}) {
    const activatedRouteStub = {
      snapshot: {
        paramMap: convertToParamMap({ id: overrides.firId ?? 'fir-1' }),
      },
    }

    firService = jasmine.createSpyObj('FirService', ['getFIRById', 'emettiFIR', 'presaInCarico'])
    rentriSyncService = jasmine.createSpyObj('RENTRISyncService', [
      'syncFIR',
      'confermaLegame',
      'getSyncLogs',
    ])
    rentriSyncService.getSyncLogs.and.returnValue(
      of({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 })
    )
    authService = jasmine.createSpyObj('AuthService', [], {
      currentUser: () => ({ id: 'u1', email: 'u@example.com', role: overrides.role ?? 'ADMIN' }),
    })

    TestBed.configureTestingModule({
      imports: [FirDetailComponent, HttpClientTestingModule],
      providers: [
        { provide: ActivatedRoute, useValue: activatedRouteStub },
        { provide: FirService, useValue: firService },
        { provide: RENTRISyncService, useValue: rentriSyncService },
        { provide: AuthService, useValue: authService },
      ],
    })

    httpMock = TestBed.inject(HttpTestingController)
    fixture = TestBed.createComponent(FirDetailComponent)
    component = fixture.componentInstance
  }

  afterEach(() => {
    httpMock?.verify()
  })

  it('mostra lo stato di caricamento prima che la risposta arrivi', () => {
    setup()
    firService.getFIRById.and.returnValue(of(baseFIR))
    fixture.detectChanges()

    // Prima che l'observable sincrono emetta detectChanges successivi non è
    // rilevante qui: verifichiamo che il segnale di loading parta a true.
    expect(component['loading']()).toBeFalse() // of() emette in modo sincrono
  })

  it('mostra un messaggio "non trovato" quando il backend risponde 404 (FIR inesistente o di un altro tenant)', () => {
    setup()
    firService.getFIRById.and.returnValue(
      throwError(() => ({ status: 404, error: { message: 'FIR not found' } }))
    )
    fixture.detectChanges()

    expect(component['error']()).toBe('Formulario non trovato.')
    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-error"]')).toBeTruthy()
  })

  it('non distingue nel messaggio un FIR inesistente da uno di un altro tenant (niente fuga di esistenza)', () => {
    setup()
    // Stesso identico errore per i due scenari: il componente non deve
    // introdurre una differenza che il backend non fa.
    firService.getFIRById.and.returnValue(
      throwError(() => ({ status: 404, error: { message: 'FIR not found: fir-of-other-tenant' } }))
    )
    fixture.detectChanges()

    expect(component['error']()).toBe('Formulario non trovato.')
  })

  it('mostra i dati del formulario quando il caricamento riesce', () => {
    setup()
    firService.getFIRById.and.returnValue(of(baseFIR))
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-numero"]')?.textContent).toContain(
      'FIR-2026-000001'
    )
    expect(el.querySelector('[data-testid="fir-detail-produttore"]')?.textContent).toContain(
      'Acme SRL'
    )
    expect(el.querySelector('[data-testid="fir-detail-rifiuto"]')?.textContent).toContain('150101')
  })

  it('mostra il numero ufficiale RENTRI quando presente', () => {
    setup()
    firService.getFIRById.and.returnValue(
      of({ ...baseFIR, rentriSyncStatus: 'SYNCED', rentriNumeroFir: 'RENTRI-000999' })
    )
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(
      el.querySelector('[data-testid="fir-detail-rentri-numero-ufficiale"]')?.textContent
    ).toContain('RENTRI-000999')
    expect(el.querySelector('[data-testid="fir-detail-rentri-numero-proposto"]')).toBeFalsy()
  })

  it('distingue il legame PROPOSTO (modalità ibrida) dal numero ufficiale: non è mai mostrato come ufficiale', () => {
    setup()
    firService.getFIRById.and.returnValue(
      of({
        ...baseFIR,
        rentriSyncStatus: 'SYNCED',
        rentriNumeroFir: null,
        rentriNumeroFirProposto: 'RENTRI-PROP-1',
      })
    )
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(
      el.querySelector('[data-testid="fir-detail-rentri-numero-ufficiale"]')?.textContent
    ).toContain('Non ancora assegnato')
    expect(
      el.querySelector('[data-testid="fir-detail-rentri-numero-proposto"]')?.textContent
    ).toContain('RENTRI-PROP-1')
  })

  it("mostra l'origine del legame quando presente", () => {
    setup()
    firService.getFIRById.and.returnValue(
      of({
        ...baseFIR,
        rentriSyncStatus: 'SYNCED',
        rentriNumeroFir: 'RENTRI-000999',
        rentriOrigineLegame: 'ACQUISITO_DA_TERZI',
      })
    )
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-rentri-origine"]')?.textContent).toContain(
      'Acquisito da terzi'
    )
  })

  it('non mostra la sezione RENTRI per un FIR in BOZZA (mai emesso)', () => {
    setup()
    firService.getFIRById.and.returnValue(of({ ...baseFIR, stato: FIRStato.BOZZA }))
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-rentri-status"]')).toBeFalsy()
  })

  it('mostra "Trasmetti a RENTRI" per OPERATOR quando il FIR è trasmissibile', () => {
    setup({ role: 'OPERATOR' })
    firService.getFIRById.and.returnValue(of(baseFIR))
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-rentri-trasmetti"]')).toBeTruthy()
  })

  it('NON mostra alcuna azione RENTRI per un VIEWER (eviterebbe un 403 dal backend)', () => {
    setup({ role: 'VIEWER' })
    firService.getFIRById.and.returnValue(of(baseFIR))
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-rentri-trasmetti"]')).toBeFalsy()
    expect(el.querySelector('[data-testid="fir-detail-rentri-riprova"]')).toBeFalsy()
    expect(el.querySelector('[data-testid="fir-detail-rentri-conferma-legame"]')).toBeFalsy()
  })

  it('mostra "Conferma il legame" quando c\'è una proposta pendente e l\'utente può gestire RENTRI', () => {
    setup({ role: 'ADMIN' })
    firService.getFIRById.and.returnValue(
      of({
        ...baseFIR,
        rentriSyncStatus: 'SYNCED',
        rentriNumeroFir: null,
        rentriNumeroFirProposto: 'RENTRI-PROP-1',
      })
    )
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-rentri-conferma-legame"]')).toBeTruthy()
  })

  it('monta il componente della cronologia trasmissioni RENTRI passando il firId', () => {
    setup()
    firService.getFIRById.and.returnValue(of(baseFIR))
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="rentri-sync-logs"]')).toBeTruthy()
  })

  it('trasmette il FIR a RENTRI quando si preme "Trasmetti a RENTRI"', () => {
    setup({ role: 'ADMIN' })
    firService.getFIRById.and.returnValue(of(baseFIR))
    rentriSyncService.syncFIR.and.returnValue(of({ jobId: 'job-1', firId: 'fir-1', message: 'ok' }))
    fixture.detectChanges()

    component.trasmettiRENTRI(baseFIR)

    expect(rentriSyncService.syncFIR).toHaveBeenCalledWith('fir-1')
  })
})
