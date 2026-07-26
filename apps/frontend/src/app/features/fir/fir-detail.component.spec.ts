import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
import { ActivatedRoute, convertToParamMap } from '@angular/router'
import { of, throwError } from 'rxjs'
import { FirDetailComponent } from './fir-detail.component'
import { FirService } from './fir.service'
import { AuthService } from '../../core/services/auth.service'
import { RENTRISyncService } from './services/rentri-sync.service'
import { RentriFormulariService } from '../rentri/rentri-formulari.service'
import { FIR, FIRStato } from '../../shared/models/fir.model'
import { ConfirmationService } from 'primeng/api'

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
  let rentriFormulariService: jasmine.SpyObj<RentriFormulariService>
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

  function setup(overrides: { role?: string; firId?: string; autoConfirm?: boolean } = {}) {
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
    rentriFormulariService = jasmine.createSpyObj('RentriFormulariService', [
      'cerca',
      'aggancia',
      'rilasciaLegame',
    ])
    authService = jasmine.createSpyObj('AuthService', [], {
      currentUser: () => ({ id: 'u1', email: 'u@example.com', role: overrides.role ?? 'ADMIN' }),
    })

    const providers: unknown[] = [
      { provide: ActivatedRoute, useValue: activatedRouteStub },
      { provide: FirService, useValue: firService },
      { provide: RENTRISyncService, useValue: rentriSyncService },
      { provide: RentriFormulariService, useValue: rentriFormulariService },
      { provide: AuthService, useValue: authService },
    ]

    TestBed.configureTestingModule({
      imports: [FirDetailComponent, HttpClientTestingModule],
      providers,
    })

    httpMock = TestBed.inject(HttpTestingController)
    fixture = TestBed.createComponent(FirDetailComponent)
    component = fixture.componentInstance

    // FirDetailComponent dichiara ConfirmationService fra i provider a
    // livello di componente (scope proprio, condiviso col vero `<p-confirmDialog>`
    // del template): sostituire il provider non basta, il ConfirmDialog di
    // PrimeNG ha già bisogno del vero servizio (si abbona al suo
    // `requireConfirmation$`). Per verificare l'esito di un'azione confermata
    // (es. rilascio legame RENTRI) senza simulare il click reale nel dialog,
    // recuperiamo l'istanza VERA dall'injector del componente e le mettiamo
    // uno spy che invoca subito `accept()`.
    if (overrides.autoConfirm) {
      const realConfirmationService = fixture.debugElement.injector.get(ConfirmationService)
      spyOn(realConfirmationService, 'confirm').and.callFake((opts: { accept?: () => void }) => {
        opts.accept?.()
        return realConfirmationService
      })
    }
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
    firService.getFIRById.and.returnValue(
      of({ ...baseFIR, rentriNumeroFir: 'RENTRI-1', rentriOrigineLegame: 'ACQUISITO_DA_TERZI' })
    )
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-rentri-trasmetti"]')).toBeFalsy()
    expect(el.querySelector('[data-testid="fir-detail-rentri-riprova"]')).toBeFalsy()
    expect(el.querySelector('[data-testid="fir-detail-rentri-conferma-legame"]')).toBeFalsy()
    expect(el.querySelector('[data-testid="fir-detail-rentri-rilascia-legame"]')).toBeFalsy()
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

  /**
   * R1 Task 5: il pulsante «Riprova» deve comparire SOLO quando ritentare ha
   * senso. Prima di questo cambiamento compariva per qualunque FIR FAILED,
   * anche dopo un 403 o un 429/423 — dove ritentare non cambia nulla o
   * peggiora la situazione (l'ente ha già sospeso/bandito il chiamante).
   */
  it('NON mostra "Riprova" dopo un 403 (certificato non valido): mostra invece "Vai al certificato"', () => {
    setup({ role: 'ADMIN' })
    firService.getFIRById.and.returnValue(
      of({
        ...baseFIR,
        rentriSyncStatus: 'FAILED',
        rentriAzioneErrore: 'VEDI_CERTIFICATO',
        rentriMessaggioErrore:
          'Il certificato della tua azienda non è valido per questa operazione: verifica il certificato nella pagina dedicata. Ritentare non risolve il problema.',
      })
    )
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-rentri-riprova"]')).toBeFalsy()
    expect(el.querySelector('[data-testid="fir-detail-rentri-vedi-certificato"]')).toBeTruthy()
    expect(el.textContent).toContain('certificato')
  })

  it('NON mostra "Riprova" dopo un 429/423 (RENTRI ha sospeso le richieste)', () => {
    setup({ role: 'ADMIN' })
    firService.getFIRById.and.returnValue(
      of({
        ...baseFIR,
        rentriSyncStatus: 'FAILED',
        rentriAzioneErrore: 'NESSUNA',
        rentriMessaggioErrore:
          'RENTRI ha temporaneamente sospeso le richieste per troppi tentativi non validi: la trasmissione riprenderà da sola, senza bisogno di intervenire.',
      })
    )
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-rentri-riprova"]')).toBeFalsy()
    expect(el.querySelector('[data-testid="fir-detail-rentri-vedi-certificato"]')).toBeFalsy()
    expect(el.textContent).toContain('riprenderà')
  })

  it('mostra "Riprova" quando manca il numero ufficiale nell\'esito (RENTRI_MISSING_NUMERO_FIR)', () => {
    setup({ role: 'ADMIN' })
    firService.getFIRById.and.returnValue(
      of({
        ...baseFIR,
        rentriSyncStatus: 'FAILED',
        rentriAzioneErrore: 'RIPROVA',
        rentriMessaggioErrore:
          'RENTRI ha accettato la trasmissione ma non ha restituito il numero ufficiale del formulario: il FIR non risulta ancora legato. Riprova la trasmissione.',
      })
    )
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-rentri-riprova"]')).toBeTruthy()
  })

  it('trasmette il FIR a RENTRI quando si preme "Trasmetti a RENTRI"', () => {
    setup({ role: 'ADMIN' })
    firService.getFIRById.and.returnValue(of(baseFIR))
    rentriSyncService.syncFIR.and.returnValue(of({ jobId: 'job-1', firId: 'fir-1', message: 'ok' }))
    fixture.detectChanges()

    component.trasmettiRENTRI(baseFIR)

    expect(rentriSyncService.syncFIR).toHaveBeenCalledWith('fir-1')
  })

  /**
   * R2 Task 8: «Rilascia legame RENTRI» deve comparire SOLO per le origini
   * ACQUISITO_DA_TERZI/AGGANCIO_MANUALE — mai su TRASMESSO_DA_NOI, dove il
   * dominio lo vieta (`FIR.rilasciaLegameRENTRI`, R2 Task 3). Un pulsante che
   * appare e poi fallisce con un 400 di dominio è peggio di un pulsante
   * assente.
   */
  describe('Rilascia legame RENTRI', () => {
    it('mostra il pulsante per un legame ACQUISITO_DA_TERZI', () => {
      setup({ role: 'ADMIN' })
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
      expect(el.querySelector('[data-testid="fir-detail-rentri-rilascia-legame"]')).toBeTruthy()
    })

    it('mostra il pulsante per un legame AGGANCIO_MANUALE', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(
        of({
          ...baseFIR,
          rentriSyncStatus: 'SYNCED',
          rentriNumeroFir: 'RENTRI-000999',
          rentriOrigineLegame: 'AGGANCIO_MANUALE',
        })
      )
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-rilascia-legame"]')).toBeTruthy()
    })

    it('NON mostra il pulsante per un legame TRASMESSO_DA_NOI (il dominio lo vieta)', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(
        of({
          ...baseFIR,
          rentriSyncStatus: 'SYNCED',
          rentriNumeroFir: 'RENTRI-000999',
          rentriOrigineLegame: 'TRASMESSO_DA_NOI',
        })
      )
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-rilascia-legame"]')).toBeFalsy()
    })

    it("NON mostra il pulsante quando non c'è alcun numero FIR legato", () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(
        of({ ...baseFIR, rentriSyncStatus: 'PENDING', rentriNumeroFir: null })
      )
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-rilascia-legame"]')).toBeFalsy()
    })

    it('rilascia il legame RENTRI e ricarica il FIR dopo conferma', () => {
      setup({ role: 'ADMIN', autoConfirm: true })
      const firConLegame: FIR = {
        ...baseFIR,
        rentriSyncStatus: 'SYNCED',
        rentriNumeroFir: 'RENTRI-000999',
        rentriOrigineLegame: 'ACQUISITO_DA_TERZI',
      }
      firService.getFIRById.and.returnValue(of(firConLegame))
      fixture.detectChanges()

      rentriFormulariService.rilasciaLegame.and.returnValue(
        of({ numeroFirRilasciato: 'RENTRI-000999' })
      )

      component.rilasciaLegameRENTRI(firConLegame)

      expect(rentriFormulariService.rilasciaLegame).toHaveBeenCalledWith('fir-1')
      // Rilasciato con successo: ricarica il FIR (v. reload()/loadFIR()).
      expect(firService.getFIRById).toHaveBeenCalledTimes(2)
    })

    it('mostra un errore leggibile se il backend rifiuta il rilascio', () => {
      setup({ role: 'ADMIN', autoConfirm: true })
      const firConLegame: FIR = {
        ...baseFIR,
        rentriSyncStatus: 'SYNCED',
        rentriNumeroFir: 'RENTRI-000999',
        rentriOrigineLegame: 'AGGANCIO_MANUALE',
      }
      firService.getFIRById.and.returnValue(of(firConLegame))
      fixture.detectChanges()

      rentriFormulariService.rilasciaLegame.and.returnValue(
        throwError(() => ({ error: { message: 'Nessun legame da rilasciare' } }))
      )

      expect(() => component.rilasciaLegameRENTRI(firConLegame)).not.toThrow()
      expect(rentriFormulariService.rilasciaLegame).toHaveBeenCalledWith('fir-1')
    })
  })
})
