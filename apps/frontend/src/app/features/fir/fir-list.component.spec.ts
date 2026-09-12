import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { FirListComponent } from './fir-list.component'
import { FirService } from './fir.service'
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
    partitaIVA: '12345678901',
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
