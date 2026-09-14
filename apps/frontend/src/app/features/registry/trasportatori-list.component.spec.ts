import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { MessageService, ConfirmationService } from 'primeng/api'
import { TrasportatoriListComponent } from './trasportatori-list.component'
import { RegistryService } from './registry.service'
import { AuthService } from '../../core/services/auth.service'
import { Trasportatore } from '../../shared/models/registry.model'

// Stub minimo: solo `currentUser()`, unico membro di AuthService usato dal
// componente per il gating dei pulsanti (Task N3). Ruolo ADMIN di default,
// così i test di business logic esistenti (non sul gating) restano validi
// senza doverlo impostare ovunque.
function authServiceStub(role = 'ADMIN') {
  return {
    currentUser: () => ({ id: 'u1', email: 'u@example.com', role }),
  }
}

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
        { provide: AuthService, useValue: authServiceStub() },
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
        { provide: AuthService, useValue: authServiceStub() },
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

/**
 * TDD per il rilievo N3: un VIEWER vede «Nuovo trasportatore», compila
 * tutto e riceve un 403 generico al salvataggio — RegistryController
 * protegge POST/PUT/DELETE trasportatori con
 * @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR'), un VIEWER non c'è. Stesso
 * schema di `fir-list.component.ts` (`puoCreareFir`).
 */
describe('TrasportatoriListComponent — gating dei pulsanti in base al ruolo (VIEWER)', () => {
  let fixture: ComponentFixture<TrasportatoriListComponent>

  const TRASPORTATORE_ESISTENTE: Trasportatore = {
    id: 't1',
    ragioneSociale: 'Trasporti Rossi S.r.l.',
    partitaIVA: '01234567890',
    sedeLegale: { via: 'Via Roma', civico: '1', cap: '20100', comune: 'Milano', provincia: 'MI' },
    numeroIscrizione: 'MI/000123',
    pec: 'trasporti@pec.it',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  function creaComponente(role: string): void {
    const registryService = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getTrasportatori',
      'createTrasportatore',
      'updateTrasportatore',
      'deleteTrasportatore',
    ])
    registryService.getTrasportatori.and.returnValue(
      of({ items: [TRASPORTATORE_ESISTENTE], total: 1, page: 1, limit: 10, totalPages: 1 })
    )

    TestBed.configureTestingModule({
      imports: [TrasportatoriListComponent, NoopAnimationsModule],
      providers: [
        { provide: RegistryService, useValue: registryService },
        { provide: AuthService, useValue: authServiceStub(role) },
        MessageService,
        ConfirmationService,
      ],
    })

    fixture = TestBed.createComponent(TrasportatoriListComponent)
    fixture.detectChanges()
  }

  it('un VIEWER non vede il pulsante "Nuovo trasportatore"', () => {
    creaComponente('VIEWER')

    const bottone = fixture.nativeElement.querySelector(
      '[data-testid="trasportatori-nuovo-button"]'
    )
    expect(bottone).toBeNull()
  })

  it('un VIEWER non vede le azioni Modifica/Elimina sulla riga', () => {
    creaComponente('VIEWER')

    expect(
      fixture.nativeElement.querySelector('[data-testid="trasportatori-modifica-t1"]')
    ).toBeNull()
    expect(
      fixture.nativeElement.querySelector('[data-testid="trasportatori-elimina-t1"]')
    ).toBeNull()
  })

  it('un OPERATOR vede sia "Nuovo trasportatore" sia le azioni sulla riga', () => {
    creaComponente('OPERATOR')

    expect(
      fixture.nativeElement.querySelector('[data-testid="trasportatori-nuovo-button"]')
    ).toBeTruthy()
    expect(
      fixture.nativeElement.querySelector('[data-testid="trasportatori-modifica-t1"]')
    ).toBeTruthy()
  })
})
