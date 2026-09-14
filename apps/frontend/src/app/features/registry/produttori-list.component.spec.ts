import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { MessageService, ConfirmationService } from 'primeng/api'
import { ProduttoriListComponent } from './produttori-list.component'
import { RegistryService } from './registry.service'
import { Produttore } from '../../shared/models/registry.model'

/**
 * Verifica minima dei `data-testid` aggiunti per la suite E2E (Task 2 del
 * piano UAT/E2E): un refuso nel template Angular non viene intercettato dal
 * compilatore, va verificato a runtime.
 */
describe('ProduttoriListComponent — selettori data-testid', () => {
  let fixture: ComponentFixture<ProduttoriListComponent>
  let registryService: jasmine.SpyObj<RegistryService>

  const PRODUTTORE: Produttore = {
    id: 'p1',
    ragioneSociale: 'ACME S.r.l.',
    partitaIVA: '01234567890',
    sedeLegale: { via: 'Via Roma', civico: '1', cap: '20100', comune: 'Milano', provincia: 'MI' },
    pec: 'acme@pec.it',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    registryService = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getProduttori',
      'createProduttore',
      'updateProduttore',
      'deleteProduttore',
    ])
    registryService.getProduttori.and.returnValue(
      of({ items: [PRODUTTORE], total: 1, page: 1, limit: 10, totalPages: 1 })
    )

    TestBed.configureTestingModule({
      imports: [ProduttoriListComponent, NoopAnimationsModule],
      providers: [
        { provide: RegistryService, useValue: registryService },
        MessageService,
        ConfirmationService,
      ],
    })

    fixture = TestBed.createComponent(ProduttoriListComponent)
    fixture.detectChanges()
  })

  function testid(id: string): Element | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`)
  }

  it('espone il pulsante "Nuovo produttore"', () => {
    expect(testid('produttori-nuovo-button')).toBeTruthy()
  })

  it('espone la riga con l\'id di business del produttore', () => {
    expect(testid('produttori-row-p1')).toBeTruthy()
  })

  it('espone i pulsanti azione per riga con lo stesso id', () => {
    expect(testid('produttori-modifica-p1')).toBeTruthy()
    expect(testid('produttori-elimina-p1')).toBeTruthy()
  })
})
