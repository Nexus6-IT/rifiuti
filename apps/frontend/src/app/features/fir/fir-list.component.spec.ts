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
