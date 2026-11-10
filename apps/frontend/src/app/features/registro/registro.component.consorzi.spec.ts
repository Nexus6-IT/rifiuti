import { ComponentFixture, TestBed } from '@angular/core/testing'
import { DatePipe } from '@angular/common'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { provideRouter } from '@angular/router'
import { HttpClientTestingModule } from '@angular/common/http/testing'
import { of, throwError } from 'rxjs'
import { RegistroComponent } from './registro.component'
import { RegistroService } from './registro.service'
import { FeatureFlagsService } from '../../core/services/feature-flags.service'
import { ConsorziService } from '../comunicazioni/consorzi.service'
import { ToastService } from '../../core/services/toast.service'
import { ExportService } from '../../core/services/export.service'
import { AuthService } from '../../core/services/auth.service'
import { AdminTenantContextService } from '../../core/services/admin-tenant-context.service'
import { CompanyService } from '../../core/services/company.service'
import { FirService } from '../fir/fir.service'
import { RegistryService } from '../registry/registry.service'

/** Etichetta del consorzio nel registro (4.9b, T12): solo col modulo `comunicazioni`. */
describe('RegistroComponent: consorzi del movimento', () => {
  let fixture: ComponentFixture<RegistroComponent>
  let consorzi: jasmine.SpyObj<ConsorziService>
  let servizio: jasmine.SpyObj<RegistroService>

  const movimento = (id: string) =>
    ({
      id,
      tenantId: 't1',
      registroId: 'r1',
      progressiveNumber: 1,
      progressiveYear: 2026,
      type: 'CARICO',
      movementDate: '2026-05-10T08:00:00Z',
      causale: 'INGRESSO_ESTERNO',
      cerCode: '13 02 05*',
      quantity: 10,
      unit: 'KG',
      tipoAnnotazione: 'ORDINARIA',
    }) as never

  function setup(moduloAttivo: boolean): void {
    const registro = {
      id: 'r1',
      unitaLocaleId: 'u1',
      numIscrSito: null,
      denominazione: 'Sede',
      codice: 'CARICO_SCARICO',
      attivo: true,
      principale: true,
    }
    servizio = jasmine.createSpyObj<RegistroService>('RegistroService', [
      'lista',
      'listRegistri',
      'assicuraRegistri',
      'getProgressivoIniziale',
    ])
    servizio.lista.and.returnValue(
      of({ items: [movimento('m1'), movimento('m2')], total: 2, page: 1, limit: 20, totalPages: 1 })
    )
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
    consorzi = jasmine.createSpyObj<ConsorziService>('ConsorziService', [
      'consorziDeiMovimenti',
      'regole',
    ])
    consorzi.consorziDeiMovimenti.and.returnValue(
      of({
        m1: { marcature: [{ consorzio: 'CONOU', origine: 'REGOLA' }], esclusi: [] },
        m2: { marcature: [{ consorzio: 'COREPLA', origine: 'MANUALE' }], esclusi: [] },
      })
    )
    TestBed.configureTestingModule({
      imports: [RegistroComponent, HttpClientTestingModule],
      providers: [
        {
          provide: FeatureFlagsService,
          useValue: { has: (k: string) => k === 'comunicazioni' && moduloAttivo },
        },
        provideNoopAnimations(),
        provideRouter([]),
        DatePipe,
        { provide: RegistroService, useValue: servizio },
        { provide: ConsorziService, useValue: consorzi },
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
    fixture = TestBed.createComponent(RegistroComponent)
    fixture.detectChanges()
  }

  it('col modulo comunicazioni legge i consorzi della pagina in una richiesta e li mostra accanto al CER', () => {
    setup(true)
    expect(consorzi.consorziDeiMovimenti).toHaveBeenCalledTimes(1)
    expect(consorzi.consorziDeiMovimenti).toHaveBeenCalledWith(['m1', 'm2'])
    fixture.detectChanges()
    const root: HTMLElement = fixture.nativeElement
    expect(root.querySelector('[data-testid="registro-consorzio-m1"]')?.textContent).toContain(
      'CONOU'
    )
    expect(root.querySelector('[data-testid="registro-consorzio-m2"]')?.textContent).toContain(
      'Corepla (manuale)'
    )
  })

  it('senza il modulo non chiama l API e non mostra etichette', () => {
    setup(false)
    expect(consorzi.consorziDeiMovimenti).not.toHaveBeenCalled()
    expect(fixture.nativeElement.querySelector('.etichetta-consorzio')).toBeNull()
  })

  it('un errore nella lettura dei consorzi non blocca il registro', () => {
    setup(true)
    consorzi.consorziDeiMovimenti.and.returnValue(throwError(() => ({ status: 500 })))
    fixture.componentInstance.ricarica()
    fixture.detectChanges()
    expect(fixture.componentInstance.movimenti().length).toBe(2)
    expect(fixture.nativeElement.querySelector('.etichetta-consorzio')).toBeNull()
  })
})
