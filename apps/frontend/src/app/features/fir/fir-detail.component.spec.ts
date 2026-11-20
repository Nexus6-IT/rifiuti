import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
// Il dialog di PrimeNG dichiara animazioni: senza un modulo che le gestisca,
// qualunque test che lo renda DAVVERO nel DOM fallisce con NG05105 prima ancora
// di poter verificare alcunche'. `Noop` e non `BrowserAnimations` perche' in un
// test non serve animare — serve solo che l'animazione non sia un errore.
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router'
import { of, throwError } from 'rxjs'
import { FirDetailComponent } from './fir-detail.component'
import { FirService } from './fir.service'
import { AuthService } from '../../core/services/auth.service'
import { RENTRISyncService } from './services/rentri-sync.service'
import { RentriFormulariService } from '../rentri/rentri-formulari.service'
import { RentriFirLifecycleService } from '../rentri/rentri-fir-lifecycle.service'
import { FIR, FIRStato } from '../../shared/models/fir.model'
import { ConfirmationService, MessageService } from 'primeng/api'
import { FeatureFlagsService } from '../../core/services/feature-flags.service'

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
  let rentriFirLifecycleService: jasmine.SpyObj<RentriFirLifecycleService>
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
    produttore: { ragioneSociale: 'Acme SRL', partitaIva: '12345678903' },
    trasportatore: { ragioneSociale: 'Trasporti SRL', partitaIva: '22345678902' },
    destinatario: { ragioneSociale: 'Impianto SRL', partitaIva: '32345678901' },
    rifiuto: { cerCode: '150101', quantita: 10, unitaMisura: 'kg' },
    createdAt: '2026-07-01T10:00:00.000Z',
    rentriSyncStatus: 'PENDING',
    canSyncToRENTRI: true,
  }

  function setup(
    overrides: { role?: string; firId?: string; autoConfirm?: boolean; rentri?: boolean } = {}
  ) {
    const activatedRouteStub = {
      snapshot: {
        paramMap: convertToParamMap({ id: overrides.firId ?? 'fir-1' }),
      },
    }

    firService = jasmine.createSpyObj('FirService', [
      'getFIRById',
      'emettiFIR',
      'presaInCarico',
      'confermaConsegna',
    ])
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
    rentriFirLifecycleService = jasmine.createSpyObj('RentriFirLifecycleService', [
      'azioniDisponibili',
      'accettaORespingi',
      'annullaFIR',
      'firmaInAttesa',
      'riprendiFirma',
      'resetStato',
      'elencaAllegati',
      'caricaAllegato',
      'eliminaAllegato',
      'scaricaPdf',
      'inviaQuantita',
      'inviaTrasporto',
      'firmaPartenza',
      'eventi',
      'ultimoTrasporto',
    ])
    // FIR in viaggio P2: default senza storico.
    rentriFirLifecycleService.eventi.and.returnValue(of({ eventi: [] }))
    rentriFirLifecycleService.ultimoTrasporto.and.returnValue(of({ trasporto: null }))
    rentriFirLifecycleService.elencaAllegati.and.returnValue(of([]))
    // FIR in viaggio P1: default senza firma in attesa (nessun banner).
    rentriFirLifecycleService.firmaInAttesa.and.returnValue(of({ sessione: null }))
    // R3 Task 8: default fail-closed, coerente con `loadFIR` che ora chiama
    // `/azioni` in background per un FIR legato con ruolo abilitato — nessuna
    // operazione dichiarata finché un test non impone esplicitamente il
    // contrario (v. describe 'Accettazione/respingimento del carico' e
    // 'Annullamento del formulario').
    rentriFirLifecycleService.azioniDisponibili.and.returnValue(
      of({ stato: 'Emesso', versione: 1, azioni: [] })
    )
    authService = jasmine.createSpyObj('AuthService', [], {
      currentUser: () => ({ id: 'u1', email: 'u@example.com', role: overrides.role ?? 'ADMIN' }),
    })

    const providers: unknown[] = [
      { provide: ActivatedRoute, useValue: activatedRouteStub },
      { provide: FirService, useValue: firService },
      { provide: RENTRISyncService, useValue: rentriSyncService },
      { provide: RentriFormulariService, useValue: rentriFormulariService },
      { provide: RentriFirLifecycleService, useValue: rentriFirLifecycleService },
      { provide: AuthService, useValue: authService },
      {
        provide: FeatureFlagsService,
        useValue: { has: (k: string) => k !== 'rentri' || overrides.rentri !== false },
      },
    ]

    TestBed.configureTestingModule({
      imports: [FirDetailComponent, HttpClientTestingModule, NoopAnimationsModule],
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

  it('mostra “P.IVA X · C.F. Y” e “C.F. Y” per un privato, mai “P.IVA N/D” se c’è il codice fiscale', () => {
    setup()
    firService.getFIRById.and.returnValue(
      of({
        ...baseFIR,
        produttore: {
          ragioneSociale: 'Acme SRL',
          partitaIva: '12345678903',
          codiceFiscale: '12345678903',
        },
        trasportatore: { ragioneSociale: 'Trasporti SRL', partitaIva: '22345678902' },
        destinatario: {
          ragioneSociale: 'Rossi Mario',
          partitaIva: '',
          codiceFiscale: 'RSSMRA80A01H501U',
        },
      })
    )
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    const testo = (id: string) => el.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
    expect(testo('fir-detail-produttore')).toContain('P.IVA 12345678903 · C.F. 12345678903')
    expect(testo('fir-detail-trasportatore')).toContain('P.IVA 22345678902')
    expect(testo('fir-detail-trasportatore')).not.toContain('C.F.')
    expect(testo('fir-detail-destinatario')).toContain('C.F. RSSMRA80A01H501U')
    expect(testo('fir-detail-destinatario')).not.toContain('P.IVA')
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
        rentriSyncStatus: 'PERMANENTLY_FAILED',
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

  it('mostra "Vai al certificato" (e non "Riprova") per un FIR fermo per certificato mancante', () => {
    setup({ role: 'ADMIN' })
    firService.getFIRById.and.returnValue(
      of({
        ...baseFIR,
        rentriSyncStatus: 'PERMANENTLY_FAILED',
        rentriAzioneErrore: 'VEDI_CERTIFICATO',
        rentriMessaggioErrore:
          "L'azienda non ha un certificato RENTRI configurato: caricalo nella pagina del certificato RENTRI.",
      })
    )
    fixture.detectChanges()

    const el: HTMLElement = fixture.nativeElement
    expect(el.querySelector('[data-testid="fir-detail-rentri-vedi-certificato"]')).toBeTruthy()
    expect(el.querySelector('[data-testid="fir-detail-rentri-riprova"]')).toBeFalsy()
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

  describe('Ritrasmetti dopo la verifica sul portale RENTRI', () => {
    const firIncerto: FIR = {
      ...baseFIR,
      rentriSyncStatus: 'PERMANENTLY_FAILED',
      rentriAzioneErrore: 'VERIFICA_SU_RENTRI',
      rentriMessaggioErrore:
        'Non sappiamo se RENTRI ha ricevuto il formulario: controlla sul portale RENTRI.',
    }
    const RITRASMETTI = '[data-testid="fir-detail-rentri-ritrasmetti-dopo-verifica"]'
    const RIPROVA = '[data-testid="fir-detail-rentri-riprova"]'

    it('Ritrasmetti visibile solo con VERIFICA_SU_RENTRI e PERMANENTLY_FAILED', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firIncerto))
      fixture.detectChanges()
      expect((fixture.nativeElement as HTMLElement).querySelector(RITRASMETTI)).toBeTruthy()

      expect(component.mostraRitrasmettiDopoVerifica(firIncerto)).toBeTrue()
      expect(
        component.mostraRitrasmettiDopoVerifica({ ...firIncerto, rentriSyncStatus: 'FAILED' })
      ).toBeFalse()
      expect(
        component.mostraRitrasmettiDopoVerifica({ ...firIncerto, rentriAzioneErrore: 'RIPROVA' })
      ).toBeFalse()
      expect(
        component.mostraRitrasmettiDopoVerifica({ ...firIncerto, rentriAzioneErrore: 'NESSUNA' })
      ).toBeFalse()
      // Un FIR già legato (es. collegato con «Cerca su RENTRI») non si ritrasmette.
      expect(
        component.mostraRitrasmettiDopoVerifica({ ...firIncerto, rentriNumeroFir: 'RENTRI-1' })
      ).toBeFalse()
    })

    it('Ritrasmetti non compare a chi non gestisce RENTRI', () => {
      setup({ role: 'VIEWER' })
      firService.getFIRById.and.returnValue(of(firIncerto))
      fixture.detectChanges()
      expect((fixture.nativeElement as HTMLElement).querySelector(RITRASMETTI)).toBeFalsy()
    })

    it('Riprova non compare per VERIFICA_SU_RENTRI', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of({ ...firIncerto, rentriSyncStatus: 'FAILED' }))
      fixture.detectChanges()
      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector(RIPROVA)).toBeFalsy()
      expect(el.querySelector(RITRASMETTI)).toBeFalsy()
    })

    it('conferma del dialog → syncFIR con confermaNuovaTrasmissione true', () => {
      setup({ role: 'ADMIN', autoConfirm: true })
      firService.getFIRById.and.returnValue(of(firIncerto))
      rentriSyncService.syncFIR.and.returnValue(
        of({ jobId: 'job-1', firId: 'fir-1', message: 'ok' })
      )
      fixture.detectChanges()
      const confirmation = fixture.debugElement.injector.get(ConfirmationService)

      component.ritrasmettiDopoVerifica(firIncerto)

      expect(confirmation.confirm).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message:
            'Hai controllato sul portale RENTRI che il formulario non esiste? Se esiste, ritrasmettere crea un doppione.',
        })
      )
      expect(rentriSyncService.syncFIR).toHaveBeenCalledWith('fir-1', {
        confermaNuovaTrasmissione: true,
      })
    })

    it('senza conferma non trasmette nulla', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firIncerto))
      fixture.detectChanges()
      const confirmation = fixture.debugElement.injector.get(ConfirmationService)
      spyOn(confirmation, 'confirm').and.returnValue(confirmation)

      component.ritrasmettiDopoVerifica(firIncerto)

      expect(rentriSyncService.syncFIR).not.toHaveBeenCalled()
    })
  })

  describe('Rileggi esito (esito non acquisito)', () => {
    const firNonAcquisito: FIR = {
      ...baseFIR,
      rentriSyncStatus: 'PERMANENTLY_FAILED',
      rentriAzioneErrore: 'RILEGGI_ESITO',
      rentriMessaggioErrore:
        "RENTRI ha ricevuto il formulario ma non siamo riusciti a leggerne l'esito. Premi «Rileggi esito»: non verrà creato un nuovo formulario.",
    }
    const RILEGGI = '[data-testid="fir-detail-rentri-rileggi-esito"]'
    const RITRASMETTI = '[data-testid="fir-detail-rentri-ritrasmetti-dopo-verifica"]'

    it('visibile con RILEGGI_ESITO e PERMANENTLY_FAILED; Ritrasmetti no', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firNonAcquisito))
      fixture.detectChanges()
      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector(RILEGGI)).toBeTruthy()
      expect(el.querySelector(RITRASMETTI)).toBeFalsy()

      expect(component.mostraRileggiEsito(firNonAcquisito)).toBeTrue()
      expect(
        component.mostraRileggiEsito({ ...firNonAcquisito, rentriSyncStatus: 'FAILED' })
      ).toBeFalse()
      expect(
        component.mostraRileggiEsito({
          ...firNonAcquisito,
          rentriAzioneErrore: 'VERIFICA_SU_RENTRI',
        })
      ).toBeFalse()
      expect(
        component.mostraRileggiEsito({ ...firNonAcquisito, rentriNumeroFir: 'RENTRI-1' })
      ).toBeFalse()
    })

    it('non compare a chi non gestisce RENTRI', () => {
      setup({ role: 'VIEWER' })
      firService.getFIRById.and.returnValue(of(firNonAcquisito))
      fixture.detectChanges()
      expect((fixture.nativeElement as HTMLElement).querySelector(RILEGGI)).toBeFalsy()
    })

    it('senza dialog: chiama la riapertura (confermaNuovaTrasmissione true)', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firNonAcquisito))
      rentriSyncService.syncFIR.and.returnValue(
        of({ jobId: 'job-1', firId: 'fir-1', message: 'ok' })
      )
      fixture.detectChanges()
      const confirmation = fixture.debugElement.injector.get(ConfirmationService)
      spyOn(confirmation, 'confirm').and.returnValue(confirmation)

      component.rileggiEsito(firNonAcquisito)

      expect(confirmation.confirm).not.toHaveBeenCalled()
      expect(rentriSyncService.syncFIR).toHaveBeenCalledWith('fir-1', {
        confermaNuovaTrasmissione: true,
      })
    })
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

  /**
   * R3 Task 4 — accettazione/respingimento del carico. Il punto più
   * delicato: il pulsante di conferma DEVE restare disabilitato finché i
   * campi obbligatori dell'opzione scelta non sono validi (niente invio con
   * motivazione vuota per parziale/respinto) — verificato lato UI, non solo
   * lato backend.
   */
  describe('Accettazione/respingimento del carico', () => {
    const firLegatoRentri: FIR = {
      ...baseFIR,
      rentriSyncStatus: 'SYNCED',
      rentriNumeroFir: 'RENTRI-000999',
      rifiuto: { cerCode: '150101', quantita: 42, unitaMisura: 'kg' },
    }

    it('mostra "Accetta il carico" solo per un FIR legato a RENTRI e un ruolo abilitato', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        of({
          stato: 'Emesso',
          versione: 1,
          azioni: [{ operazione: 'Accettazione', verbo: 'Accetta o respingi il carico' }],
        })
      )
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-accetta-carico"]')).toBeTruthy()
    })

    // R3 Task 8: il pulsante ora è pilotato dalla lista reale di `/azioni`, non
    // più da un criterio provvisorio locale — questo è il test che conta di
    // più in revisione (v. task-8-brief.md).
    it('NON mostra "Accetta il carico" se /azioni non include \'Accettazione\' fra le operazioni disponibili', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        of({
          stato: 'Emesso',
          versione: 1,
          azioni: [{ operazione: 'Annulla', verbo: 'Annulla il formulario' }],
        })
      )
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-accetta-carico"]')).toBeFalsy()
    })

    it('NON mostra "Accetta il carico" per un FIR non legato a RENTRI', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of({ ...baseFIR, rentriNumeroFir: null }))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-accetta-carico"]')).toBeFalsy()
      // Cautela di fail-closed (`loadFIR`): un FIR non legato a RENTRI non deve
      // MAI innescare la chiamata a `/azioni` — un refactor futuro che la
      // richiamasse comunque verrebbe rilevato qui.
      expect(rentriFirLifecycleService.azioniDisponibili).not.toHaveBeenCalled()
    })

    it('NON mostra "Accetta il carico" per un VIEWER', () => {
      setup({ role: 'VIEWER' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-accetta-carico"]')).toBeFalsy()
      // Stessa cautela: un ruolo non abilitato (VIEWER) non deve innescare la
      // chiamata a `/azioni` nemmeno per un FIR legato a RENTRI.
      expect(rentriFirLifecycleService.azioniDisponibili).not.toHaveBeenCalled()
    })

    it('apre il dialog precompilando la quantità con quella del rifiuto, opzione di default "intero"', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAccettazione(firLegatoRentri)

      expect(component['accettazioneDialogVisible']()).toBeTrue()
      expect(component['accettazioneOpzione']()).toBe('A')
      expect(component['accettazioneQuantitaKg']).toBe(42)
    })

    it('opzione "intero": valida con la sola quantità, non richiede causale/motivo', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAccettazione(firLegatoRentri)
      component['accettazioneOpzione'].set('A')
      component['accettazioneQuantitaKg'] = 42

      expect(component.accettazioneValida()).toBeTrue()
    })

    it('opzione "intero": NON valida senza quantità', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAccettazione(firLegatoRentri)
      component['accettazioneOpzione'].set('A')
      component['accettazioneQuantitaKg'] = null

      expect(component.accettazioneValida()).toBeFalse()
    })

    it('opzione "parziale": NON valida senza motivazione (anche con quantità e causale presenti)', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAccettazione(firLegatoRentri)
      component['accettazioneOpzione'].set('P')
      component['accettazioneQuantitaKg'] = 20
      component['accettazioneCausale'] = 'NC'
      component['accettazioneMotivo'] = '   '

      expect(component.accettazioneValida()).toBeFalse()
    })

    it('opzione "parziale": valida con quantità, causale e motivazione', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAccettazione(firLegatoRentri)
      component['accettazioneOpzione'].set('P')
      component['accettazioneQuantitaKg'] = 20
      component['accettazioneCausale'] = 'NC'
      component['accettazioneMotivo'] = 'Quantità parzialmente non conforme'

      expect(component.accettazioneValida()).toBeTrue()
    })

    it('opzione "respingi": NON valida senza causale né motivazione, e non richiede quantità', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAccettazione(firLegatoRentri)
      component['accettazioneOpzione'].set('R')
      component['accettazioneQuantitaKg'] = null

      expect(component.accettazioneValida()).toBeFalse()

      component['accettazioneCausale'] = 'IR'
      component['accettazioneMotivo'] = 'Il carico è irricevibile'

      expect(component.accettazioneValida()).toBeTrue()
    })

    it('il pulsante di conferma nel DOM è disabilitato finché l’opzione non è valida', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAccettazione(firLegatoRentri)
      component['accettazioneOpzione'].set('R')
      fixture.detectChanges()

      const bottone: HTMLButtonElement | null = fixture.nativeElement.querySelector(
        '[data-testid="fir-detail-rentri-accettazione-confirm-button"] button'
      )
      expect(bottone?.disabled).toBeTrue()
    })

    it("invia il payload atteso al servizio per un'accettazione intera", () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.accettaORespingi.and.returnValue(
        of({
          tipoAccettazione: 'A',
          esitoFirma: { esito: 'COMPLETATA', statoFormulario: 'Accettato' },
        })
      )

      component.apriDialogAccettazione(firLegatoRentri)
      component['accettazioneOpzione'].set('A')
      component['accettazioneQuantitaKg'] = 42
      component.confermaAccettazione()

      expect(rentriFirLifecycleService.accettaORespingi).toHaveBeenCalledWith(
        'fir-1',
        jasmine.objectContaining({ tipoAccettazione: 'A', quantitaAccettataKg: 42 })
      )
    })

    it('invia il payload atteso al servizio per un respingimento (causale + motivo, niente quantità)', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.accettaORespingi.and.returnValue(
        of({
          tipoAccettazione: 'R',
          esitoFirma: { esito: 'COMPLETATA', statoFormulario: 'RespintoAccettatoParzialmente' },
        })
      )

      component.apriDialogAccettazione(firLegatoRentri)
      component['accettazioneOpzione'].set('R')
      component['accettazioneCausale'] = 'IR'
      component['accettazioneMotivo'] = 'Il carico è irricevibile'
      component.confermaAccettazione()

      expect(rentriFirLifecycleService.accettaORespingi).toHaveBeenCalledWith(
        'fir-1',
        jasmine.objectContaining({
          tipoAccettazione: 'R',
          causaleRespingimento: 'IR',
          motivoRespingimento: 'Il carico è irricevibile',
          quantitaAccettataKg: undefined,
        })
      )
    })

    it('non invia nulla se si tenta la conferma con opzione non valida', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAccettazione(firLegatoRentri)
      component['accettazioneOpzione'].set('R')
      // Nessuna causale/motivazione impostata.
      component.confermaAccettazione()

      expect(rentriFirLifecycleService.accettaORespingi).not.toHaveBeenCalled()
    })

    it('chiude il dialog e ricarica il FIR dopo una conferma riuscita', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.accettaORespingi.and.returnValue(
        of({
          tipoAccettazione: 'A',
          esitoFirma: {
            esito: 'IN_ATTESA',
            handle: 'h1',
            scadenzaAutorizzazione: '2026-01-01T00:00:00.000Z',
          },
        })
      )

      component.apriDialogAccettazione(firLegatoRentri)
      component['accettazioneOpzione'].set('A')
      component['accettazioneQuantitaKg'] = 42
      component.confermaAccettazione()

      expect(component['accettazioneDialogVisible']()).toBeFalse()
      expect(firService.getFIRById).toHaveBeenCalledTimes(2)
    })

    it('mostra un errore leggibile se il backend rifiuta l’accettazione', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.accettaORespingi.and.returnValue(
        throwError(() => ({ error: { message: 'Il formulario non è nella fase di accettazione' } }))
      )

      component.apriDialogAccettazione(firLegatoRentri)
      component['accettazioneOpzione'].set('A')
      component['accettazioneQuantitaKg'] = 42

      expect(() => component.confermaAccettazione()).not.toThrow()
      expect(rentriFirLifecycleService.accettaORespingi).toHaveBeenCalled()
    })
  })

  /**
   * R3 Task 5 — annullamento del formulario, con nota. Stesso criterio di
   * visibilità di "Accetta il carico" (Task 4): il punto delicato qui è che
   * il pulsante di conferma resti disabilitato con un motivo vuoto o oltre
   * 1024 caratteri, e che il payload inviato al servizio contenga
   * ESATTAMENTE il testo scritto dall'utente.
   */
  describe('Annullamento del formulario', () => {
    const firLegatoRentri: FIR = {
      ...baseFIR,
      rentriSyncStatus: 'SYNCED',
      rentriNumeroFir: 'RENTRI-000999',
    }

    it('mostra "Annulla il formulario" solo per un FIR legato a RENTRI e un ruolo abilitato', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        of({
          stato: 'Emesso',
          versione: 1,
          azioni: [{ operazione: 'Annulla', verbo: 'Annulla il formulario' }],
        })
      )
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-annulla-formulario"]')).toBeTruthy()
    })

    // R3 Task 8: stesso schema del test analogo per "Accetta il carico".
    it('NON mostra "Annulla il formulario" se /azioni non include \'Annulla\' fra le operazioni disponibili', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        of({
          stato: 'Emesso',
          versione: 1,
          azioni: [{ operazione: 'Accettazione', verbo: 'Accetta o respingi il carico' }],
        })
      )
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-annulla-formulario"]')).toBeFalsy()
    })

    // Revisione R3 Task 8 (Critical-1): `haAzioni` decideva se mostrare
    // l'INTERA sezione «Azioni disponibili» guardando solo
    // `canAccettareCarico`. Per un FIR legato in uno stato diverso da
    // BOZZA/EMESSO (qui CONSEGNATO) con `/azioni` che risponde SOLO con
    // 'Annulla' (niente 'Accettazione'), `haAzioni` tornava falso e faceva
    // sparire l'intera sezione — compresi "Annulla il formulario" e
    // "Aggiorna lo stato", che invece devono comparire. Questo test blocca
    // la regressione: la sezione e i due pulsanti devono essere presenti.
    it("mostra la sezione «Azioni disponibili» (Annulla + Aggiorna lo stato) per un FIR CONSEGNATO legato a RENTRI quando /azioni offre solo 'Annulla'", () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of({ ...firLegatoRentri, stato: FIRStato.CONSEGNATO }))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        of({
          stato: 'Consegnato',
          versione: 1,
          azioni: [{ operazione: 'Annulla', verbo: 'Annulla il formulario' }],
        })
      )
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-actions"]')).toBeTruthy()
      expect(el.querySelector('[data-testid="fir-detail-rentri-annulla-formulario"]')).toBeTruthy()
      expect(el.querySelector('[data-testid="fir-detail-rentri-aggiorna-stato"]')).toBeTruthy()
    })

    it('NON mostra "Annulla il formulario" per un FIR non legato a RENTRI', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of({ ...baseFIR, rentriNumeroFir: null }))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-annulla-formulario"]')).toBeFalsy()
    })

    it('NON mostra "Annulla il formulario" per un VIEWER', () => {
      setup({ role: 'VIEWER' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-annulla-formulario"]')).toBeFalsy()
    })

    it('apre il dialog azzerando il motivo precedente', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component['annullamentoMotivo'] = 'residuo di un tentativo precedente'
      component.apriDialogAnnullamento()

      expect(component['annullamentoDialogVisible']()).toBeTrue()
      expect(component['annullamentoMotivo']).toBe('')
    })

    it('NON valida con un motivo vuoto', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAnnullamento()
      component['annullamentoMotivo'] = '   '

      expect(component.annullamentoValido()).toBeFalse()
    })

    it('NON valida con un motivo oltre 1024 caratteri', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAnnullamento()
      component['annullamentoMotivo'] = 'x'.repeat(1025)

      expect(component.annullamentoValido()).toBeFalse()
    })

    it('valida con un motivo non vuoto entro 1024 caratteri', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAnnullamento()
      component['annullamentoMotivo'] = 'errore di pesatura alla partenza'

      expect(component.annullamentoValido()).toBeTrue()
    })

    it('il pulsante di conferma nel DOM è disabilitato con motivo vuoto', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAnnullamento()
      fixture.detectChanges()

      const bottone: HTMLButtonElement | null = fixture.nativeElement.querySelector(
        '[data-testid="fir-detail-rentri-annulla-confirm-button"] button'
      )
      expect(bottone?.disabled).toBeTrue()
    })

    it('invia il payload atteso al servizio ({motivo: ...})', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.annullaFIR.and.returnValue(
        of({ esitoFirma: { esito: 'COMPLETATA', statoFormulario: 'Annullato' }, noteInviate: true })
      )

      component.apriDialogAnnullamento()
      component['annullamentoMotivo'] = 'errore di pesatura alla partenza'
      component.confermaAnnullamento()

      expect(rentriFirLifecycleService.annullaFIR).toHaveBeenCalledWith('fir-1', {
        motivo: 'errore di pesatura alla partenza',
      })
    })

    it('non invia nulla se si tenta la conferma con motivo non valido', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAnnullamento()
      // Nessun motivo impostato.
      component.confermaAnnullamento()

      expect(rentriFirLifecycleService.annullaFIR).not.toHaveBeenCalled()
    })

    it('chiude il dialog e ricarica il FIR dopo una conferma riuscita', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.annullaFIR.and.returnValue(
        of({
          esitoFirma: {
            esito: 'IN_ATTESA',
            handle: 'h1',
            scadenzaAutorizzazione: '2026-01-01T00:00:00.000Z',
          },
          noteInviate: false,
        })
      )

      component.apriDialogAnnullamento()
      component['annullamentoMotivo'] = 'errore di pesatura alla partenza'
      component.confermaAnnullamento()

      expect(component['annullamentoDialogVisible']()).toBeFalse()
      expect(firService.getFIRById).toHaveBeenCalledTimes(2)
    })

    it('mostra un errore leggibile se il backend rifiuta l’annullamento', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.annullaFIR.and.returnValue(
        throwError(() => ({
          error: {
            message: 'Questo formulario non è (più) nella fase in cui può essere annullato',
          },
        }))
      )

      component.apriDialogAnnullamento()
      component['annullamentoMotivo'] = 'errore di pesatura alla partenza'

      expect(() => component.confermaAnnullamento()).not.toThrow()
      expect(rentriFirLifecycleService.annullaFIR).toHaveBeenCalled()
    })
  })

  describe('Allegati del formulario', () => {
    const firLegatoRentri: FIR = {
      ...baseFIR,
      rentriSyncStatus: 'SYNCED',
      rentriNumeroFir: 'RENTRI-000999',
    }

    function creaFilePdf(nome: string, byte: number): File {
      return new File([new Uint8Array(byte)], nome, { type: 'application/pdf' })
    }

    function creaEvento(file: File): Event {
      const input = document.createElement('input')
      input.type = 'file'
      Object.defineProperty(input, 'files', { value: [file] })
      return { target: input } as unknown as Event
    }

    it('mostra la sezione allegati solo per un FIR legato a RENTRI', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-allegati-upload-input"]')).toBeTruthy()
      expect(el.querySelector('[data-testid="fir-detail-allegati-list"]')).toBeTruthy()
    })

    it('NON mostra la sezione allegati per un FIR non legato a RENTRI', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of({ ...baseFIR, rentriNumeroFir: null }))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-allegati-upload-input"]')).toBeFalsy()
    })

    it('carica l’elenco degli allegati all’apertura della pagina', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      rentriFirLifecycleService.elencaAllegati.and.returnValue(
        of([
          {
            id: 'allegato-1',
            rentriAllegatoId: 7,
            filename: 'analisi.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            caricatoDa: 'u1',
            caricatoAlle: '2026-07-27T10:00:00.000Z',
          },
        ])
      )
      fixture.detectChanges()

      expect(rentriFirLifecycleService.elencaAllegati).toHaveBeenCalledWith('fir-1')
      expect(component['allegati']().length).toBe(1)

      fixture.detectChanges()
      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-allegati-row-allegato-1"]')).toBeTruthy()
      expect(
        el.querySelector('[data-testid="fir-detail-allegati-elimina-allegato-1"]')
      ).toBeTruthy()
    })

    it('un file diverso da PDF NON viene inviato al servizio', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      const file = new File(['x'], 'foto.png', { type: 'image/png' })
      component.onFileSelezionatoAllegato(creaEvento(file), firLegatoRentri)

      expect(rentriFirLifecycleService.caricaAllegato).not.toHaveBeenCalled()
    })

    it('un file oltre 1 MB NON viene inviato al servizio', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      const fileTroppoGrande = creaFilePdf('troppo-grande.pdf', 1024 * 1024 + 1)
      component.onFileSelezionatoAllegato(creaEvento(fileTroppoGrande), firLegatoRentri)

      expect(rentriFirLifecycleService.caricaAllegato).not.toHaveBeenCalled()
    })

    it('un PDF entro il limite viene letto e inviato in base64, senza identificativoSoggetto', done => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.caricaAllegato.and.returnValue(
        of({
          id: 'allegato-nuovo',
          rentriAllegatoId: 9,
          filename: 'analisi.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 100,
          caricatoDa: 'u1',
          caricatoAlle: '2026-07-27T10:00:00.000Z',
        })
      )

      const file = creaFilePdf('analisi.pdf', 100)
      component.onFileSelezionatoAllegato(creaEvento(file), firLegatoRentri)

      // FileReader e' asincrono: verifichiamo dopo che ha finito di leggere.
      setTimeout(() => {
        expect(rentriFirLifecycleService.caricaAllegato).toHaveBeenCalledTimes(1)
        const [firId, payload] = rentriFirLifecycleService.caricaAllegato.calls.mostRecent().args
        expect(firId).toBe('fir-1')
        expect(payload.nomeFile).toBe('analisi.pdf')
        expect(payload.contentType).toBe('application/pdf')
        expect(typeof payload.contenutoBase64).toBe('string')
        expect(Object.keys(payload)).not.toContain('identificativoSoggetto')
        done()
      }, 500)
    })

    it('elimina un allegato solo dopo conferma, e lo rimuove dall’elenco locale', () => {
      setup({ role: 'ADMIN', autoConfirm: true })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      const allegato = {
        id: 'allegato-1',
        rentriAllegatoId: 7,
        filename: 'analisi.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2048,
        caricatoDa: 'u1',
        caricatoAlle: '2026-07-27T10:00:00.000Z',
      }
      rentriFirLifecycleService.elencaAllegati.and.returnValue(of([allegato]))
      fixture.detectChanges()

      rentriFirLifecycleService.eliminaAllegato.and.returnValue(of({ eliminato: true }))

      component.eliminaAllegatoFir(firLegatoRentri, allegato)

      expect(rentriFirLifecycleService.eliminaAllegato).toHaveBeenCalledWith('fir-1', 'allegato-1')
      expect(component['allegati']().length).toBe(0)
    })
  })

  describe('Stampa PDF e aggiornamento dello stato (R3 Task 7)', () => {
    const firLegatoRentri: FIR = {
      ...baseFIR,
      rentriSyncStatus: 'SYNCED',
      rentriNumeroFir: 'RENTRI-000999',
    }

    it('mostra i due pulsanti solo per un FIR legato a RENTRI', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-scarica-pdf"]')).toBeTruthy()
      expect(el.querySelector('[data-testid="fir-detail-rentri-aggiorna-stato"]')).toBeTruthy()
    })

    it('NON mostra i due pulsanti per un FIR non legato a RENTRI', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(baseFIR))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-scarica-pdf"]')).toBeFalsy()
      expect(el.querySelector('[data-testid="fir-detail-rentri-aggiorna-stato"]')).toBeFalsy()
    })

    // R3 Task 7 aveva scelto "nessuna chiamata automatica" come criterio
    // provvisorio: il caricamento di `/azioni` avveniva SOLO sull'azione
    // esplicita "Aggiorna lo stato". Il Task 8 lo sostituisce esplicitamente
    // (v. piano, Step 1 "Caricare /azioni all'apertura della pagina"): ora
    // la lista reale delle azioni disponibili pilota i pulsanti del ciclo di
    // vita, quindi deve essere caricata già all'apertura pagina. Questo test,
    // che prima asseriva il contrario, è stato aggiornato di conseguenza
    // anziché cancellato in silenzio.
    it('apertura della pagina chiama /azioni per un FIR legato, per pilotare i pulsanti (R3 Task 8)', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      expect(rentriFirLifecycleService.azioniDisponibili).toHaveBeenCalledWith('fir-1')
    })

    it('un errore nel caricamento di /azioni all’apertura pagina non fa fallire il caricamento del FIR (i pulsanti governati da /azioni restano assenti)', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        throwError(() => ({ status: 500, error: { message: 'Errore ente' } }))
      )

      expect(() => fixture.detectChanges()).not.toThrow()

      expect(component['fir']()).toEqual(firLegatoRentri)
      expect(component['error']()).toBeNull()
      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-accetta-carico"]')).toBeFalsy()
      expect(el.querySelector('[data-testid="fir-detail-rentri-annulla-formulario"]')).toBeFalsy()
    })

    it('scarica il PDF ricevuto come Blob e avvia il download, senza mai navigare fuori da WasteFlow', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      const blob = new Blob(['%PDF-1.4 contenuto di prova'], { type: 'application/pdf' })
      const headers = new Map([
        ['content-disposition', 'attachment; filename="FIR-RENTRI-000999.pdf"'],
      ])
      rentriFirLifecycleService.scaricaPdf.and.returnValue(
        of({
          status: 200,
          body: blob,
          headers: { get: (nome: string) => headers.get(nome) ?? null },
        } as any)
      )

      // Il componente crea un solo elemento ('a') per avviare il download:
      // basta restituire sempre un anchor fittizio, senza delegare al vero
      // `document.createElement` (nessun altro tag viene creato da questo metodo).
      const anchorClickSpy = jasmine.createSpy('click')
      spyOn(document, 'createElement').and.returnValue({
        click: anchorClickSpy,
        href: '',
        download: '',
      } as unknown as HTMLAnchorElement)
      spyOn(window.URL, 'createObjectURL').and.returnValue('blob:fake-url')
      spyOn(window.URL, 'revokeObjectURL')

      component.scaricaPdfRentri(firLegatoRentri)

      expect(rentriFirLifecycleService.scaricaPdf).toHaveBeenCalledWith('fir-1')
      expect(anchorClickSpy).toHaveBeenCalled()
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
    })

    it("non avvia alcun download e informa l'utente quando l'ente risponde 204 (PDF non ancora disponibile)", () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.scaricaPdf.and.returnValue(
        of({ status: 204, body: null, headers: { get: () => null } } as any)
      )
      spyOn(window.URL, 'createObjectURL')

      component.scaricaPdfRentri(firLegatoRentri)

      expect(window.URL.createObjectURL).not.toHaveBeenCalled()
    })

    it('mostra un errore leggibile se lo scaricamento del PDF fallisce', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.scaricaPdf.and.returnValue(
        throwError(() => ({ status: 500, error: { message: 'Errore ente' } }))
      )

      expect(() => component.scaricaPdfRentri(firLegatoRentri)).not.toThrow()
      expect(component['pdfScaricamentoInCorso']()).toBe(false)
    })

    it("'Aggiorna lo stato' chiama /azioni ESPLICITAMENTE (azione utente) e ricarica il FIR", () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        of({ stato: 'Accettato', versione: 2, azioni: [] })
      )

      component.aggiornaStatoRentri(firLegatoRentri)

      expect(rentriFirLifecycleService.azioniDisponibili).toHaveBeenCalledWith('fir-1')
      // Il reload richiama getFIRById: già invocata una volta all'apertura
      // pagina, deve essere invocata ANCORA dopo l'aggiornamento esplicito.
      expect(firService.getFIRById).toHaveBeenCalledTimes(2)
    })

    it("mostra un errore leggibile se l'aggiornamento dello stato fallisce", () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        throwError(() => ({ status: 500, error: { message: 'Errore ente' } }))
      )

      component.aggiornaStatoRentri(firLegatoRentri)

      expect(component['aggiornamentoStatoInCorso']()).toBe(false)
    })
  })

  describe('Quantità verificata a destino (F2-7)', () => {
    const consegnato = (verificata: number, oltre: boolean, perc: number): FIR => ({
      ...baseFIR,
      stato: FIRStato.CONSEGNATO,
      dataConsegna: '2026-07-02T10:00:00.000Z',
      pesoEffettivo: verificata,
      scostamentoPeso: {
        differenza: verificata - 10,
        percentuale: perc,
        unita: 'kg',
        oltreSoglia: oltre,
      },
    })

    it('mostra valore, unità e scostamento accanto alla data di consegna', () => {
      setup()
      firService.getFIRById.and.returnValue(of(consegnato(10.5, false, 5)))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      const riga = el.querySelector('[data-testid="fir-detail-quantita-verificata"]')
      expect(riga?.textContent).toContain('10,5 kg')
      const scost = el.querySelector('[data-testid="fir-detail-scostamento"]')
      expect(scost?.textContent).toContain('+5%')
      expect(scost?.classList.contains('detail-scostamento--oltre')).toBeFalse()
    })

    it('evidenzia lo scostamento oltre soglia', () => {
      setup()
      firService.getFIRById.and.returnValue(of(consegnato(15, true, 50)))
      fixture.detectChanges()

      const scost = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="fir-detail-scostamento"]'
      )
      expect(scost?.classList.contains('detail-scostamento--oltre')).toBeTrue()
      expect(scost?.textContent).toContain('oltre la soglia')
    })

    it('senza quantità verificata mostra un trattino e nessuno scostamento', () => {
      setup()
      firService.getFIRById.and.returnValue(of(baseFIR))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(
        el.querySelector('[data-testid="fir-detail-quantita-verificata"]')?.textContent?.trim()
      ).toBe('—')
      expect(el.querySelector('[data-testid="fir-detail-scostamento"]')).toBeNull()
    })
  })

  describe('Modifica della bozza', () => {
    const bozza = (extra: Partial<FIR> = {}): FIR => ({
      ...baseFIR,
      stato: FIRStato.BOZZA,
      numeroProgressivo: null,
      versione: 2,
      modificabile: true,
      motivoNonModificabile: null,
      ...extra,
    })

    it('mostra «Modifica» su una bozza modificabile e naviga alla lista col parametro', () => {
      setup()
      firService.getFIRById.and.returnValue(of(bozza()))
      const router = TestBed.inject(Router)
      const navigate = spyOn(router, 'navigate').and.resolveTo(true)
      fixture.detectChanges()

      const bottone = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="fir-detail-modifica"] button'
      ) as HTMLButtonElement
      expect(bottone).toBeTruthy()
      bottone.click()

      expect(navigate).toHaveBeenCalledWith(['/fir'], { queryParams: { modifica: 'fir-1' } })
    })

    it('senza il pulsante per un VIEWER', () => {
      setup({ role: 'VIEWER' })
      firService.getFIRById.and.returnValue(of(bozza()))
      fixture.detectChanges()
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-testid="fir-detail-modifica"]')
      ).toBeNull()
    })

    it('senza il pulsante ma col motivo leggibile se la bozza non è modificabile', () => {
      setup()
      firService.getFIRById.and.returnValue(
        of(bozza({ modificabile: false, motivoNonModificabile: 'FIRMATO' }))
      )
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-modifica"]')).toBeNull()
      expect(
        el.querySelector('[data-testid="fir-detail-motivo-non-modificabile"]')?.textContent
      ).toContain('porta già una firma')
    })

    it('haAzioni è vera per la sola modifica (FIR non BOZZA ma modificabile non esiste: si verifica puoModificare)', () => {
      setup()
      firService.getFIRById.and.returnValue(of(bozza()))
      fixture.detectChanges()
      expect(component.puoModificare(bozza())).toBeTrue()
      expect(component.haAzioni(bozza())).toBeTrue()
      expect(component.puoModificare(bozza({ modificabile: false }))).toBeFalse()
      expect(component.puoModificare({ ...baseFIR, modificabile: true })).toBeFalse()
    })
  })

  describe("FIR importato bloccato all'invio a RENTRI (Fase 3)", () => {
    const MOTIVO = 'Importato: invio a RENTRI bloccato fino alla riconciliazione'
    const firEmessoImportato = {
      ...baseFIR,
      stato: FIRStato.EMESSO,
      rentriSyncStatus: 'PENDING',
      canSyncToRENTRI: false,
      bloccatoInvio: true,
      motivoBloccoInvio: MOTIVO,
    } as FIR

    it('mostra il tag «Importato: invio a RENTRI bloccato» e il pulsante «Trasmetti a RENTRI» disabilitato', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firEmessoImportato))
      fixture.detectChanges()
      const el = fixture.nativeElement as HTMLElement

      const tag = el.querySelector('[data-testid="fir-detail-rentri-bloccato"]')
      expect(tag?.textContent).toContain('Importato: invio a RENTRI bloccato')
      const bottone = el.querySelector(
        '[data-testid="fir-detail-rentri-trasmetti-bloccato"] button'
      ) as HTMLButtonElement
      expect(bottone).withContext('pulsante disabilitato presente').not.toBeNull()
      expect(bottone.disabled).toBeTrue()
      // nessun pulsante abilitato per trasmettere
      expect(el.querySelector('[data-testid="fir-detail-rentri-trasmetti"]')).toBeNull()
      expect(component.canTrasmettereRentri(firEmessoImportato)).toBeFalse()
    })

    it('un FIR normale non mostra il tag di blocco', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(
        of({ ...firEmessoImportato, bloccatoInvio: false, motivoBloccoInvio: null } as FIR)
      )
      fixture.detectChanges()
      const el = fixture.nativeElement as HTMLElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-bloccato"]')).toBeNull()
      expect(el.querySelector('[data-testid="fir-detail-rentri-trasmetti-bloccato"]')).toBeNull()
    })
  })

  describe('azienda senza il modulo rentri (TRIAL/PROFESSIONAL)', () => {
    it('apre il dettaglio senza cronologia RENTRI e senza nessuna chiamata a /rentri/', () => {
      setup({ rentri: false })
      firService.getFIRById.and.returnValue(
        of({ ...baseFIR, rentriNumeroFir: 'RENTRI-1', rentriSyncStatus: 'SYNCED' } as FIR)
      )
      fixture.detectChanges()
      const el = fixture.nativeElement as HTMLElement
      expect(el.textContent).toContain('FIR-2026-000001')
      expect(el.querySelector('[data-testid="rentri-sync-logs"]')).toBeNull()
      expect(el.querySelector('[data-testid="fir-detail-rentri-status"]')).toBeNull()
      expect(rentriSyncService.getSyncLogs).not.toHaveBeenCalled()
      expect(rentriFirLifecycleService.azioniDisponibili).not.toHaveBeenCalled()
      expect(rentriFirLifecycleService.elencaAllegati).not.toHaveBeenCalled()
      httpMock.expectNone(r => r.url.includes('/rentri/'))
    })
  })
  describe('Conferma consegna (destinatario)', () => {
    it('su un FIR IN_TRANSITO mostra il bottone, che apre il dialog con il peso', () => {
      setup()
      firService.getFIRById.and.returnValue(of({ ...baseFIR, stato: FIRStato.IN_TRANSITO }))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      const bottone = el.querySelector(
        '[data-testid="fir-detail-conferma-consegna"]'
      ) as HTMLElement | null
      expect(bottone).toBeTruthy()
      component.apriConsegna()
      fixture.detectChanges()
      expect(component['consegnaDialogVisible']).toBeTrue()
    })

    it('su un FIR IN_TRANSITO legato a RENTRI il bottone non c e (comanda RENTRI)', () => {
      setup()
      firService.getFIRById.and.returnValue(
        of({ ...baseFIR, stato: FIRStato.IN_TRANSITO, rentriNumeroFir: 'FIR-RENTRI-1' })
      )
      fixture.detectChanges()
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="fir-detail-conferma-consegna"]'
        )
      ).toBeNull()
    })

    it('su un FIR EMESSO il bottone non c e', () => {
      setup()
      firService.getFIRById.and.returnValue(of(baseFIR))
      fixture.detectChanges()
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="fir-detail-conferma-consegna"]'
        )
      ).toBeNull()
    })

    it('la conferma invia il peso e aggiorna il FIR a CONSEGNATO', () => {
      setup()
      firService.getFIRById.and.returnValue(of({ ...baseFIR, stato: FIRStato.IN_TRANSITO }))
      fixture.detectChanges()
      firService.confermaConsegna.and.returnValue(of({ ...baseFIR, stato: FIRStato.CONSEGNATO }))

      component.apriConsegna()
      component['consegnaPeso'] = 98.5
      component.confermaConsegna()

      expect(firService.confermaConsegna).toHaveBeenCalledWith('fir-1', { pesoEffettivo: 98.5 })
      expect(component['fir']()?.stato).toBe(FIRStato.CONSEGNATO)
      expect(component['consegnaDialogVisible']).toBeFalse()
    })

    it('senza peso valido non chiama il servizio', () => {
      setup()
      firService.getFIRById.and.returnValue(of({ ...baseFIR, stato: FIRStato.IN_TRANSITO }))
      fixture.detectChanges()
      component.apriConsegna()
      component.confermaConsegna()
      expect(firService.confermaConsegna).not.toHaveBeenCalled()
    })
  })
  describe('Firma in attesa di conferma sul dispositivo (FIR in viaggio, P1)', () => {
    const firLegato: FIR = {
      ...baseFIR,
      rentriSyncStatus: 'SYNCED',
      rentriNumeroFir: 'RENTRI-000777',
    }
    const scadenzaFutura = new Date(Date.now() + 90_000).toISOString()
    const sessione = {
      id: 'sess-1',
      tipoOperazione: 'ACCETTAZIONE',
      scadenza: scadenzaFutura,
      stato: 'IN_ATTESA' as const,
      scaduta: false,
    }

    it('senza sessione aperta non mostra il banner', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      fixture.detectChanges()
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="fir-detail-firma-in-attesa"]'
        )
      ).toBeFalsy()
    })

    it('con una sessione aperta mostra il banner con i due pulsanti e non quello di nuova richiesta', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.firmaInAttesa.and.returnValue(of({ sessione }))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      const banner = el.querySelector('[data-testid="fir-detail-firma-in-attesa"]')
      expect(banner?.textContent).toContain(
        "In attesa della tua conferma sull'app RENTRI FIR Digitale"
      )
      expect(el.querySelector('[data-testid="fir-detail-firma-riprendi"]')).toBeTruthy()
      expect(el.querySelector('[data-testid="fir-detail-firma-annulla-richiesta"]')).toBeTruthy()
      expect(el.querySelector('[data-testid="fir-detail-firma-richiedi-di-nuovo"]')).toBeFalsy()
    })

    it('sessione scaduta: dice che non e stato firmato nulla e offre la nuova richiesta, non la ripresa', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.firmaInAttesa.and.returnValue(
        of({ sessione: { ...sessione, stato: 'SCADUTA' as const, scaduta: true } })
      )
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-firma-scaduta"]')?.textContent).toContain(
        'Non è stato firmato nulla'
      )
      expect(el.querySelector('[data-testid="fir-detail-firma-richiedi-di-nuovo"]')).toBeTruthy()
      expect(el.querySelector('[data-testid="fir-detail-firma-riprendi"]')).toBeFalsy()
    })

    it('I3: dopo una scadenza il reload mostra ancora il banner con «Richiedi di nuovo» e «Annulla»', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      const scaduta = { ...sessione, stato: 'SCADUTA' as const, scaduta: true }
      rentriFirLifecycleService.firmaInAttesa.and.returnValues(
        of({ sessione }),
        of({ sessione: scaduta })
      )
      rentriFirLifecycleService.riprendiFirma.and.returnValue(
        of({ esito: 'SCADUTA', handle: 'h', rilevataDa: 'orologio-locale' })
      )
      fixture.detectChanges()

      component.riprendiFirma(firLegato, sessione, false)
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-firma-richiedi-di-nuovo"]')).toBeTruthy()
      expect(el.querySelector('[data-testid="fir-detail-firma-annulla-richiesta"]')).toBeTruthy()
      expect(el.querySelector('[data-testid="fir-detail-firma-riprendi"]')).toBeFalsy()
    })

    it('R1: dopo «Annulla la richiesta» su una richiesta scaduta il banner sparisce al reload', () => {
      setup({ role: 'OPERATOR', autoConfirm: true })
      firService.getFIRById.and.returnValue(of(firLegato))
      const scaduta = { ...sessione, stato: 'SCADUTA' as const, scaduta: true }
      rentriFirLifecycleService.firmaInAttesa.and.returnValues(
        of({ sessione: scaduta }),
        of({ sessione: null })
      )
      rentriFirLifecycleService.resetStato.and.returnValue(
        of({ operazione: 'Reset', statoFormulario: 'InserimentoAccettazione' })
      )
      fixture.detectChanges()
      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-firma-in-attesa"]')).toBeTruthy()

      component.annullaRichiestaFirma(firLegato)
      fixture.detectChanges()

      expect(rentriFirLifecycleService.resetStato).toHaveBeenCalledTimes(1)
      expect(el.querySelector('[data-testid="fir-detail-firma-in-attesa"]')).toBeFalsy()
    })

    it('I3: una firma RIFIUTATA mostra il messaggio dedicato e i due pulsanti', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.firmaInAttesa.and.returnValue(
        of({ sessione: { ...sessione, stato: 'RIFIUTATA' as const, scaduta: true } })
      )
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-firma-rifiutata"]')?.textContent).toContain(
        'rifiutata'
      )
      expect(el.querySelector('[data-testid="fir-detail-firma-richiedi-di-nuovo"]')).toBeTruthy()
      expect(el.querySelector('[data-testid="fir-detail-firma-annulla-richiesta"]')).toBeTruthy()
    })

    it('un VIEWER non vede il banner e non chiama /firme/in-attesa', () => {
      setup({ role: 'VIEWER' })
      firService.getFIRById.and.returnValue(of(firLegato))
      fixture.detectChanges()
      expect(rentriFirLifecycleService.firmaInAttesa).not.toHaveBeenCalled()
    })

    it('«Ho confermato, controlla» riprende la sessione (senza nuovaSessione) e ricarica il FIR', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.firmaInAttesa.and.returnValue(of({ sessione }))
      rentriFirLifecycleService.riprendiFirma.and.returnValue(
        of({ esito: 'COMPLETATA', statoFormulario: 'InViaggio' })
      )
      fixture.detectChanges()

      component.riprendiFirma(firLegato, sessione, false)

      expect(rentriFirLifecycleService.riprendiFirma).toHaveBeenCalledOnceWith(
        'fir-1',
        'sess-1',
        {}
      )
      expect(firService.getFIRById).toHaveBeenCalledTimes(2)
    })

    it('«Richiedi di nuovo la firma» invia nuovaSessione: true', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.firmaInAttesa.and.returnValue(of({ sessione }))
      rentriFirLifecycleService.riprendiFirma.and.returnValue(
        of({ esito: 'IN_ATTESA', handle: 'h', scadenzaAutorizzazione: scadenzaFutura })
      )
      fixture.detectChanges()

      component.riprendiFirma(firLegato, sessione, true)

      expect(rentriFirLifecycleService.riprendiFirma).toHaveBeenCalledOnceWith('fir-1', 'sess-1', {
        nuovaSessione: true,
      })
    })

    it('«Annulla la richiesta» chiede conferma e poi fa il reset', () => {
      setup({ role: 'OPERATOR', autoConfirm: true })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.firmaInAttesa.and.returnValue(of({ sessione }))
      rentriFirLifecycleService.resetStato.and.returnValue(
        of({ operazione: 'Reset', statoFormulario: 'InserimentoAccettazione' })
      )
      fixture.detectChanges()

      component.annullaRichiestaFirma(firLegato)

      expect(rentriFirLifecycleService.resetStato).toHaveBeenCalledOnceWith('fir-1')
    })
  })

  describe('Quantità e dati di trasporto (FIR in viaggio P2)', () => {
    const firLegato: FIR = {
      ...baseFIR,
      rentriSyncStatus: 'SYNCED',
      rentriNumeroFir: 'RENTRI-000777',
      tipoTrattaPrincipale: 'TERRESTRE',
      rifiuto: { cerCode: '150101', quantita: 42, unitaMisura: 'kg', numeroColli: 3 },
    }

    const azioni = (...operazioni: string[]) =>
      of({
        stato: 'InserimentoQuantitaTrasportoIniziale',
        versione: 1,
        azioni: operazioni.map(operazione => ({ operazione, verbo: operazione })),
      })

    const el = (): HTMLElement => fixture.nativeElement

    it("i pulsanti nascono SOLO dalle azioni dell'ente", () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        azioni('DatiQuantita', 'Trasporto')
      )
      fixture.detectChanges()
      expect(el().querySelector('[data-testid="fir-detail-rentri-indica-quantita"]')).toBeTruthy()
      expect(el().querySelector('[data-testid="fir-detail-rentri-indica-trasporto"]')).toBeTruthy()
      expect(component.etichettaQuantita()).toBe('Indica la quantità')
      expect(component.etichettaTrasporto()).toBe('Indica i dati del trasporto')
    })

    it('le operazioni di correzione cambiano il verbo', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        azioni('DatiQuantitaUpdate', 'TrasportoUpdate')
      )
      fixture.detectChanges()
      expect(component.etichettaQuantita()).toBe('Correggi la quantità')
      expect(component.etichettaTrasporto()).toBe('Correggi i dati del trasporto')
    })

    it("senza quantità o trasporto fra le azioni dell'ente i pulsanti non compaiono", () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(azioni('Annulla'))
      fixture.detectChanges()
      expect(el().querySelector('[data-testid="fir-detail-rentri-indica-quantita"]')).toBeFalsy()
      expect(el().querySelector('[data-testid="fir-detail-rentri-indica-trasporto"]')).toBeFalsy()
    })

    it('un FIR non terrestre non offre i dati di trasporto (WasteFlow modella solo il terrestre)', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(
        of({ ...firLegato, tipoTrattaPrincipale: 'FERROVIARIA' })
      )
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        azioni('DatiQuantita', 'Trasporto')
      )
      fixture.detectChanges()
      expect(el().querySelector('[data-testid="fir-detail-rentri-indica-quantita"]')).toBeTruthy()
      expect(el().querySelector('[data-testid="fir-detail-rentri-indica-trasporto"]')).toBeFalsy()
    })

    it('un VIEWER non vede i pulsanti', () => {
      setup({ role: 'VIEWER' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(
        azioni('DatiQuantita', 'Trasporto')
      )
      fixture.detectChanges()
      expect(el().querySelector('[data-testid="fir-detail-rentri-indica-quantita"]')).toBeFalsy()
    })

    it('il dialog della quantità si precompila dal FIR e non invia senza colli né rinfusa', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(azioni('DatiQuantita'))
      fixture.detectChanges()

      component.apriDialogQuantita(firLegato)
      expect(component['qtaValore']).toBe(42)
      expect(component['qtaColli']).toBe(3)
      expect(component.quantitaValida()).toBeTrue()

      component['qtaColli'] = null
      expect(component.quantitaValida()).toBeFalse()
      component['qtaRinfusa'] = true
      expect(component.quantitaValida()).toBeTrue()
      component['qtaValore'] = 0
      expect(component.quantitaValida()).toBeFalse()
    })

    it('conferma la quantità: invia, avvisa e ricarica; alla rinfusa i colli non partono', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(azioni('DatiQuantita'))
      rentriFirLifecycleService.inviaQuantita.and.returnValue(
        of({ operazione: 'DatiQuantita', statoFormulario: 'InserimentoTrasportoIniziale' })
      )
      fixture.detectChanges()

      component.apriDialogQuantita(firLegato)
      component['qtaRinfusa'] = true
      component['qtaVerificato'] = true
      component.confermaQuantita()

      expect(rentriFirLifecycleService.inviaQuantita).toHaveBeenCalledOnceWith('fir-1', {
        quantita: 42,
        unitaMisura: 'kg',
        numeroColli: undefined,
        rinfusa: true,
        verificatoInPartenza: true,
      })
      expect(component['quantitaDialogVisible']()).toBeFalse()
      // ricaricato: il FIR e le azioni si rileggono dopo l'invio
      expect(firService.getFIRById).toHaveBeenCalledTimes(2)
    })

    it("M9: con copiaLocaleAggiornata false l'avviso è un warning che dice cosa fare", () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(azioni('DatiQuantita'))
      rentriFirLifecycleService.inviaQuantita.and.returnValue(
        of({ operazione: 'DatiQuantita', statoFormulario: null, copiaLocaleAggiornata: false })
      )
      fixture.detectChanges()
      const add = spyOn(component['messageService'], 'add')
      component.apriDialogQuantita(firLegato)
      component.confermaQuantita()
      const msg = add.calls.mostRecent().args[0]
      expect(msg.severity).toBe('warn')
      expect(msg.detail).toContain('ripeti')
    })

    it("rifiuto dell'ente sulla quantità: il messaggio resta nel dialog, che non si chiude", () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(azioni('DatiQuantita'))
      rentriFirLifecycleService.inviaQuantita.and.returnValue(
        throwError(() => ({ error: { message: "L'ente ha rifiutato la quantità." } }))
      )
      fixture.detectChanges()

      component.apriDialogQuantita(firLegato)
      component.confermaQuantita()

      expect(component['quantitaErrore']()).toBe("L'ente ha rifiutato la quantità.")
      expect(component['quantitaDialogVisible']()).toBeTrue()
      expect(component['quantitaInCorso']()).toBeFalse()
    })

    it('trasporto: conducente (nome e cognome) e almeno una targa, altrimenti niente invio', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(azioni('Trasporto'))
      fixture.detectChanges()

      component.apriDialogTrasporto(firLegato)
      expect(component.trasportoValido()).toBeFalse()
      component['trpNome'] = 'Mario'
      component['trpCognome'] = 'De Rossi'
      expect(component.trasportoValido()).toBeFalse()
      component['trpTargaRimorchio'] = 'XY987ZW'
      expect(component.trasportoValido()).toBeTrue()
      component['trpCognome'] = '  '
      expect(component.trasportoValido()).toBeFalse()
    })

    it('conferma il trasporto: campi ripuliti, vuoti omessi, inizio in ISO UTC solo se indicato', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(azioni('Trasporto'))
      rentriFirLifecycleService.inviaTrasporto.and.returnValue(
        of({ operazione: 'Trasporto', statoFormulario: 'FirmaProduttoreTrasportatoreIniziale' })
      )
      fixture.detectChanges()

      component.apriDialogTrasporto(firLegato)
      component['trpNome'] = ' Mario '
      component['trpCognome'] = 'De Rossi'
      component['trpTargaAutomezzo'] = 'AB123CD'
      component.confermaTrasporto()

      expect(rentriFirLifecycleService.inviaTrasporto).toHaveBeenCalledOnceWith('fir-1', {
        conducenteNome: 'Mario',
        conducenteCognome: 'De Rossi',
        targaAutomezzo: 'AB123CD',
        targaRimorchio: undefined,
        percorso: undefined,
        dataOraInizioTrasporto: undefined,
      })
      expect(component['trasportoDialogVisible']()).toBeFalse()
    })

    it("la targa precompila conducente e rimorchio dall'ultimo trasporto, solo a campi vuoti", () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(azioni('Trasporto'))
      rentriFirLifecycleService.ultimoTrasporto.and.returnValue(
        of({
          trasporto: {
            conducenteNome: 'Luigi',
            conducenteCognome: 'Verdi',
            targaRimorchio: 'ZZ111ZZ',
          },
        })
      )
      fixture.detectChanges()

      component.apriDialogTrasporto(firLegato)
      component['trpTargaAutomezzo'] = 'AB123CD'
      component.precompilaTrasportoDaTarga()
      expect(component['trpNome']).toBe('Luigi')
      expect(component['trpCognome']).toBe('Verdi')
      expect(component['trpTargaRimorchio']).toBe('ZZ111ZZ')

      // Cio' che l'utente ha scritto non si sovrascrive mai.
      rentriFirLifecycleService.ultimoTrasporto.calls.reset()
      component['trpNome'] = 'Mario'
      component.precompilaTrasportoDaTarga()
      expect(rentriFirLifecycleService.ultimoTrasporto).not.toHaveBeenCalled()
    })

    it('lo storico mostra le operazioni inviate, con esito e stato', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.eventi.and.returnValue(
        of({
          eventi: [
            {
              id: 'e1',
              operazione: 'DatiQuantita',
              esito: 'ACCETTATA',
              dettaglioEnte: null,
              statoFormularioDopo: 'InserimentoTrasportoIniziale',
              utenteId: 'u1',
              createdAt: '2026-11-21T10:00:00Z',
            },
            {
              id: 'e2',
              operazione: 'Trasporto',
              esito: 'RIFIUTATA',
              dettaglioEnte: '[]',
              statoFormularioDopo: null,
              utenteId: 'u1',
              createdAt: '2026-11-21T10:05:00Z',
            },
          ],
        })
      )
      fixture.detectChanges()

      const storico = el().querySelector('[data-testid="fir-detail-storico-viaggio"]')
      expect(storico?.textContent).toContain('Quantità indicata')
      expect(storico?.textContent).toContain("Accettata dall'ente")
      expect(storico?.textContent).toContain('Dati di trasporto indicati')
      expect(storico?.textContent).toContain("Rifiutata dall'ente")
      expect(storico?.textContent).toContain('Stato: InserimentoTrasportoIniziale')
    })

    it('C1: il dichiarato a RENTRI si mostra accanto al firmato e prefilla i dialog', () => {
      setup({ role: 'OPERATOR' })
      const f: FIR = {
        ...firLegato,
        datiViaggio: {
          verificatoInPartenza: null,
          rinfusa: null,
          conducenteNome: null,
          conducenteCognome: null,
          targaRimorchio: null,
          percorso: null,
          dichiarato: {
            quantita: { valore: 1500, unitaMisura: 'kg', numeroColli: 6 },
            trasporto: { targaAutomezzo: 'AB123CD' },
          },
        },
      }
      firService.getFIRById.and.returnValue(of(f))
      fixture.detectChanges()
      expect(
        el().querySelector('[data-testid="fir-detail-dichiarato-quantita"]')?.textContent
      ).toContain('1500 kg · 6 colli')
      expect(
        el().querySelector('[data-testid="fir-detail-dichiarato-trasporto"]')?.textContent
      ).toContain('AB123CD')
      // il firmato resta quello emesso (42 kg)
      expect(el().textContent).toContain('42')
      component.apriDialogQuantita(f)
      expect(component['qtaValore']).toBe(1500)
      expect(component['qtaColli']).toBe(6)
      component.apriDialogTrasporto(f)
      expect(component['trpTargaAutomezzo']).toBe('AB123CD')
    })

    it('uno storico vuoto lo dice', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      fixture.detectChanges()
      expect(el().querySelector('[data-testid="fir-detail-storico-vuoto"]')).toBeTruthy()
    })

    it('per un FIR non legato lo storico non si carica', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of({ ...baseFIR, rentriNumeroFir: null }))
      fixture.detectChanges()
      expect(rentriFirLifecycleService.eventi).not.toHaveBeenCalled()
      expect(el().querySelector('[data-testid="fir-detail-storico-viaggio"]')).toBeFalsy()
    })
  })
  describe('Firme di partenza su RENTRI (FIR in viaggio P3)', () => {
    const firLegato: FIR = {
      ...baseFIR,
      rentriSyncStatus: 'SYNCED',
      rentriNumeroFir: 'RENTRI-000777',
    }
    const azioni = (...operazioni: string[]) =>
      of({
        stato: 'FirmaProduttoreTrasportatoreIniziale',
        versione: 1,
        azioni: operazioni.map(operazione => ({ operazione, verbo: operazione })),
      })
    const el = (): HTMLElement => fixture.nativeElement
    const BANNER = '[data-testid="fir-detail-firma-partenza-banner"]'
    const PULSANTE = '[data-testid="fir-detail-firma-partenza"]'
    let messageService: MessageService

    function preparaFirLegato(...operazioni: string[]): void {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(firLegato))
      rentriFirLifecycleService.azioniDisponibili.and.returnValue(azioni(...operazioni))
      messageService = fixture.debugElement.injector.get(MessageService)
    }

    it("il pulsante e il banner nascono SOLO dalle firme di partenza proposte dall'ente", () => {
      preparaFirLegato('AcquisizioneFirmaProduttoreTrasportatore')
      fixture.detectChanges()

      expect(el().querySelector(BANNER)?.textContent).toContain('Firma RENTRI da completare')
      expect(el().querySelector(PULSANTE)).toBeTruthy()
    })

    it('anche la firma del solo produttore o del solo trasportatore la fa comparire', () => {
      preparaFirLegato('AcquisizioneFirmaTrasportatore')
      fixture.detectChanges()
      expect(el().querySelector(PULSANTE)).toBeTruthy()
    })

    it('senza firma di partenza fra le azioni (mancano quantità o trasporto) non compare, nemmeno con stato locale EMESSO', () => {
      preparaFirLegato('DatiQuantita', 'Annulla')
      fixture.detectChanges()
      expect(el().querySelector(BANNER)).toBeFalsy()
      expect(el().querySelector(PULSANTE)).toBeFalsy()
    })

    it('la firma di accettazione non e una firma di partenza', () => {
      preparaFirLegato('AcquisizioneFirmaDestinatario')
      fixture.detectChanges()
      expect(el().querySelector(PULSANTE)).toBeFalsy()
    })

    it('un FIR non legato (flusso cartaceo) non la propone mai', () => {
      setup({ role: 'OPERATOR' })
      firService.getFIRById.and.returnValue(of(baseFIR))
      fixture.detectChanges()
      expect(el().querySelector(PULSANTE)).toBeFalsy()
      expect(rentriFirLifecycleService.azioniDisponibili).not.toHaveBeenCalled()
    })

    it('un VIEWER non la vede', () => {
      setup({ role: 'VIEWER' })
      firService.getFIRById.and.returnValue(of(firLegato))
      fixture.detectChanges()
      expect(el().querySelector(PULSANTE)).toBeFalsy()
    })

    it('con una richiesta di firma gia in attesa resta il solo banner con «Ho confermato» (nessuna seconda richiesta)', () => {
      preparaFirLegato('AcquisizioneFirmaProduttoreTrasportatore')
      rentriFirLifecycleService.firmaInAttesa.and.returnValue(
        of({
          sessione: {
            id: 's1',
            tipoOperazione: 'PARTENZA',
            scadenza: new Date(Date.now() + 90_000).toISOString(),
            stato: 'IN_ATTESA' as const,
            scaduta: false,
          },
        })
      )
      fixture.detectChanges()

      expect(el().querySelector(PULSANTE)).toBeFalsy()
      expect(el().querySelector('[data-testid="fir-detail-firma-riprendi"]')).toBeTruthy()
    })

    it('«Firma la partenza»: chiama la rotta, mostra l esito e ricarica', () => {
      preparaFirLegato('AcquisizioneFirmaProduttoreTrasportatore')
      rentriFirLifecycleService.firmaPartenza.and.returnValue(
        of({
          operazione: 'AcquisizioneFirmaProduttoreTrasportatore' as const,
          firma: { esito: 'COMPLETATA' as const, statoFormulario: 'InserimentoAccettazione' },
        })
      )
      fixture.detectChanges()
      const aggiungi = spyOn(messageService, 'add')

      ;(el().querySelector(PULSANTE) as HTMLElement).querySelector('button')?.click()

      expect(rentriFirLifecycleService.firmaPartenza).toHaveBeenCalledOnceWith('fir-1')
      expect(aggiungi).toHaveBeenCalledWith(
        jasmine.objectContaining({ severity: 'success', summary: 'Firma completata' })
      )
      expect(firService.getFIRById).toHaveBeenCalledTimes(2)
    })

    it('«Firma la partenza»: errore 409 dal backend mostra il messaggio e non lascia il pulsante in caricamento', () => {
      preparaFirLegato('AcquisizioneFirmaProduttoreTrasportatore')
      rentriFirLifecycleService.firmaPartenza.and.returnValue(
        throwError(() => ({ status: 409, error: { message: 'Firma già in corso' } }))
      )
      fixture.detectChanges()
      const aggiungi = spyOn(messageService, 'add')

      component.firmaPartenza(firLegato)

      expect(aggiungi).toHaveBeenCalledWith(
        jasmine.objectContaining({ severity: 'error', detail: 'Firma già in corso' })
      )
      expect(component['firmaInCorso']()).toBeFalse()
    })

    describe('«Emetti» e «Presa in carico» propongono la firma', () => {
      const bozza: FIR = { ...baseFIR, stato: FIRStato.BOZZA }

      it('Emetti chiede anche la firma RENTRI e, se riesce, lo dice', () => {
        setup({ role: 'OPERATOR' })
        firService.getFIRById.and.returnValue(of(bozza))
        firService.emettiFIR.and.returnValue(
          of({
            ...firLegato,
            firmaRentri: { stato: 'COMPLETATA', statoFormulario: 'InserimentoAccettazione' },
          })
        )
        fixture.detectChanges()
        const aggiungi = spyOn(fixture.debugElement.injector.get(MessageService), 'add')

        component.emettiFIR(bozza)

        expect(firService.emettiFIR).toHaveBeenCalledOnceWith('fir-1', { firmaRentri: true })
        expect(aggiungi).toHaveBeenCalledWith(
          jasmine.objectContaining({ summary: 'FIR emesso', severity: 'success' })
        )
        expect(aggiungi).toHaveBeenCalledWith(
          jasmine.objectContaining({ summary: 'Partenza firmata su RENTRI' })
        )
      })

      it('Emetti riuscito ma firma RENTRI fallita: il FIR resta emesso e compare l avviso «Firma RENTRI da completare»', () => {
        setup({ role: 'OPERATOR' })
        firService.getFIRById.and.returnValue(of(bozza))
        const emesso = {
          ...firLegato,
          firmaRentri: {
            stato: 'DA_COMPLETARE' as const,
            avviso: 'Firma RENTRI da completare: riprova.',
          },
        }
        firService.emettiFIR.and.returnValue(of(emesso))
        fixture.detectChanges()
        const aggiungi = spyOn(fixture.debugElement.injector.get(MessageService), 'add')

        component.emettiFIR(bozza)

        expect(component['fir']()).toEqual(emesso)
        expect(aggiungi).toHaveBeenCalledWith(
          jasmine.objectContaining({ summary: 'FIR emesso', severity: 'success' })
        )
        expect(aggiungi).toHaveBeenCalledWith(
          jasmine.objectContaining({
            summary: 'Firma RENTRI da completare',
            severity: 'warn',
            detail: 'Firma RENTRI da completare: riprova.',
          })
        )
      })

      it('Emetti su FIR non legato (flusso cartaceo): nessun messaggio sulla firma RENTRI', () => {
        setup({ role: 'OPERATOR' })
        firService.getFIRById.and.returnValue(of(bozza))
        firService.emettiFIR.and.returnValue(of({ ...baseFIR, stato: FIRStato.EMESSO }))
        fixture.detectChanges()
        const aggiungi = spyOn(fixture.debugElement.injector.get(MessageService), 'add')

        component.emettiFIR(bozza)

        expect(aggiungi).toHaveBeenCalledTimes(1)
      })

      it('Presa in carico su FIR legato: la firma e in attesa del telefono, messaggio dedicato', () => {
        setup({ role: 'OPERATOR' })
        firService.getFIRById.and.returnValue(of(firLegato))
        firService.presaInCarico.and.returnValue(
          of({
            ...firLegato,
            firmaRentri: {
              stato: 'IN_ATTESA',
              sessioneId: 's1',
              scadenza: new Date().toISOString(),
            },
          })
        )
        fixture.detectChanges()
        const aggiungi = spyOn(fixture.debugElement.injector.get(MessageService), 'add')

        component.presaInCarico(firLegato)

        expect(aggiungi).toHaveBeenCalledTimes(1)
        expect(aggiungi).toHaveBeenCalledWith(
          jasmine.objectContaining({ summary: 'Conferma la firma sul telefono' })
        )
      })

      it('Presa in carico su FIR non legato: messaggio locale di sempre (non regressione)', () => {
        setup({ role: 'OPERATOR' })
        firService.getFIRById.and.returnValue(of(baseFIR))
        firService.presaInCarico.and.returnValue(of({ ...baseFIR, stato: FIRStato.IN_TRANSITO }))
        fixture.detectChanges()
        const aggiungi = spyOn(fixture.debugElement.injector.get(MessageService), 'add')

        component.presaInCarico(baseFIR)

        expect(aggiungi).toHaveBeenCalledOnceWith(
          jasmine.objectContaining({ summary: 'Presa in carico registrata' })
        )
      })
    })
  })
})
