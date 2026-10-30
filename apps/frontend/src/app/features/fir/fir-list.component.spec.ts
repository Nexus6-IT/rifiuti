import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { provideRouter, ActivatedRoute, Router, convertToParamMap } from '@angular/router'
import { of, throwError } from 'rxjs'
import { FirListComponent } from './fir-list.component'
import { FirService } from './fir.service'
import { FIR, FIRStato } from '../../shared/models/fir.model'
import { RegistryService } from '../registry/registry.service'
import { ExportService } from '../../core/services/export.service'
import { RENTRISyncService } from './services/rentri-sync.service'
import { AuthService } from '../../core/services/auth.service'
import { MessageService, ConfirmationService } from 'primeng/api'
import { RentriBlocchiService } from '../rentri/rentri-blocchi.service'

/**
 * TDD per i due nuovi campi obbligatori RENTRI nel form "Nuovo FIR":
 * provenienza del rifiuto (URBANO/SPECIALE) e modalità di trasporto
 * della tratta principale (TERRESTRE/FERROVIARIA/MARITTIMA). Senza
 * questi due dati il contratto RENTRI rifiuta la trasmissione, quindi
 * devono bloccare la creazione lato form, non solo lato backend.
 */
describe('FirListComponent — campi RENTRI obbligatori (provenienza, tratta principale)', () => {
  let fixture: ComponentFixture<FirListComponent>
  let component: FirListComponent
  let firService: jasmine.SpyObj<FirService>
  let registryService: jasmine.SpyObj<RegistryService>

  beforeEach(() => {
    firService = jasmine.createSpyObj('FirService', [
      'getFIRList',
      'createFIR',
      'emettiFIR',
      'presaInCarico',
      'confermaConsegna',
      'annullaFIR',
    ])
    firService.getFIRList.and.returnValue(of({ items: [], total: 0 }) as any)
    firService.createFIR.and.returnValue(of({}) as any)

    registryService = jasmine.createSpyObj('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
    ])
    registryService.getProduttori.and.returnValue(of({ items: [], total: 0 }) as any)
    registryService.getTrasportatori.and.returnValue(of({ items: [], total: 0 }) as any)
    registryService.getDestinatari.and.returnValue(of({ items: [], total: 0 }) as any)

    const authServiceStub = {
      currentUser: () => ({ id: 'u1', email: 'u@example.com', role: 'ADMIN' }),
    }

    TestBed.configureTestingModule({
      imports: [FirListComponent, NoopAnimationsModule, HttpClientTestingModule],
      providers: [
        { provide: FirService, useValue: firService },
        { provide: RegistryService, useValue: registryService },
        { provide: AuthService, useValue: authServiceStub },
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
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  function compilaCampiBaseObbligatori(): void {
    component.newFIR.produttoreId = 'p1'
    component.newFIR.trasportatoreId = 't1'
    component.newFIR.destinatarioId = 'd1'
    component.newFIR.rifiuto.cerCode = '150101'
    component.newFIR.rifiuto.quantita = 10
  }

  it('non crea il FIR se manca la provenienza del rifiuto', () => {
    compilaCampiBaseObbligatori()
    component.newFIR.tipoTrattaPrincipale = 'TERRESTRE'
    // provenienza non impostata

    component.createFIR()

    expect(firService.createFIR).not.toHaveBeenCalled()
    expect(component.firErrors['provenienza']).toBeTruthy()
  })

  it('non crea il FIR se manca la modalità di trasporto della tratta principale', () => {
    compilaCampiBaseObbligatori()
    component.newFIR.provenienza = 'URBANO'
    // tipoTrattaPrincipale non impostato

    component.createFIR()

    expect(firService.createFIR).not.toHaveBeenCalled()
    expect(component.firErrors['tipoTrattaPrincipale']).toBeTruthy()
  })

  it('crea il FIR quando anche provenienza e tratta principale sono valorizzate', () => {
    compilaCampiBaseObbligatori()
    component.newFIR.provenienza = 'SPECIALE'
    component.newFIR.tipoTrattaPrincipale = 'FERROVIARIA'

    component.createFIR()

    expect(firService.createFIR).toHaveBeenCalled()
    const dto = firService.createFIR.calls.mostRecent().args[0]
    expect(dto.provenienza).toBe('SPECIALE')
    expect(dto.tipoTrattaPrincipale).toBe('FERROVIARIA')
  })

  it('non propone più "Gassoso" e "Misto" fra le opzioni di stato fisico', () => {
    const valori = component.statoFisicoOptions.map(o => o.value)
    expect(valori).not.toContain('Gassoso')
    expect(valori).not.toContain('Misto')
    expect(valori).toEqual(['Solido', 'Liquido', 'Fangoso', 'Polvere'])
  })
})

/**
 * L'avviso "PRIMA della compilazione" (GET /rentri/emissione-possibile) è
 * stato tolto dal dialogo "Nuovo FIR" (revisione finale del ramo
 * feat/scadenzario-cruscotto, R6): `ConsumaNumeroVidimatoUseCase` non ha
 * ancora alcun chiamante (l'emissione FIR reale non consuma dalla scorta),
 * quindi il controllo restituiva un falso allarme ad OGNI apertura del
 * dialogo per qualunque tenant senza R6 configurato — cioè tutti, oggi.
 * L'endpoint e lo use case restano (v. `verifica-emissione-possibile.use-case.ts`):
 * il banner tornerà quando il consumo sarà ricablato in `EmettiFIRUseCase`.
 */
describe('FirListComponent — nessun avviso emissione-possibile nel dialogo "Nuovo FIR"', () => {
  let fixture: ComponentFixture<FirListComponent>
  let component: FirListComponent
  let rentriBlocchiService: jasmine.SpyObj<RentriBlocchiService>

  beforeEach(() => {
    const firService = jasmine.createSpyObj('FirService', [
      'getFIRList',
      'createFIR',
      'emettiFIR',
      'presaInCarico',
      'confermaConsegna',
      'annullaFIR',
    ])
    firService.getFIRList.and.returnValue(of({ items: [], total: 0 }))
    firService.createFIR.and.returnValue(of({}))

    const registryService = jasmine.createSpyObj('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
    ])
    registryService.getProduttori.and.returnValue(of({ items: [], total: 0 }))
    registryService.getTrasportatori.and.returnValue(of({ items: [], total: 0 }))
    registryService.getDestinatari.and.returnValue(of({ items: [], total: 0 }))

    rentriBlocchiService = jasmine.createSpyObj<RentriBlocchiService>('RentriBlocchiService', [
      'emissionePossibile',
    ])

    const authServiceStub = {
      currentUser: () => ({ id: 'u1', email: 'u@example.com', role: 'ADMIN' }),
    }

    TestBed.configureTestingModule({
      imports: [FirListComponent, NoopAnimationsModule, HttpClientTestingModule],
      providers: [
        { provide: FirService, useValue: firService },
        { provide: RegistryService, useValue: registryService },
        { provide: AuthService, useValue: authServiceStub },
        { provide: RentriBlocchiService, useValue: rentriBlocchiService },
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
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('non interroga più emissione-possibile quando si apre il dialogo "Nuovo FIR"', () => {
    component.showCreateDialog()

    expect(rentriBlocchiService.emissionePossibile).not.toHaveBeenCalled()
  })

  it('non mostra mai il banner di emissione non possibile, anche se il dialogo è aperto', () => {
    component.showCreateDialog()
    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="fir-create-emissione-non-possibile"]')).toBeNull()
  })
})

/**
 * TDD Task 4 dello scadenzario: avvisare SUBITO quando l'operatore SCEGLIE
 * un trasportatore/destinatario con iscrizione/autorizzazione scaduta — non
 * scoprirlo al salvataggio del formulario già compilato come i concorrenti.
 *
 * Regola del piano da rispettare alla lettera: si AVVISA, non si IMPEDISCE.
 * La scadenza potrebbe essere un dato nostro non aggiornato: bloccare
 * l'emissione per un dato nostro sbagliato sarebbe peggio del problema che
 * si vuole risolvere.
 */
describe('FirListComponent — avviso di scadenza alla scelta della controparte', () => {
  let fixture: ComponentFixture<FirListComponent>
  let component: FirListComponent
  let firService: jasmine.SpyObj<FirService>

  const trasportatoreScaduto = {
    id: 't-scaduto',
    ragioneSociale: 'Trasporti Scaduti SRL',
    partitaIVA: '12345678903',
    sedeLegale: { via: 'Via Roma', civico: '1', cap: '00100', comune: 'Roma', provincia: 'RM' },
    numeroIscrizione: 'AL999',
    scadenzaIscrizione: '2020-01-01',
    iscrizioneScaduta: true,
    giorniAllaScadenza: -400,
    createdAt: '2020-01-01',
    updatedAt: '2020-01-01',
  }

  const destinatarioScaduto = {
    id: 'd-scaduto',
    ragioneSociale: 'Impianto Scaduto SRL',
    partitaIVA: '98765432109',
    sede: { via: 'Via Milano', civico: '2', cap: '20100', comune: 'Milano', provincia: 'MI' },
    numeroAutorizzazione: 'AUT-1',
    scadenzaAutorizzazione: '2020-01-01',
    autorizzazioneScaduta: true,
    giorniAllaScadenza: -400,
    createdAt: '2020-01-01',
    updatedAt: '2020-01-01',
  }

  const destinatarioOk = {
    id: 'd-ok',
    ragioneSociale: 'Impianto Regolare SRL',
    partitaIVA: '11122233344',
    sede: { via: 'Via Napoli', civico: '3', cap: '80100', comune: 'Napoli', provincia: 'NA' },
    numeroAutorizzazione: 'AUT-2',
    scadenzaAutorizzazione: '2099-01-01',
    autorizzazioneScaduta: false,
    giorniAllaScadenza: 9000,
    createdAt: '2020-01-01',
    updatedAt: '2020-01-01',
  }

  const destinatarioSenzaScadenza = {
    id: 'd-senza-dato',
    ragioneSociale: 'Impianto Senza Dato SRL',
    partitaIVA: '55566677788',
    sede: { via: 'Via Torino', civico: '4', cap: '10100', comune: 'Torino', provincia: 'TO' },
    numeroAutorizzazione: 'AUT-3',
    // scadenzaAutorizzazione assente: anagrafica non aggiornata, non va
    // trattata come scaduta né come "non scade mai".
    autorizzazioneScaduta: false,
    giorniAllaScadenza: null,
    createdAt: '2020-01-01',
    updatedAt: '2020-01-01',
  }

  beforeEach(() => {
    firService = jasmine.createSpyObj('FirService', [
      'getFIRList',
      'createFIR',
      'emettiFIR',
      'presaInCarico',
      'confermaConsegna',
      'annullaFIR',
    ])
    firService.getFIRList.and.returnValue(of({ items: [], total: 0 }) as any)
    firService.createFIR.and.returnValue(of({}) as any)

    const registryService = jasmine.createSpyObj('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
    ])
    registryService.getProduttori.and.returnValue(of({ items: [], total: 0 }))
    registryService.getTrasportatori.and.returnValue(
      of({ items: [trasportatoreScaduto], total: 1 })
    )
    registryService.getDestinatari.and.returnValue(
      of({
        items: [destinatarioScaduto, destinatarioOk, destinatarioSenzaScadenza],
        total: 3,
      })
    )

    const authServiceStub = {
      currentUser: () => ({ id: 'u1', email: 'u@example.com', role: 'ADMIN' }),
    }

    TestBed.configureTestingModule({
      imports: [FirListComponent, NoopAnimationsModule, HttpClientTestingModule],
      providers: [
        { provide: FirService, useValue: firService },
        { provide: RegistryService, useValue: registryService },
        { provide: AuthService, useValue: authServiceStub },
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
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('mostra un avviso inline scegliendo un trasportatore con iscrizione scaduta', () => {
    component.showCreateDialog()
    component.newFIR.trasportatoreId = trasportatoreScaduto.id
    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    const avviso = html.querySelector('[data-testid="fir-trasportatore-iscrizione-scaduta"]')
    expect(avviso).not.toBeNull()
  })

  it('mostra un avviso inline scegliendo un destinatario con autorizzazione scaduta', () => {
    component.showCreateDialog()
    component.newFIR.destinatarioId = destinatarioScaduto.id
    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    const avviso = html.querySelector('[data-testid="fir-destinatario-autorizzazione-scaduta"]')
    expect(avviso).not.toBeNull()
  })

  it('non mostra alcun avviso per un destinatario con autorizzazione in regola', () => {
    component.showCreateDialog()
    component.newFIR.destinatarioId = destinatarioOk.id
    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="fir-destinatario-autorizzazione-scaduta"]')).toBeNull()
  })

  it('non mostra alcun avviso quando la scadenza non è nota (dato assente, non va inventato uno stato)', () => {
    component.showCreateDialog()
    component.newFIR.destinatarioId = destinatarioSenzaScadenza.id
    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="fir-destinatario-autorizzazione-scaduta"]')).toBeNull()
  })

  it('NON blocca la creazione del FIR: si avvisa, non si impedisce', () => {
    component.newFIR.produttoreId = 'p1'
    component.newFIR.trasportatoreId = trasportatoreScaduto.id
    component.newFIR.destinatarioId = destinatarioScaduto.id
    component.newFIR.rifiuto.cerCode = '150101'
    component.newFIR.rifiuto.quantita = 10
    component.newFIR.provenienza = 'URBANO'
    component.newFIR.tipoTrattaPrincipale = 'TERRESTRE'
    fixture.detectChanges()

    component.createFIR()

    expect(firService.createFIR).toHaveBeenCalled()
  })
})

/**
 * F2-7: la quantità verificata a destino non è più bloccata dalla tolleranza ±10%. Oltre soglia il
 * dialog avvisa (role="status") ma Conferma resta attivo; dopo il successo, se il backend
 * restituisce uno scostamento oltre soglia, il toast è di tipo "warn".
 */
describe('FirListComponent — dialog di consegna, quantità verificata e scostamento (F2-7)', () => {
  let fixture: ComponentFixture<FirListComponent>
  let component: FirListComponent
  let firService: jasmine.SpyObj<FirService>
  let messageService: MessageService

  const firInTransito = {
    id: 'fir-1',
    stato: 'IN_TRANSITO',
    rifiuto: { cerCode: '150101', quantita: 100, unitaMisura: 'kg' },
  } as any

  beforeEach(() => {
    firService = jasmine.createSpyObj('FirService', ['getFIRList', 'confermaConsegna'])
    firService.getFIRList.and.returnValue(of({ items: [], total: 0 }) as any)
    const registry = jasmine.createSpyObj('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
    ])
    for (const m of ['getProduttori', 'getTrasportatori', 'getDestinatari']) {
      registry[m].and.returnValue(of({ items: [], total: 0 }))
    }

    TestBed.configureTestingModule({
      imports: [FirListComponent, NoopAnimationsModule, HttpClientTestingModule],
      providers: [
        { provide: FirService, useValue: firService },
        { provide: RegistryService, useValue: registry },
        {
          provide: AuthService,
          useValue: { currentUser: () => ({ id: 'u1', email: 'u@example.com', role: 'ADMIN' }) },
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
    component = fixture.componentInstance
    messageService = fixture.debugElement.injector.get(MessageService)
    fixture.detectChanges()
  })

  function apriDialog(peso: number): HTMLElement {
    component.showConsegnaDialog(firInTransito)
    component.pesoEffettivo = peso
    fixture.detectChanges()
    return document.body
  }

  it("etichetta il campo con l'unità del FIR e non con kg fisso", () => {
    component.showConsegnaDialog({
      ...firInTransito,
      rifiuto: { ...firInTransito.rifiuto, unitaMisura: 'litri' },
    })
    fixture.detectChanges()

    const label = document.body.querySelector('label[for="peso-effettivo"]')
    expect(label?.textContent).toContain('Quantità verificata a destino (litri)')
  })

  it('a +10% esatto non mostra alcun avviso', () => {
    const root = apriDialog(110)
    expect(root.querySelector('[data-testid="avviso-scostamento"]')).toBeNull()
  })

  it('oltre soglia mostra l\'avviso con role="status" e il testo previsto', () => {
    const root = apriDialog(110.01)
    const avviso = root.querySelector('[data-testid="avviso-scostamento"]')
    expect(avviso).toBeTruthy()
    expect(avviso?.getAttribute('role')).toBe('status')
    expect(avviso?.textContent).toContain('La quantità verificata differisce del +10')
    expect(avviso?.textContent).toContain('da quella dichiarata (100 kg)')
    expect(avviso?.textContent).toContain(
      'puoi confermare, lo scostamento resta registrato sul FIR.'
    )
  })

  it("l'avviso non blocca: consegnaFIR invia comunque la quantità", () => {
    firService.confermaConsegna.and.returnValue(of({ ...firInTransito, scostamentoPeso: null }))
    apriDialog(300)
    expect(component.avvisoScostamento).toBeTruthy()

    component.consegnaFIR()

    expect(firService.confermaConsegna).toHaveBeenCalledWith('fir-1', 300)
  })

  it('toast "warn" se la risposta ha uno scostamento oltre soglia', () => {
    const add = spyOn(messageService, 'add').and.callThrough()
    firService.confermaConsegna.and.returnValue(
      of({
        ...firInTransito,
        scostamentoPeso: { differenza: 50, percentuale: 50, unita: 'kg', oltreSoglia: true },
      })
    )
    apriDialog(150)

    component.consegnaFIR()

    const toast = add.calls
      .allArgs()
      .map(a => a[0])
      .find(m => m.severity === 'warn')
    expect(toast).toBeTruthy()
    expect(toast?.detail).toContain('+50%')
    expect(add.calls.allArgs().some(a => a[0].severity === 'success')).toBeFalse()
  })

  it('toast "success" se lo scostamento è entro soglia', () => {
    const add = spyOn(messageService, 'add').and.callThrough()
    firService.confermaConsegna.and.returnValue(
      of({
        ...firInTransito,
        scostamentoPeso: { differenza: 5, percentuale: 5, unita: 'kg', oltreSoglia: false },
      })
    )
    apriDialog(105)

    component.consegnaFIR()

    expect(add.calls.allArgs().some(a => a[0].severity === 'success')).toBeTrue()
    expect(add.calls.allArgs().some(a => a[0].severity === 'warn')).toBeFalse()
  })
})

/**
 * Modifica delle bozze: pulsante per riga, dialog riusato e precompilato, invio con la versione,
 * gestione dei due 409 e apertura da `?modifica=<id>`.
 */
describe('FirListComponent — modifica delle bozze', () => {
  let fixture: ComponentFixture<FirListComponent>
  let component: FirListComponent
  let firService: jasmine.SpyObj<FirService>
  let messageService: MessageService
  let router: Router

  const bozza = (extra: Partial<FIR> = {}): FIR => ({
    id: 'f1',
    numeroProgressivo: null,
    anno: 2026,
    stato: FIRStato.BOZZA,
    versione: 3,
    modificabile: true,
    motivoNonModificabile: null,
    produttoreId: 'p1',
    trasportatoreId: 't1',
    destinatarioId: 'd1',
    provenienza: 'SPECIALE',
    tipoTrattaPrincipale: 'TERRESTRE',
    rifiuto: {
      cerCode: '150101',
      quantita: 10,
      unitaMisura: 't',
      descrizione: 'Imballaggi',
      categoria: 'URBANI',
      tipoOperazione: 'RECOVERY',
    },
    createdAt: '2026-07-01T10:00:00.000Z',
    ...extra,
  })

  function setup(opts: { role?: string; modifica?: string; righe?: FIR[] } = {}) {
    firService = jasmine.createSpyObj('FirService', [
      'getFIRList',
      'getFIRById',
      'createFIR',
      'modificaFIR',
      'emettiFIR',
      'presaInCarico',
      'confermaConsegna',
      'annullaFIR',
    ])
    const righe = opts.righe ?? [bozza()]
    firService.getFIRList.and.returnValue(
      of({ items: righe, total: righe.length, page: 1, limit: 10, totalPages: 1 }) as any
    )
    firService.getFIRById.and.callFake(id => of(righe.find(r => r.id === id) ?? bozza()))
    firService.modificaFIR.and.returnValue(of(bozza()))

    const registryService = jasmine.createSpyObj('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
    ])
    registryService.getProduttori.and.returnValue(of({ items: [], total: 0 }))
    registryService.getTrasportatori.and.returnValue(of({ items: [], total: 0 }))
    registryService.getDestinatari.and.returnValue(of({ items: [], total: 0 }))

    TestBed.configureTestingModule({
      imports: [FirListComponent, NoopAnimationsModule, HttpClientTestingModule],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              queryParamMap: convertToParamMap(opts.modifica ? { modifica: opts.modifica } : {}),
            },
          },
        },
        { provide: FirService, useValue: firService },
        { provide: RegistryService, useValue: registryService },
        {
          provide: AuthService,
          useValue: {
            currentUser: () => ({ id: 'u1', email: 'u@x.it', role: opts.role ?? 'ADMIN' }),
          },
        },
        {
          provide: RENTRISyncService,
          useValue: jasmine.createSpyObj('RENTRISyncService', ['syncFIR', 'confermaLegame']),
        },
        MessageService,
        ConfirmationService,
        ExportService,
      ],
    })
    messageService = TestBed.inject(MessageService)
    router = TestBed.inject(Router)
    spyOn(router, 'navigate').and.resolveTo(true)
    fixture = TestBed.createComponent(FirListComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  }

  const el = () => fixture.nativeElement as HTMLElement

  it('mostra «Modifica» solo sulle bozze modificabili e il motivo sul badge delle altre', () => {
    setup({
      righe: [
        bozza(),
        bozza({ id: 'f2', modificabile: false, motivoNonModificabile: 'LEGATO_RENTRI' }),
        bozza({
          id: 'f3',
          stato: FIRStato.EMESSO,
          modificabile: false,
          motivoNonModificabile: 'NON_BOZZA',
        }),
      ],
    })
    expect(el().querySelector('[data-testid="fir-modifica-f1"]')).toBeTruthy()
    expect(el().querySelector('[data-testid="fir-modifica-f2"]')).toBeNull()
    expect(el().querySelector('[data-testid="fir-modifica-f3"]')).toBeNull()
    expect(component.motivoNonModificabileRiga(component.firList[1])).toContain('RENTRI')
    expect(component.motivoNonModificabileRiga(component.firList[0])).toBeUndefined()
    expect(component.motivoNonModificabileRiga(component.firList[2])).toBeUndefined()
  })

  it('un VIEWER non vede «Modifica»', () => {
    setup({ role: 'VIEWER' })
    expect(el().querySelector('[data-testid="fir-modifica-f1"]')).toBeNull()
  })

  it('click su Modifica, cambio quantità, Salva: PUT con la versione e senza i campi esclusi', () => {
    setup()
    ;(el().querySelector('[data-testid="fir-modifica-f1"] button') as HTMLButtonElement).click()
    fixture.detectChanges()

    expect(firService.getFIRById).toHaveBeenCalledWith('f1')
    expect(component.displayCreateDialog).toBeTrue()
    expect(document.body.textContent).toContain('Modifica bozza FIR')
    expect(component.newFIR.rifiuto.cerCode).toBe('150101')
    expect(component.newFIR.rifiuto.unitaMisura).toBe('t')

    const qta = document.querySelector('#new-qta') as HTMLInputElement
    expect(qta).toBeTruthy()
    qta.focus()
    qta.value = '20'
    qta.dispatchEvent(new Event('input', { bubbles: true }))
    qta.dispatchEvent(new Event('blur', { bubbles: true }))
    fixture.detectChanges()

    const salva = document.querySelector(
      '[data-testid="fir-dialog-salva"] button'
    ) as HTMLButtonElement
    expect(salva.textContent).toContain('Salva modifiche')
    salva.click()
    fixture.detectChanges()

    expect(firService.createFIR).not.toHaveBeenCalled()
    expect(firService.modificaFIR).toHaveBeenCalledTimes(1)
    const [id, dto] = firService.modificaFIR.calls.mostRecent().args
    expect(id).toBe('f1')
    expect(dto.versione).toBe(3)
    expect(dto.rifiuto.quantita).toBe(20)
    expect(dto.rifiuto.unitaMisura).toBe('t')
    const rifiuto = dto.rifiuto as Record<string, unknown>
    expect('descrizione' in rifiuto).toBeFalse()
    expect('categoria' in rifiuto).toBeFalse()
    expect('tipoOperazione' in rifiuto).toBeFalse()
    expect(component.displayCreateDialog).toBeFalse()
    expect(component.firInModifica).toBeNull()
  })

  it('409 FIR_MODIFICATO_NEL_FRATTEMPO: avviso, rilettura e form aggiornato con la versione nuova', () => {
    setup()
    const add = spyOn(messageService, 'add')
    component.apriModifica(component.firList[0])
    firService.modificaFIR.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { error: 'FIR_MODIFICATO_NEL_FRATTEMPO', message: 'Il FIR è cambiato.' },
      }))
    )
    firService.getFIRById.and.returnValue(
      of(bozza({ versione: 4, rifiuto: { cerCode: '150101', quantita: 99, unitaMisura: 't' } }))
    )

    component.salvaFIR()

    expect(firService.getFIRById).toHaveBeenCalledTimes(2)
    expect(component.firInModifica).toEqual({ id: 'f1', versione: 4 })
    expect(component.newFIR.rifiuto.quantita).toBe(99)
    expect(component.displayCreateDialog).toBeTrue()
    expect(component.saving).toBeFalse()
    expect(add).toHaveBeenCalledWith(
      jasmine.objectContaining({
        severity: 'warn',
        detail: jasmine.stringContaining('ripeti la modifica'),
      })
    )
  })

  it('409 FIR_NON_MODIFICABILE: messaggio, dialog chiuso e lista ricaricata', () => {
    setup()
    const add = spyOn(messageService, 'add')
    component.apriModifica(component.firList[0])
    firService.getFIRList.calls.reset()
    firService.modificaFIR.and.returnValue(
      throwError(() => ({
        status: 409,
        error: { error: 'FIR_NON_MODIFICABILE', message: 'Il FIR porta già una firma.' },
      }))
    )

    component.salvaFIR()

    expect(component.displayCreateDialog).toBeFalse()
    expect(component.firInModifica).toBeNull()
    expect(firService.getFIRList).toHaveBeenCalled()
    expect(add).toHaveBeenCalledWith(
      jasmine.objectContaining({ severity: 'error', detail: 'Il FIR porta già una firma.' })
    )
  })

  it('apre la modifica dal parametro ?modifica= (FIR letto dal backend) e lo toglie dall’URL', () => {
    setup({ modifica: 'f1', righe: [bozza()] })

    expect(firService.getFIRById).toHaveBeenCalledWith('f1')
    expect(component.displayCreateDialog).toBeTrue()
    expect(component.firInModifica).toEqual({ id: 'f1', versione: 3 })
    expect(router.navigate).toHaveBeenCalledWith([], {
      queryParams: { modifica: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    })
  })

  it('dal parametro ?modifica= su una bozza non modificabile avvisa e non apre il dialog', () => {
    setup({
      modifica: 'f1',
      righe: [bozza({ modificabile: false, motivoNonModificabile: 'FIRMATO' })],
    })
    expect(component.displayCreateDialog).toBeFalse()
  })

  it('non apre la modifica se il FIR ha tratte senza trasportatore mappabile', () => {
    setup()
    const add = spyOn(messageService, 'add')
    const aperto = component.showEditDialog(
      bozza({ trasportatoriAggiuntivi: [{ tipoTratta: 'MARITTIMA', ordine: 1 }] })
    )
    expect(aperto).toBeFalse()
    expect(component.displayCreateDialog).toBeFalse()
    expect(component.firInModifica).toBeNull()
    expect(add).toHaveBeenCalledWith(
      jasmine.objectContaining({ severity: 'error', detail: jasmine.stringContaining('tratte') })
    )
  })

  it('non apre la modifica se la versione non è un numero', () => {
    setup()
    const add = spyOn(messageService, 'add')
    const aperto = component.showEditDialog(bozza({ versione: undefined }))
    expect(aperto).toBeFalse()
    expect(component.displayCreateDialog).toBeFalse()
    expect(component.firInModifica).toBeNull()
    expect(add).toHaveBeenCalledWith(
      jasmine.objectContaining({ severity: 'error', detail: jasmine.stringContaining('Versione') })
    )
  })

  it('la creazione resta com’era: Nuovo FIR chiama createFIR', () => {
    setup()
    component.showCreateDialog()
    component.newFIR.produttoreId = 'p1'
    component.newFIR.trasportatoreId = 't1'
    component.newFIR.destinatarioId = 'd1'
    component.newFIR.rifiuto.cerCode = '150101'
    component.newFIR.rifiuto.quantita = 1
    component.newFIR.provenienza = 'URBANO'
    component.newFIR.tipoTrattaPrincipale = 'TERRESTRE'
    firService.createFIR.and.returnValue(of({} as FIR))
    component.salvaFIR()
    expect(firService.createFIR).toHaveBeenCalled()
    expect(firService.modificaFIR).not.toHaveBeenCalled()
  })
})

/**
 * F2-10: scelta della sede delle parti nel dialog del FIR e identificativo fiscale nelle tendine.
 * La tendina della sede compare solo se la ditta ha più sedi; il DTO porta la sede solo se
 * l'utente l'ha cambiata rispetto al valore iniziale (I4).
 */
describe('FirListComponent — sede delle parti e codice fiscale (F2-10)', () => {
  let fixture: ComponentFixture<FirListComponent>
  let component: FirListComponent
  let firService: jasmine.SpyObj<FirService>
  let registryService: jasmine.SpyObj<RegistryService>

  const sede = (id: string, via: string, extra: Record<string, unknown> = {}) => ({
    id,
    denominazione: null,
    via,
    civico: '1',
    cap: '20100',
    citta: 'Milano',
    provincia: 'MI',
    referente: null,
    email: null,
    telefono: null,
    pec: null,
    principale: false,
    attiva: true,
    ...extra,
  })
  const dittaMulti = {
    id: 'ditta-multi',
    ragioneSociale: 'Acme SRL',
    partitaIva: '12345678903',
    codiceFiscale: null,
    partitaIvaDaVerificare: false,
    privato: false,
    sedi: [
      sede('s1', 'Via Uno', { principale: true }),
      sede('s2', 'Via Due'),
      sede('s3', 'Via Tre', { attiva: false }),
    ],
    ruoli: {},
  }
  const dittaSingola = { ...dittaMulti, id: 'ditta-singola', sedi: [sede('u1', 'Via Sola')] }

  const prodMulti = {
    id: 'p-multi',
    ragioneSociale: 'Acme SRL',
    partitaIVA: '12345678903',
    dittaId: 'ditta-multi',
    sedeId: 's1',
    numeroSedi: 3,
  }
  const prodSingolo = {
    id: 'p-singolo',
    ragioneSociale: 'Beta SRL',
    partitaIVA: '09876543217',
    dittaId: 'ditta-singola',
    sedeId: 'u1',
    numeroSedi: 1,
  }
  const prodPrivato = {
    id: 'p-privato',
    ragioneSociale: 'Rossi Mario',
    partitaIVA: null,
    codiceFiscale: 'RSSMRA80A01H501U',
  }
  const destMulti = {
    id: 'd-multi',
    ragioneSociale: 'Impianto SRL',
    partitaIVA: '12345678903',
    dittaId: 'ditta-multi',
    sedeId: 's2',
    numeroSedi: 3,
  }

  const bozza = (extra: Partial<FIR> = {}): FIR => ({
    id: 'f1',
    numeroProgressivo: null,
    anno: 2026,
    stato: FIRStato.BOZZA,
    versione: 3,
    modificabile: true,
    motivoNonModificabile: null,
    produttoreId: 'p-multi',
    trasportatoreId: 't1',
    destinatarioId: 'd-multi',
    provenienza: 'SPECIALE',
    tipoTrattaPrincipale: 'TERRESTRE',
    rifiuto: { cerCode: '150101', quantita: 10, unitaMisura: 't' },
    createdAt: '2026-07-01T10:00:00.000Z',
    ...extra,
  })

  function setup(fir?: FIR) {
    firService = jasmine.createSpyObj('FirService', [
      'getFIRList',
      'getFIRById',
      'createFIR',
      'modificaFIR',
    ])
    firService.getFIRList.and.returnValue(
      of({ items: [], total: 0, page: 1, limit: 10, totalPages: 1 }) as any
    )
    firService.createFIR.and.returnValue(of({}) as any)
    firService.modificaFIR.and.returnValue(of(bozza()))
    registryService = jasmine.createSpyObj('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
      'getDitta',
    ])
    registryService.getProduttori.and.returnValue(
      of({ items: [prodMulti, prodSingolo, prodPrivato], total: 3 }) as any
    )
    registryService.getTrasportatori.and.returnValue(
      of({
        items: [
          { id: 't1', ragioneSociale: 'Trasporti SRL', partitaIVA: '22345678901' },
          {
            id: 't-priv',
            ragioneSociale: 'Verdi Luca',
            partitaIVA: null,
            codiceFiscale: 'VRDLCU80A01H501X',
          },
        ],
        total: 2,
      }) as any
    )
    registryService.getDestinatari.and.returnValue(of({ items: [destMulti], total: 1 }) as any)
    registryService.getDitta.and.callFake(
      (id: string) => of(id === 'ditta-multi' ? dittaMulti : dittaSingola) as any
    )

    TestBed.configureTestingModule({
      imports: [FirListComponent, NoopAnimationsModule, HttpClientTestingModule],
      providers: [
        { provide: FirService, useValue: firService },
        { provide: RegistryService, useValue: registryService },
        {
          provide: AuthService,
          useValue: { currentUser: () => ({ id: 'u1', email: 'u@x.it', role: 'ADMIN' }) },
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
    component = fixture.componentInstance
    fixture.detectChanges()
    if (fir) {
      component.showEditDialog(fir)
    } else {
      component.showCreateDialog()
    }
    fixture.detectChanges()
  }

  /** Apre la tendina con un click reale e sceglie la voce che contiene `testo`. */
  function scegli(inputId: string, testo: string): void {
    const radice = document
      .querySelector('#' + inputId)!
      .closest('p-dropdown')!
      .querySelector('.p-dropdown') as HTMLElement
    radice.click()
    fixture.detectChanges()
    const voce = Array.from(document.querySelectorAll('li.p-dropdown-item'))
      .filter(li => (li.textContent ?? '').includes(testo))
      .pop() as HTMLElement
    expect(voce).withContext(`voce «${testo}» in ${inputId}`).toBeTruthy()
    voce.click()
    fixture.detectChanges()
  }

  const sedeProduttore = () => document.querySelector('[data-testid="fir-sede-produttore"]')
  const salva = () =>
    (document.querySelector('[data-testid="fir-dialog-salva"] button') as HTMLButtonElement).click()

  function compilaResto(): void {
    component.newFIR.trasportatoreId = 't1'
    component.newFIR.destinatarioId = 'd-multi'
    component.newFIR.rifiuto.cerCode = '150101'
    component.newFIR.rifiuto.quantita = 10
    component.newFIR.provenienza = 'SPECIALE'
    component.newFIR.tipoTrattaPrincipale = 'TERRESTRE'
    fixture.detectChanges()
  }

  it('con una sola sede attiva non compare la tendina “Sede del produttore”', () => {
    setup()
    scegli('new-produttore', 'Beta SRL')

    expect(registryService.getDitta).toHaveBeenCalledWith('ditta-singola')
    expect(sedeProduttore()).toBeNull()
  })

  it('con più sedi compare “Sede del produttore” preimpostata sulla predefinita del ruolo', () => {
    setup()
    scegli('new-produttore', 'Acme SRL')

    expect(sedeProduttore()).toBeTruthy()
    expect(sedeProduttore()!.textContent).toContain('Sede del produttore')
    expect(component.newFIR.produttoreSedeId).toBe('s1')
    // la sede non attiva non si propone
    expect(component.sediProduttore().map(s => s.id)).toEqual(['s1', 's2'])
  })

  it('compare “Sede del destinatario” per un destinatario con più sedi, preimpostata sulla sua sede predefinita', () => {
    setup()
    scegli('new-destinatario', 'Impianto SRL')

    expect(document.querySelector('[data-testid="fir-sede-destinatario"]')).toBeTruthy()
    expect(component.newFIR.destinatarioSedeId).toBe('s2')
  })

  it('getDitta una sola volta per ditta, anche se il produttore viene riscelto', () => {
    setup()
    scegli('new-produttore', 'Acme SRL')
    scegli('new-produttore', 'Beta SRL')
    scegli('new-produttore', 'Acme SRL')

    const chiamate = registryService.getDitta.calls
      .allArgs()
      .filter(a => a[0] === 'ditta-multi').length
    expect(chiamate).toBe(1)
  })

  it('creazione: la sede NON è nel DTO se l’utente non la cambia', () => {
    setup()
    scegli('new-produttore', 'Acme SRL')
    compilaResto()
    salva()

    expect(firService.createFIR).toHaveBeenCalledTimes(1)
    const dto = firService.createFIR.calls.mostRecent().args[0]
    expect(dto.produttoreId).toBe('p-multi')
    expect('produttoreSedeId' in dto).toBeFalse()
    expect('destinatarioSedeId' in dto).toBeFalse()
  })

  it('creazione: la sede è nel DTO se l’utente la cambia dalla tendina', () => {
    setup()
    scegli('new-produttore', 'Acme SRL')
    scegli('new-produttore-sede', 'Via Due')
    compilaResto()
    salva()

    const dto = firService.createFIR.calls.mostRecent().args[0]
    expect(dto.produttoreSedeId).toBe('s2')
    expect('destinatarioSedeId' in dto).toBeFalse()
  })

  it('creazione: tornare alla sede iniziale la toglie dal DTO', () => {
    setup()
    scegli('new-produttore', 'Acme SRL')
    scegli('new-produttore-sede', 'Via Due')
    scegli('new-produttore-sede', 'Via Uno')
    compilaResto()
    salva()

    expect('produttoreSedeId' in firService.createFIR.calls.mostRecent().args[0]).toBeFalse()
  })

  it('modifica: tendina preimpostata sulla sede del FIR; salvando senza toccarla il DTO non la porta', () => {
    setup(
      bozza({
        produttore: { ragioneSociale: 'Acme SRL', partitaIva: '12345678903', sedeId: 's2' },
      })
    )

    expect(sedeProduttore()).toBeTruthy()
    expect(component.newFIR.produttoreSedeId).toBe('s2')
    salva()

    const [id, dto] = firService.modificaFIR.calls.mostRecent().args
    expect(id).toBe('f1')
    expect('produttoreSedeId' in dto).toBeFalse()
    expect('destinatarioSedeId' in dto).toBeFalse()
  })

  it('modifica di un FIR precedente (sede NULL): mostra la predefinita e non la scrive', () => {
    setup(bozza({ produttore: { ragioneSociale: 'Acme SRL', partitaIva: '12345678903' } }))

    expect(component.newFIR.produttoreSedeId).toBe('s1')
    salva()

    expect('produttoreSedeId' in firService.modificaFIR.calls.mostRecent().args[1]).toBeFalse()
  })

  it('modifica: cambiando la sede il DTO la porta', () => {
    setup(
      bozza({
        produttore: { ragioneSociale: 'Acme SRL', partitaIva: '12345678903', sedeId: 's2' },
      })
    )
    scegli('new-produttore-sede', 'Via Uno')
    salva()

    expect(firService.modificaFIR.calls.mostRecent().args[1].produttoreSedeId).toBe('s1')
  })

  it('le tendine mostrano “C.F. …” per un privato e mai “P.IVA null”', () => {
    setup()
    const radice = document
      .querySelector('#new-produttore')!
      .closest('p-dropdown')!
      .querySelector('.p-dropdown') as HTMLElement
    radice.click()
    fixture.detectChanges()
    const testo = Array.from(document.querySelectorAll('li.p-dropdown-item'))
      .map(li => li.textContent ?? '')
      .join('|')

    expect(testo).toContain('C.F. RSSMRA80A01H501U')
    expect(testo).toContain('P.IVA 12345678903')
    expect(testo).not.toContain('null')
    expect(testo).not.toContain('P.IVA RSSMRA')
  })

  it('anche la tendina del trasportatore mostra “C.F. …” per chi non ha la P.IVA', () => {
    setup()
    const radice = document
      .querySelector('#new-trasportatore')!
      .closest('p-dropdown')!
      .querySelector('.p-dropdown') as HTMLElement
    radice.click()
    fixture.detectChanges()
    const testo = Array.from(document.querySelectorAll('li.p-dropdown-item'))
      .map(li => li.textContent ?? '')
      .join('|')

    expect(testo).toContain('C.F. VRDLCU80A01H501X')
    expect(testo).not.toContain('null')
  })
})
