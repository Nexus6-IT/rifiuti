import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing'
// Il dialog di PrimeNG dichiara animazioni: senza un modulo che le gestisca,
// qualunque test che lo renda DAVVERO nel DOM fallisce con NG05105 prima ancora
// di poter verificare alcunche'. `Noop` e non `BrowserAnimations` perche' in un
// test non serve animare — serve solo che l'animazione non sia un errore.
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { ActivatedRoute, convertToParamMap } from '@angular/router'
import { of, throwError } from 'rxjs'
import { FirDetailComponent } from './fir-detail.component'
import { FirService } from './fir.service'
import { AuthService } from '../../core/services/auth.service'
import { RENTRISyncService } from './services/rentri-sync.service'
import { RentriFormulariService } from '../rentri/rentri-formulari.service'
import { RentriFirLifecycleService } from '../rentri/rentri-fir-lifecycle.service'
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
    rentriFirLifecycleService = jasmine.createSpyObj('RentriFirLifecycleService', [
      'azioniDisponibili',
      'accettaORespingi',
      'annullaFIR',
      'elencaAllegati',
      'caricaAllegato',
      'eliminaAllegato',
    ])
    rentriFirLifecycleService.elencaAllegati.and.returnValue(of([]))
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
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-accetta-carico"]')).toBeTruthy()
    })

    it('NON mostra "Accetta il carico" per un FIR non legato a RENTRI', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of({ ...baseFIR, rentriNumeroFir: null }))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-accetta-carico"]')).toBeFalsy()
    })

    it('NON mostra "Accetta il carico" per un VIEWER', () => {
      setup({ role: 'VIEWER' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-accetta-carico"]')).toBeFalsy()
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
      fixture.detectChanges()

      const el: HTMLElement = fixture.nativeElement
      expect(el.querySelector('[data-testid="fir-detail-rentri-annulla-formulario"]')).toBeTruthy()
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
      component.apriDialogAnnullamento(firLegatoRentri)

      expect(component['annullamentoDialogVisible']()).toBeTrue()
      expect(component['annullamentoMotivo']).toBe('')
    })

    it('NON valida con un motivo vuoto', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAnnullamento(firLegatoRentri)
      component['annullamentoMotivo'] = '   '

      expect(component.annullamentoValido()).toBeFalse()
    })

    it('NON valida con un motivo oltre 1024 caratteri', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAnnullamento(firLegatoRentri)
      component['annullamentoMotivo'] = 'x'.repeat(1025)

      expect(component.annullamentoValido()).toBeFalse()
    })

    it('valida con un motivo non vuoto entro 1024 caratteri', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAnnullamento(firLegatoRentri)
      component['annullamentoMotivo'] = 'errore di pesatura alla partenza'

      expect(component.annullamentoValido()).toBeTrue()
    })

    it('il pulsante di conferma nel DOM è disabilitato con motivo vuoto', () => {
      setup({ role: 'ADMIN' })
      firService.getFIRById.and.returnValue(of(firLegatoRentri))
      fixture.detectChanges()

      component.apriDialogAnnullamento(firLegatoRentri)
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

      component.apriDialogAnnullamento(firLegatoRentri)
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

      component.apriDialogAnnullamento(firLegatoRentri)
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

      component.apriDialogAnnullamento(firLegatoRentri)
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

      component.apriDialogAnnullamento(firLegatoRentri)
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
})
