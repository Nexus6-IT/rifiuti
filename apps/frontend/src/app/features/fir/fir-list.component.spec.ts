import { ComponentFixture, TestBed } from '@angular/core/testing'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
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
 * TDD per l'avviso "PRIMA della compilazione" (GET /rentri/emissione-possibile):
 * a differenza dei gestionali concorrenti, che scoprono l'indisponibilità di
 * numeri vidimati solo al salvataggio del formulario già compilato, qui
 * l'apertura del dialogo "Nuovo FIR" interroga subito il backend e mostra
 * l'avviso PRIMA che l'utente scriva qualcosa.
 */
describe('FirListComponent — avviso emissione-possibile PRIMA della compilazione', () => {
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

  it('interroga emissione-possibile quando si apre il dialogo "Nuovo FIR"', () => {
    rentriBlocchiService.emissionePossibile.and.returnValue(
      of({ possibile: true, numeriDisponibili: 5 })
    )

    component.showCreateDialog()

    expect(rentriBlocchiService.emissionePossibile).toHaveBeenCalled()
    expect(component.emissionePossibile()).toEqual({ possibile: true, numeriDisponibili: 5 })
  })

  it("mostra l'avviso col motivo del backend (non riscritto) quando l'emissione non è possibile", () => {
    rentriBlocchiService.emissionePossibile.and.returnValue(
      of({
        possibile: false,
        motivo: 'Nessun numero vidimato disponibile per il blocco predefinito.',
        numeriDisponibili: 0,
      })
    )

    component.showCreateDialog()
    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    const banner = html.querySelector('[data-testid="fir-create-emissione-non-possibile"]')
    expect(banner).not.toBeNull()
    expect(banner?.textContent).toContain(
      'Nessun numero vidimato disponibile per il blocco predefinito.'
    )
  })

  it("non mostra alcun avviso quando l'emissione è possibile", () => {
    rentriBlocchiService.emissionePossibile.and.returnValue(
      of({ possibile: true, numeriDisponibili: 12 })
    )

    component.showCreateDialog()
    fixture.detectChanges()

    const html: HTMLElement = fixture.nativeElement
    expect(html.querySelector('[data-testid="fir-create-emissione-non-possibile"]')).toBeNull()
  })

  it('non blocca il form se il controllo emissione-possibile fallisce (fail-open sul solo avviso)', () => {
    rentriBlocchiService.emissionePossibile.and.returnValue(throwError(() => ({ status: 500 })))

    component.showCreateDialog()
    fixture.detectChanges()

    expect(component.displayCreateDialog).toBe(true)
    expect(component.emissionePossibile()).toBeNull()
  })
})
