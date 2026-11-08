import { ComponentFixture, TestBed } from '@angular/core/testing'
import { scriviCampoData } from '../../shared/testing/campo-data'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { MessageService, ConfirmationService } from 'primeng/api'
import { DestinatariListComponent } from './destinatari-list.component'
import { apriMenuRiga, chiudiMenuRiga, scegliVoceRiga } from '../clienti/tabelle/azioni-test-utils'
import { RegistryService } from './registry.service'
import { AuthService } from '../../core/services/auth.service'
import { Destinatario } from '../../shared/models/registry.model'

// P.IVA con checksum valido (la validazione gemella del backend rifiuta le altre)
const PIVA_VALIDA = '12345678903'
const PIVA_CHECKSUM_ERRATO = '12345678901' // non supera il controllo di validità
const PIVA_VALIDA_2 = '09876543217'

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
 * TDD per il difetto del 2026-09-14: la pagina /destinatari (questo
 * componente, l'unico instradato da app.routes.ts) non aveva alcun modo di
 * impostare la data di scadenza dell'autorizzazione. Il campo esisteva solo
 * nel dialog condiviso `anagrafica-form-dialog.component.ts`, montato però
 * unicamente dentro il flusso "Nuovo FIR" — un percorso che quasi nessun
 * operatore di rubrica attraversa. Per tutte le anagrafiche gestite da qui,
 * l'avviso di scadenza non sarebbe mai potuto scattare.
 */
describe('DestinatariListComponent — data di scadenza autorizzazione (facoltativa)', () => {
  let fixture: ComponentFixture<DestinatariListComponent>
  let component: DestinatariListComponent
  let registryService: jasmine.SpyObj<RegistryService>

  const DESTINATARIO_ESISTENTE: Destinatario = {
    id: 'd1',
    ragioneSociale: 'Impianto Verdi S.r.l.',
    partitaIVA: PIVA_VALIDA,
    sede: { via: 'Via Torino', civico: '5', cap: '10100', comune: 'Torino', provincia: 'TO' },
    numeroAutorizzazione: 'AUT/2024/001',
    pec: 'impianto@pec.it',
    scadenzaAutorizzazione: '2027-03-15',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    registryService = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getDestinatari',
      'createDestinatario',
      'updateDestinatario',
      'deleteDestinatario',
    ])
    registryService.getDestinatari.and.returnValue(
      of({ items: [DESTINATARIO_ESISTENTE], total: 1, page: 1, limit: 10, totalPages: 1 })
    )
    registryService.createDestinatario.and.returnValue(of(DESTINATARIO_ESISTENTE))
    registryService.updateDestinatario.and.returnValue(of(DESTINATARIO_ESISTENTE))

    TestBed.configureTestingModule({
      imports: [DestinatariListComponent, NoopAnimationsModule],
      providers: [
        { provide: RegistryService, useValue: registryService },
        { provide: AuthService, useValue: authServiceStub() },
        MessageService,
        ConfirmationService,
      ],
    })

    fixture = TestBed.createComponent(DestinatariListComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  function compilaCampiObbligatori(): void {
    component.formData.ragioneSociale = 'Nuovo Impianto S.r.l.'
    component.formData.partitaIVA = PIVA_VALIDA_2
    component.formData.numeroAutorizzazione = 'AUT/2025/999'
    component.formData.sede = {
      via: 'Via Genova',
      civico: '9',
      cap: '16100',
      comune: 'Genova',
      provincia: 'GE',
    }
  }

  it('in creazione, con scadenza compilata, la invia al servizio nel formato atteso', () => {
    component.showCreateDialog()
    compilaCampiObbligatori()
    component.formData.scadenzaAutorizzazione = '2028-01-31'

    component.saveDestinatario()

    expect(registryService.createDestinatario).toHaveBeenCalledWith(
      jasmine.objectContaining({ scadenzaAutorizzazione: '2028-01-31' })
    )
  })

  it('in creazione, senza scadenza, NON la invia come stringa vuota (le anagrafiche esistenti non hanno il dato)', () => {
    component.showCreateDialog()
    compilaCampiObbligatori()
    // formData.scadenzaAutorizzazione resta quello di default (vuoto)

    component.saveDestinatario()

    const inviato = registryService.createDestinatario.calls.mostRecent().args[0]
    expect(inviato.scadenzaAutorizzazione).toBeUndefined()
  })

  it('la scadenza e un calendario in italiano: la data scritta arriva al form come AAAA-MM-GG', async () => {
    component.editDestinatario(DESTINATARIO_ESISTENTE)
    fixture.detectChanges()
    // Due livelli di ngModel (il form e il calendario dentro il campo): due giri.
    await fixture.whenStable()
    fixture.detectChanges()
    await fixture.whenStable()
    fixture.detectChanges()
    expect(document.body.querySelector('input[type="date"]')).toBeNull()
    expect(document.querySelector('label[for="dest-scad-autorizzazione"]')).not.toBeNull()
    const campo = document.getElementById('dest-scad-autorizzazione') as HTMLInputElement
    expect(campo.value).toBe('15/03/2027')
    scriviCampoData(campo, '2028-01-31')
    expect(component.formData.scadenzaAutorizzazione).toBe('2028-01-31')
    scriviCampoData(campo, '')
    expect(component.formData.scadenzaAutorizzazione).toBe('')
  })

  it('in modifica, precompila il campo con la scadenza esistente', () => {
    component.editDestinatario(DESTINATARIO_ESISTENTE)

    expect(component.formData.scadenzaAutorizzazione).toBe('2027-03-15')
  })

  it("in modifica, svuotando il campo l'azzeramento arriva al servizio come null, non come stringa vuota", () => {
    component.editDestinatario(DESTINATARIO_ESISTENTE)
    component.formData.scadenzaAutorizzazione = ''

    component.saveDestinatario()

    const inviato = registryService.updateDestinatario.calls.mostRecent().args[1]
    expect(inviato.scadenzaAutorizzazione).toBeNull()
  })

  it('in modifica, con una nuova scadenza compilata la invia al servizio', () => {
    component.editDestinatario(DESTINATARIO_ESISTENTE)
    component.formData.scadenzaAutorizzazione = '2029-06-30'

    component.saveDestinatario()

    const inviato = registryService.updateDestinatario.calls.mostRecent().args[1]
    expect(inviato.scadenzaAutorizzazione).toBe('2029-06-30')
  })
})

/**
 * TDD per il difetto CRITICO del 2026-09-14: `UpdateDestinatarioDto` non
 * dichiara `partitaIVA` e il backend ha `forbidNonWhitelisted: true`, quindi
 * ogni PUT che la include riceve 400. Il payload di modifica NON deve
 * contenere quel campo. `jasmine.objectContaining` non basta: ignora i campi
 * in più, quindi qui si asserisce la forma ESATTA dell'oggetto inviato.
 */
describe('DestinatariListComponent — payload di modifica senza partitaIVA (bug produzione)', () => {
  let fixture: ComponentFixture<DestinatariListComponent>
  let component: DestinatariListComponent
  let registryService: jasmine.SpyObj<RegistryService>

  const DESTINATARIO_ESISTENTE: Destinatario = {
    id: 'd1',
    ragioneSociale: 'Impianto Verdi S.r.l.',
    partitaIVA: PIVA_VALIDA,
    sede: { via: 'Via Torino', civico: '5', cap: '10100', comune: 'Torino', provincia: 'TO' },
    numeroAutorizzazione: 'AUT/2024/001',
    pec: 'impianto@pec.it',
    scadenzaAutorizzazione: '2027-03-15',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    registryService = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getDestinatari',
      'createDestinatario',
      'updateDestinatario',
      'deleteDestinatario',
    ])
    registryService.getDestinatari.and.returnValue(
      of({ items: [DESTINATARIO_ESISTENTE], total: 1, page: 1, limit: 10, totalPages: 1 })
    )
    registryService.updateDestinatario.and.returnValue(of(DESTINATARIO_ESISTENTE))

    TestBed.configureTestingModule({
      imports: [DestinatariListComponent, NoopAnimationsModule],
      providers: [
        { provide: RegistryService, useValue: registryService },
        { provide: AuthService, useValue: authServiceStub() },
        MessageService,
        ConfirmationService,
      ],
    })

    fixture = TestBed.createComponent(DestinatariListComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  it('il payload PUT ha esattamente i campi accettati da UpdateDestinatarioDto, mai partitaIVA', () => {
    component.editDestinatario(DESTINATARIO_ESISTENTE)
    component.formData.ragioneSociale = 'Impianto Verdi S.r.l. (aggiornato)'

    component.saveDestinatario()

    const inviato = registryService.updateDestinatario.calls.mostRecent().args[1]
    expect(inviato).toEqual({
      ragioneSociale: 'Impianto Verdi S.r.l. (aggiornato)',
      sede: DESTINATARIO_ESISTENTE.sede,
      numeroAutorizzazione: DESTINATARIO_ESISTENTE.numeroAutorizzazione,
      pec: DESTINATARIO_ESISTENTE.pec,
      scadenzaAutorizzazione: DESTINATARIO_ESISTENTE.scadenzaAutorizzazione,
    })
    expect(Object.prototype.hasOwnProperty.call(inviato, 'partitaIVA')).toBeFalse()
  })

  it('il campo Partita IVA è disabilitato nel form di modifica', async () => {
    component.editDestinatario(DESTINATARIO_ESISTENTE)
    fixture.detectChanges()
    // NgModel applica lo stato disabled al FormControl dentro un microtask
    // (`resolvedPromise.then`, vedi @angular/forms `NgModel._updateDisabled`):
    // serve attendere quel giro prima di rileggere il DOM.
    await Promise.resolve()
    fixture.detectChanges()

    const input = fixture.nativeElement.querySelector(
      '[data-testid="destinatari-piva-input"]'
    ) as HTMLInputElement
    expect(input.disabled).toBeTrue()
  })
})

/**
 * TDD per il rilievo N3: un VIEWER vede «Nuovo destinatario», compila tutto
 * e riceve un 403 generico al salvataggio — RegistryController protegge
 * POST/PUT/DELETE destinatari con @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR'),
 * un VIEWER non c'è. Stesso schema di `fir-list.component.ts` (`puoCreareFir`).
 */
describe('DestinatariListComponent — gating dei pulsanti in base al ruolo (VIEWER)', () => {
  let fixture: ComponentFixture<DestinatariListComponent>

  const DESTINATARIO_ESISTENTE: Destinatario = {
    id: 'd1',
    ragioneSociale: 'Impianto Verdi S.r.l.',
    partitaIVA: PIVA_VALIDA,
    sede: { via: 'Via Torino', civico: '5', cap: '10100', comune: 'Torino', provincia: 'TO' },
    numeroAutorizzazione: 'AUT/2024/001',
    pec: 'impianto@pec.it',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }

  function creaComponente(role: string): void {
    const registryService = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getDestinatari',
      'createDestinatario',
      'updateDestinatario',
      'deleteDestinatario',
    ])
    registryService.getDestinatari.and.returnValue(
      of({ items: [DESTINATARIO_ESISTENTE], total: 1, page: 1, limit: 10, totalPages: 1 })
    )

    TestBed.configureTestingModule({
      imports: [DestinatariListComponent, NoopAnimationsModule],
      providers: [
        { provide: RegistryService, useValue: registryService },
        { provide: AuthService, useValue: authServiceStub(role) },
        MessageService,
        ConfirmationService,
      ],
    })

    fixture = TestBed.createComponent(DestinatariListComponent)
    fixture.detectChanges()
  }

  it('un VIEWER non vede il pulsante "Nuovo destinatario"', () => {
    creaComponente('VIEWER')

    const bottone = fixture.nativeElement.querySelector('[data-testid="destinatari-nuovo-button"]')
    expect(bottone).toBeNull()
  })

  it('un VIEWER non vede le azioni Modifica/Elimina sulla riga', () => {
    creaComponente('VIEWER')

    expect(fixture.nativeElement.querySelector('[data-testid="destinatari-azioni-d1"]')).toBeNull()
    expect(fixture.nativeElement.querySelector('[data-testid="destinatari-elimina-d1"]')).toBeNull()
  })

  it('un OPERATOR vede sia "Nuovo destinatario" sia le azioni sulla riga', () => {
    creaComponente('OPERATOR')

    expect(
      fixture.nativeElement.querySelector('[data-testid="destinatari-nuovo-button"]')
    ).toBeTruthy()
    expect(
      fixture.nativeElement.querySelector('[data-testid="destinatari-azioni-d1"]')
    ).toBeTruthy()
  })
})

