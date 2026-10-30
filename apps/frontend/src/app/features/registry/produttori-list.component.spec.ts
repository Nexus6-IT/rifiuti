import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { MessageService, ConfirmationService } from 'primeng/api'
import { ProduttoriListComponent } from './produttori-list.component'
import { RegistryService } from './registry.service'
import { AuthService } from '../../core/services/auth.service'
import { Produttore } from '../../shared/models/registry.model'

// P.IVA con checksum valido (la validazione gemella del backend rifiuta le altre)
const PIVA_VALIDA = '12345678903'
const PIVA_CHECKSUM_ERRATO = '12345678901' // non supera il controllo di validità

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
    partitaIVA: PIVA_VALIDA,
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
        { provide: AuthService, useValue: authServiceStub() },
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
    partitaIVA: PIVA_VALIDA,
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
        { provide: AuthService, useValue: authServiceStub() },
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

/**
 * TDD per il rilievo N3: un VIEWER vede «Nuovo produttore», compila tutto e
 * riceve un 403 generico al salvataggio — RegistryController protegge
 * POST/PUT/DELETE produttori con @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR'),
 * un VIEWER non c'è. Stesso schema di `fir-list.component.ts` (`puoCreareFir`).
 */
describe('ProduttoriListComponent — gating dei pulsanti in base al ruolo (VIEWER)', () => {
  let fixture: ComponentFixture<ProduttoriListComponent>

  const PRODUTTORE: Produttore = {
    id: 'p1',
    ragioneSociale: 'ACME S.r.l.',
    partitaIVA: PIVA_VALIDA,
    sedeLegale: { via: 'Via Roma', civico: '1', cap: '20100', comune: 'Milano', provincia: 'MI' },
    pec: 'acme@pec.it',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  function creaComponente(role: string): void {
    const registryService = jasmine.createSpyObj<RegistryService>('RegistryService', [
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
        { provide: AuthService, useValue: authServiceStub(role) },
        MessageService,
        ConfirmationService,
      ],
    })

    fixture = TestBed.createComponent(ProduttoriListComponent)
    fixture.detectChanges()
  }

  it('un VIEWER non vede il pulsante "Nuovo produttore"', () => {
    creaComponente('VIEWER')

    const bottone = fixture.nativeElement.querySelector('[data-testid="produttori-nuovo-button"]')
    expect(bottone).toBeNull()
  })

  it('un VIEWER non vede le azioni Modifica/Elimina sulla riga', () => {
    creaComponente('VIEWER')

    expect(fixture.nativeElement.querySelector('[data-testid="produttori-modifica-p1"]')).toBeNull()
    expect(fixture.nativeElement.querySelector('[data-testid="produttori-elimina-p1"]')).toBeNull()
  })

  it('un OPERATOR vede sia "Nuovo produttore" sia le azioni sulla riga', () => {
    creaComponente('OPERATOR')

    expect(
      fixture.nativeElement.querySelector('[data-testid="produttori-nuovo-button"]')
    ).toBeTruthy()
    expect(
      fixture.nativeElement.querySelector('[data-testid="produttori-modifica-p1"]')
    ).toBeTruthy()
  })
})

/**
 * Codice fiscale, ditta e sedi nella lista (F2-10): colonna "P.IVA / C.F.", badge "Da verificare",
 * pulsante "Sedi (n)" e validazione gemella del backend nel form.
 */
