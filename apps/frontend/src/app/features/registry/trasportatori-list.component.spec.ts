import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { MessageService, ConfirmationService } from 'primeng/api'
import { TrasportatoriListComponent } from './trasportatori-list.component'
import { RegistryService } from './registry.service'
import { Trasportatore } from '../../shared/models/registry.model'

/**
 * TDD per il difetto del 2026-09-14: la pagina /trasportatori (questo
 * componente, l'unico instradato da app.routes.ts) non aveva alcun modo di
 * impostare la data di scadenza dell'iscrizione all'Albo Gestori. Il campo
 * esisteva solo nel dialog condiviso `anagrafica-form-dialog.component.ts`,
 * montato però unicamente dentro il flusso "Nuovo FIR" — un percorso che
 * quasi nessun operatore di rubrica attraversa. Per tutte le anagrafiche
 * gestite da qui, l'avviso di scadenza non sarebbe mai potuto scattare.
 */
describe('TrasportatoriListComponent — data di scadenza iscrizione (facoltativa)', () => {
  let fixture: ComponentFixture<TrasportatoriListComponent>
  let component: TrasportatoriListComponent
  let registryService: jasmine.SpyObj<RegistryService>

  const TRASPORTATORE_ESISTENTE: Trasportatore = {
    id: 't1',
    ragioneSociale: 'Trasporti Rossi S.r.l.',
    partitaIVA: '01234567890',
    sedeLegale: { via: 'Via Roma', civico: '1', cap: '20100', comune: 'Milano', provincia: 'MI' },
    numeroIscrizione: 'MI/000123',
    pec: 'trasporti@pec.it',
    scadenzaIscrizione: '2027-03-15',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    registryService = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getTrasportatori',
      'createTrasportatore',
      'updateTrasportatore',
      'deleteTrasportatore',
    ])
    registryService.getTrasportatori.and.returnValue(
      of({ items: [TRASPORTATORE_ESISTENTE], total: 1, page: 1, limit: 10, totalPages: 1 })
    )
    registryService.createTrasportatore.and.returnValue(of(TRASPORTATORE_ESISTENTE))
    registryService.updateTrasportatore.and.returnValue(of(TRASPORTATORE_ESISTENTE))

    TestBed.configureTestingModule({
      imports: [TrasportatoriListComponent, NoopAnimationsModule],
      providers: [
        { provide: RegistryService, useValue: registryService },
        MessageService,
        ConfirmationService,
      ],
    })

    fixture = TestBed.createComponent(TrasportatoriListComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  function compilaCampiObbligatori(): void {
    component.formData.ragioneSociale = 'Nuovi Trasporti S.r.l.'
    component.formData.partitaIVA = '09876543210'
    component.formData.numeroIscrizione = 'MI/000999'
    component.formData.sedeLegale = {
      via: 'Via Milano',
      civico: '9',
      cap: '20121',
      comune: 'Milano',
      provincia: 'MI',
    }
  }

  it('in creazione, con scadenza compilata, la invia al servizio nel formato atteso', () => {
    component.showCreateDialog()
    compilaCampiObbligatori()
    component.formData.scadenzaIscrizione = '2028-01-31'

    component.saveTrasportatore()

    expect(registryService.createTrasportatore).toHaveBeenCalledWith(
      jasmine.objectContaining({ scadenzaIscrizione: '2028-01-31' })
    )
  })

  it('in creazione, senza scadenza, NON la invia come stringa vuota (le anagrafiche esistenti non hanno il dato)', () => {
    component.showCreateDialog()
    compilaCampiObbligatori()
    // formData.scadenzaIscrizione resta quello di default (vuoto)

    component.saveTrasportatore()

    const inviato = registryService.createTrasportatore.calls.mostRecent().args[0]
    expect(inviato.scadenzaIscrizione).toBeUndefined()
  })

  it('in modifica, precompila il campo con la scadenza esistente', () => {
    component.editTrasportatore(TRASPORTATORE_ESISTENTE)

    expect(component.formData.scadenzaIscrizione).toBe('2027-03-15')
  })

  it("in modifica, svuotando il campo l'azzeramento arriva al servizio come null, non come stringa vuota", () => {
    component.editTrasportatore(TRASPORTATORE_ESISTENTE)
    component.formData.scadenzaIscrizione = ''

    component.saveTrasportatore()

    const inviato = registryService.updateTrasportatore.calls.mostRecent().args[1]
    expect(inviato.scadenzaIscrizione).toBeNull()
  })

  it('in modifica, con una nuova scadenza compilata la invia al servizio', () => {
    component.editTrasportatore(TRASPORTATORE_ESISTENTE)
    component.formData.scadenzaIscrizione = '2029-06-30'

    component.saveTrasportatore()

    const inviato = registryService.updateTrasportatore.calls.mostRecent().args[1]
    expect(inviato.scadenzaIscrizione).toBe('2029-06-30')
  })
})

