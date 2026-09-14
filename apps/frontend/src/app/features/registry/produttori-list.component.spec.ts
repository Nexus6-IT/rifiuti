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

  it("espone la riga con l'id di business del produttore", () => {
    expect(testid('produttori-row-p1')).toBeTruthy()
  })

  it('espone i pulsanti azione per riga con lo stesso id', () => {
    expect(testid('produttori-modifica-p1')).toBeTruthy()
    expect(testid('produttori-elimina-p1')).toBeTruthy()
  })
})

/**
 * TDD per il difetto CRITICO del 2026-09-14: `UpdateProduttoreDto` non
 * dichiara `partitaIVA` e il backend ha `forbidNonWhitelisted: true`, quindi
 * ogni PUT che la include riceve 400. Il payload di modifica NON deve
 * contenere quel campo. `jasmine.objectContaining` non basta: ignora i campi
 * in più, quindi qui si asserisce la forma ESATTA dell'oggetto inviato.
 */
describe('ProduttoriListComponent — payload di modifica senza partitaIVA (bug produzione)', () => {
  let fixture: ComponentFixture<ProduttoriListComponent>
  let component: ProduttoriListComponent
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
    registryService.updateProduttore.and.returnValue(of(PRODUTTORE))

    TestBed.configureTestingModule({
      imports: [ProduttoriListComponent, NoopAnimationsModule],
      providers: [
        { provide: RegistryService, useValue: registryService },
        MessageService,
        ConfirmationService,
      ],
    })

    fixture = TestBed.createComponent(ProduttoriListComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('il payload PUT ha esattamente i campi accettati da UpdateProduttoreDto, mai partitaIVA', () => {
    component.editProduttore(PRODUTTORE)
    component.formData.ragioneSociale = 'ACME S.r.l. (aggiornata)'

    component.saveProduttore()

    const inviato = registryService.updateProduttore.calls.mostRecent().args[1]
    expect(inviato).toEqual({
      ragioneSociale: 'ACME S.r.l. (aggiornata)',
      sedeLegale: PRODUTTORE.sedeLegale,
      pec: PRODUTTORE.pec,
    })
    expect(Object.prototype.hasOwnProperty.call(inviato, 'partitaIVA')).toBeFalse()
  })

  it('il campo Partita IVA è disabilitato nel form di modifica', async () => {
    component.editProduttore(PRODUTTORE)
    fixture.detectChanges()
    // NgModel applica lo stato disabled al FormControl dentro un microtask
    // (`resolvedPromise.then`, vedi @angular/forms `NgModel._updateDisabled`):
    // serve attendere quel giro prima di rileggere il DOM.
    await Promise.resolve()
    fixture.detectChanges()

    const input = fixture.nativeElement.querySelector(
      '[data-testid="produttori-piva-input"]'
    ) as HTMLInputElement
    expect(input.disabled).toBeTrue()
  })
})
