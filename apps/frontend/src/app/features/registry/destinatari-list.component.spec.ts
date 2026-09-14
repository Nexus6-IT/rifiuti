import { ComponentFixture, TestBed } from '@angular/core/testing'
import { NoopAnimationsModule } from '@angular/platform-browser/animations'
import { of } from 'rxjs'
import { MessageService, ConfirmationService } from 'primeng/api'
import { DestinatariListComponent } from './destinatari-list.component'
import { RegistryService } from './registry.service'
import { Destinatario } from '../../shared/models/registry.model'

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
    partitaIVA: '01234567890',
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
    component.formData.partitaIVA = '09876543210'
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