/**
 * TDD per il difetto CRITICO del 2026-09-14: `UpdateTrasportatoreDto` non
 * dichiara `partitaIVA` e il backend ha `forbidNonWhitelisted: true`, quindi
 * ogni PUT che la include riceve 400. Il payload di modifica NON deve
 * contenere quel campo. `jasmine.objectContaining` non basta: ignora i campi
 * in più, quindi qui si asserisce la forma ESATTA dell'oggetto inviato.
 */
describe('TrasportatoriListComponent — payload di modifica senza partitaIVA (bug produzione)', () => {
  let fixture: ComponentFixture<TrasportatoriListComponent>
  let component: TrasportatoriListComponent
  let registryService: jasmine.SpyObj<RegistryService>

  const TRASPORTATORE_ESISTENTE: Trasportatore = {
    id: 't1',
    ragioneSociale: 'Trasporti Rossi S.r.l.',
    partitaIVA: '01234567890',
    sedeLegale: { via: 'Via Roma', civico: '1', cap: '20100', comune: 'Milano', provincia: 'MI' },
    numeroIscrizione: 'MI/000123',
    pec: 'trasporti@pec.it',
    scadenzaIscrizione: '2027-03-15',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    registryService = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getTrasportatori',
      'createTrasportatore',
      'updateTrasportatore',
      'deleteTrasportatore',
    ])
    registryService.getTrasportatori.and.returnValue(
      of({ items: [TRASPORTATORE_ESISTENTE], total: 1, page: 1, limit: 10, totalPages: 1 })
    )
    registryService.updateTrasportatore.and.returnValue(of(TRASPORTATORE_ESISTENTE))

    TestBed.configureTestingModule({
      imports: [TrasportatoriListComponent, NoopAnimationsModule],
      providers: [
        { provide: RegistryService, useValue: registryService },
        MessageService,
        ConfirmationService,
      ],
    })

    fixture = TestBed.createComponent(TrasportatoriListComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('il payload PUT ha esattamente i campi accettati da UpdateTrasportatoreDto, mai partitaIVA', () => {
    component.editTrasportatore(TRASPORTATORE_ESISTENTE)
    component.formData.ragioneSociale = 'Trasporti Rossi S.r.l. (aggiornata)'

    component.saveTrasportatore()

    const inviato = registryService.updateTrasportatore.calls.mostRecent().args[1]
    expect(inviato).toEqual({
      ragioneSociale: 'Trasporti Rossi S.r.l. (aggiornata)',
      sedeLegale: TRASPORTATORE_ESISTENTE.sedeLegale,
      numeroIscrizione: TRASPORTATORE_ESISTENTE.numeroIscrizione,
      pec: TRASPORTATORE_ESISTENTE.pec,
      scadenzaIscrizione: TRASPORTATORE_ESISTENTE.scadenzaIscrizione,
    })
    expect(Object.prototype.hasOwnProperty.call(inviato, 'partitaIVA')).toBeFalse()
  })

  it('il campo Partita IVA è disabilitato nel form di modifica', async () => {
    component.editTrasportatore(TRASPORTATORE_ESISTENTE)
    fixture.detectChanges()
    // NgModel applica lo stato disabled al FormControl dentro un microtask
    // (`resolvedPromise.then`, vedi @angular/forms `NgModel._updateDisabled`):
    // serve attendere quel giro prima di rileggere il DOM.
    await Promise.resolve()
    fixture.detectChanges()

    const input = fixture.nativeElement.querySelector(
      '[data-testid="trasportatori-piva-input"]'
    ) as HTMLInputElement
    expect(input.disabled).toBeTrue()
  })
})