/**
 * Codice fiscale, ditta e sedi nella lista (F2-10): colonna "P.IVA / C.F.", badge "Da verificare",
 * pulsante "Sedi (n)" e validazione gemella del backend nel form.
 */
describe('DestinatariListComponent — ditte, codice fiscale e sedi', () => {
  let fixture: ComponentFixture<DestinatariListComponent>
  let component: DestinatariListComponent
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
    numeroAutorizzazione: 'AUT/1',
    sede: { via: 'Via Torino', civico: '5', cap: '10100', comune: 'Torino', provincia: 'TO' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as Destinatario
  const RIGA_PRIVATO = {
    ...RIGA,
    id: 'r2',
    partitaIVA: null,
    codiceFiscale: CF_PERSONA,
    partitaIvaDaVerificare: false,
    numeroSedi: 1,
  } as unknown as Destinatario

  beforeEach(() => {
    registryService = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getDestinatari',
      'createDestinatario',
      'updateDestinatario',
      'cercaDitta',
      'getDitta',
    ])
    registryService.getDestinatari.and.returnValue(
      of({ items: [RIGA, RIGA_PRIVATO], total: 2, page: 1, limit: 10, totalPages: 1 })
    )
    registryService.createDestinatario.and.returnValue(of(RIGA))
    registryService.updateDestinatario.and.returnValue(of(RIGA))
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
      imports: [DestinatariListComponent, NoopAnimationsModule],
      providers: [
        { provide: RegistryService, useValue: registryService },
        { provide: AuthService, useValue: authServiceStub() },
        MessageService,
        ConfirmationService,
      ],
    })
    fixture = TestBed.createComponent(DestinatariListComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  afterEach(() => {
    fixture.destroy()
    chiudiMenuRiga()
    document.querySelectorAll('.p-dialog-mask').forEach(e => e.remove())
  })

  const el = () => fixture.nativeElement as HTMLElement
  const tid = (id: string) => el().querySelector(`[data-testid="${id}"]`) as HTMLElement | null

  function compila(): void {
    component.formData.ragioneSociale = 'Nuova S.r.l.'
    component.formData.partitaIVA = PIVA_VALIDA
    component.formData.numeroAutorizzazione = 'AUT/9'
    component.formData.sede = {
      via: 'Via Milano',
      civico: '9',
      cap: '20121',
      comune: 'Milano',
      provincia: 'MI',
    }
  }

  it('onSedeScelta precompila anche la PEC della sede scelta e "Nuova sede" la svuota', () => {
    const sede = {
      id: 's1',
      denominazione: null,
      via: 'Via Po',
      civico: '3',
      cap: '10100',
      citta: 'Torino',
      provincia: 'TO',
      referente: null,
      email: null,
      telefono: null,
      pec: 'sede@pec.it',
      principale: true,
      attiva: true,
    }
    component.onSedeScelta(sede)
    expect(component.formData.sede.via).toBe('Via Po')
    expect(component.formData.pec).toBe('sede@pec.it')
    component.onSedeScelta(null)
    expect(component.formData.pec).toBe('')
  })

  it('ha la colonna "P.IVA / C.F." e mostra il codice fiscale di chi non ha la P.IVA', () => {
    const intestazioni = Array.from(el().querySelectorAll('th')).map(th => th.textContent?.trim())
    expect(intestazioni).toContain('P.IVA / C.F.')
    expect(tid('destinatari-identificativo-r1')!.textContent).toContain(PIVA_CHECKSUM_ERRATO)
    expect(tid('destinatari-identificativo-r2')!.textContent).toContain(CF_PERSONA)
  })

  it('segnala "Da verificare" solo sulla riga con la P.IVA da verificare', () => {
    expect(tid('destinatari-da-verificare-r1')!.textContent).toContain('Da verificare')
    expect(tid('destinatari-da-verificare-r2')).toBeNull()
  })

  it('«Sedi (n)» sta nel menu ⋯ con il numero di sedi e apre il dialog della ditta (clic reale)', async () => {
    expect(await apriMenuRiga(fixture, tid('destinatari-row-r1')!)).toContain('Sedi (3)')
    chiudiMenuRiga()
    expect(await apriMenuRiga(fixture, tid('destinatari-row-r2')!)).toContain('Sedi (1)')
    chiudiMenuRiga()
    await scegliVoceRiga(fixture, tid('destinatari-row-r1')!, 'Sedi')

    expect(registryService.getDitta).toHaveBeenCalledOnceWith('dit1')
    expect(document.querySelector('[data-testid="sedi-ditta-dialog"]')).toBeTruthy()
    expect(document.body.textContent).toContain('Sedi di Ditta Uno S.r.l.')
  })

  it('in creazione senza alcun identificativo mostra "Indica la partita IVA o il codice fiscale." e non salva', () => {
    component.showCreateDialog()
    compila()
    component.formData.partitaIVA = ''

    component.saveDestinatario()

    expect(registryService.createDestinatario).not.toHaveBeenCalled()
    expect(component.erroriId.generale).toBe('Indica la partita IVA o il codice fiscale.')
  })

  it("una P.IVA con checksum errato (nome esplicito: non valida) è rifiutata prima dell'invio", () => {
    component.showCreateDialog()
    compila()
    component.formData.partitaIVA = PIVA_CHECKSUM_ERRATO

    component.saveDestinatario()

    expect(registryService.createDestinatario).not.toHaveBeenCalled()
    expect(component.erroriId.partitaIva).toContain('Partita IVA non valida')
  })

  it('un privato (solo codice fiscale di persona) è rifiutato: può essere solo produttore', () => {
    component.showCreateDialog()
    compila()
    component.formData.partitaIVA = ''
    component.formData.codiceFiscale = CF_PERSONA

    component.saveDestinatario()

    expect(registryService.createDestinatario).not.toHaveBeenCalled()
    expect(component.erroriId.codiceFiscale).toBe(
      'Un privato senza partita IVA può essere solo produttore o cliente.'
    )
  })

  it("D2.8: in modifica la P.IVA da verificare lasciata com'è non viene inviata né ri-validata", () => {
    component.editDestinatario(RIGA)

    component.saveDestinatario()

    const inviato = registryService.updateDestinatario.calls.mostRecent().args[1]
    expect('partitaIVA' in inviato).toBeFalse()
    expect('codiceFiscale' in inviato).toBeFalse()
  })

  it('D2.8: in modifica la P.IVA da verificare sostituita con una valida viene inviata', () => {
    component.editDestinatario(RIGA)
    component.formData.partitaIVA = PIVA_VALIDA

    component.saveDestinatario()

    expect(registryService.updateDestinatario.calls.mostRecent().args[1].partitaIVA).toBe(
      PIVA_VALIDA
    )
  })
})