describe('ProduttoriListComponent — ditte, codice fiscale e sedi', () => {
  let fixture: ComponentFixture<ProduttoriListComponent>
  let component: ProduttoriListComponent
  let registryService: jasmine.SpyObj<RegistryService>

  const CF_PERSONA = 'RSSMRA80A01H501U'
  const RIGA = {
    id: 'r1',
    ragioneSociale: 'Ditta Uno S.r.l.',
    partitaIVA: PIVA_CHECKSUM_ERRATO, // checksum errato: P.IVA migrata, da verificare
    codiceFiscale: null,
    dittaId: 'dit1',
    sedeId: 'sed1',
    numeroSedi: 3,
    partitaIvaDaVerificare: true,

    sedeLegale: { via: 'Via Torino', civico: '5', cap: '10100', comune: 'Torino', provincia: 'TO' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Produttore
  const RIGA_PRIVATO = {
    ...RIGA,
    id: 'r2',
    partitaIVA: null,
    codiceFiscale: CF_PERSONA,
    partitaIvaDaVerificare: false,
    numeroSedi: 1,
  } as unknown as Produttore

  beforeEach(() => {
    registryService = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getProduttori',
      'createProduttore',
      'updateProduttore',
      'cercaDitta',
      'getDitta',
    ])
    registryService.getProduttori.and.returnValue(
      of({ items: [RIGA, RIGA_PRIVATO], total: 2, page: 1, limit: 10, totalPages: 1 })
    )
    registryService.createProduttore.and.returnValue(of(RIGA))
    registryService.updateProduttore.and.returnValue(of(RIGA))
    registryService.cercaDitta.and.returnValue(of({ ditta: null }))
    registryService.getDitta.and.returnValue(
      of({
        id: 'dit1',
        ragioneSociale: 'Ditta Uno S.r.l.',
        partitaIva: null,
        codiceFiscale: null,
        partitaIvaDaVerificare: true,
        privato: false,
        sedi: [],
        ruoli: {},
      })
    )
    TestBed.configureTestingModule({
      imports: [ProduttoriListComponent, NoopAnimationsModule],
      providers: [
        { provide: RegistryService, useValue: registryService },
        { provide: AuthService, useValue: authServiceStub() },
        MessageService,
        ConfirmationService,
      ],
    })
    fixture = TestBed.createComponent(ProduttoriListComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  afterEach(() => {
    fixture.destroy()
    document.querySelectorAll('.p-dialog-mask').forEach(e => e.remove())
  })

  const el = () => fixture.nativeElement as HTMLElement
  const tid = (id: string) => el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null

  function compila(): void {
    component.formData.ragioneSociale = 'Nuova S.r.l.'
    component.formData.partitaIVA = PIVA_VALIDA
    component.formData.sedeLegale = {
      via: 'Via Milano',
      civico: '9',
      cap: '20121',
      comune: 'Milano',
      provincia: 'MI',
    }
  }

  it('ha la colonna "P.IVA / C.F." e mostra il codice fiscale di chi non ha la P.IVA', () => {
    const intestazioni = Array.from(el().querySelectorAll('th')).map(th => th.textContent?.trim())
    expect(intestazioni).toContain('P.IVA / C.F.')
    expect(tid('produttori-identificativo-r1')!.textContent).toContain(PIVA_CHECKSUM_ERRATO)
    expect(tid('produttori-identificativo-r2')!.textContent).toContain(CF_PERSONA)
  })

  it('segnala "Da verificare" solo sulla riga con la P.IVA da verificare', () => {
    expect(tid('produttori-da-verificare-r1')!.textContent).toContain('Da verificare')
    expect(tid('produttori-da-verificare-r2')).toBeNull()
  })

  it('il pulsante "Sedi (n)" mostra il numero di sedi e apre il dialog della ditta (clic reale)', () => {
    const bottone = tid('produttori-sedi-r1')!.querySelector('button') ?? tid('produttori-sedi-r1')!
    expect(bottone.textContent).toContain('Sedi (3)')
    expect(tid('produttori-sedi-r2')!.textContent).toContain('Sedi (1)')
    ;(bottone as HTMLElement).click()
    fixture.detectChanges()

    expect(registryService.getDitta).toHaveBeenCalledOnceWith('dit1')
    expect(document.querySelector('[data-testid="sedi-ditta-dialog"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Sedi di Ditta Uno S.r.l.')
  })

  it('in creazione senza alcun identificativo mostra "Indica la partita IVA o il codice fiscale." e non salva', () => {
    component.showCreateDialog()
    compila()
    component.formData.partitaIVA = ''

    component.saveProduttore()

    expect(registryService.createProduttore).not.toHaveBeenCalled()
    expect(component.erroriId.generale).toBe('Indica la partita IVA o il codice fiscale.')
  })

  it("una P.IVA con checksum errato (nome esplicito: non valida) è rifiutata prima dell'invio", () => {
    component.showCreateDialog()
    compila()
    component.formData.partitaIVA = PIVA_CHECKSUM_ERRATO

    component.saveProduttore()

    expect(registryService.createProduttore).not.toHaveBeenCalled()
    expect(component.erroriId.partitaIva).toContain('Partita IVA non valida')
  })

  it('un privato (solo codice fiscale) è ammesso e viene inviato senza partitaIVA', () => {
    component.showCreateDialog()
    compila()
    component.formData.partitaIVA = ''
    component.formData.codiceFiscale = CF_PERSONA

    component.saveProduttore()

    const inviato = registryService.createProduttore.calls.mostRecent().args[0]
    expect(inviato.codiceFiscale).toBe(CF_PERSONA)
    expect(inviato.partitaIVA).toBeUndefined()
  })

  it("D2.8: in modifica la P.IVA da verificare lasciata com'è non viene inviata né ri-validata", () => {
    component.editProduttore(RIGA)

    component.saveProduttore()

    const inviato = registryService.updateProduttore.calls.mostRecent().args[1]
    expect('partitaIVA' in inviato).toBeFalse()
    expect('codiceFiscale' in inviato).toBeFalse()
  })

  it('D2.8: in modifica la P.IVA da verificare sostituita con una valida viene inviata', () => {
    component.editProduttore(RIGA)
    component.formData.partitaIVA = PIVA_VALIDA

    component.saveProduttore()

    expect(registryService.updateProduttore.calls.mostRecent().args[1].partitaIVA).toBe(PIVA_VALIDA)
  })
})
