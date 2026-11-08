import { MessageService } from 'primeng/api'
import { signal } from '@angular/core'
import { AuthService } from '../../core/services/auth.service'
import { ComponentFixture, TestBed } from '@angular/core/testing'
import { By } from '@angular/platform-browser'
import { ConfirmationService } from 'primeng/api'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { HttpErrorResponse } from '@angular/common/http'
import { Subject, of, throwError } from 'rxjs'
import { ContractsListComponent } from './contracts-list.component'
import { ContractCreateDialogComponent } from './contract-create-dialog.component'
import { CAMPI_CONTRATTO, Contract, ContractsService } from './contracts.service'
import { ToastService } from '../../core/services/toast.service'
import { RegistryService } from '../registry/registry.service'
import { CerService } from '../cer/cer.service'
import { PaginatedResponse } from '../../shared/models/registry.model'
import { apriMenuRiga, chiudiMenuRiga, scegliVoceRiga } from '../clienti/tabelle/azioni-test-utils'

describe('ContractsListComponent — modifica ed eliminazione', () => {
  let fixture: ComponentFixture<ContractsListComponent>
  let component: ContractsListComponent
  let contracts: jasmine.SpyObj<ContractsService>
  let toast: jasmine.SpyObj<ToastService>

  const contratto = (over: Partial<Contract>): Contract =>
    ({
      id: 'id-x',
      tenantId: 't1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      contractNumber: 'CTR-X',
      producerId: 'p1',
      counterpartyId: 'c1',
      counterpartyType: 'TRANSPORTER',
      contractType: 'WASTE_TRANSPORT',
      description: null,
      cerCodes: ['150101'],
      pricingModel: 'FLAT_RATE',
      basePrice: '100',
      unitOfMeasure: 'kg',
      startDate: '2026-01-15T00:00:00.000Z',
      endDate: null,
      durationMonths: null,
      autoRenew: false,
      renewalNoticeDays: 60,
      paymentTerms: 'net_30',
      billingFrequency: 'monthly',
      status: 'DRAFT',
      versione: 3,
      modificabili: [...CAMPI_CONTRATTO],
      eliminabile: true,
      producer: null,
      counterparty: null,
      ...over,
    }) as Contract

  const bozza = contratto({ id: 'id-1', contractNumber: 'CTR-2026-001' })
  const inApprovazione = contratto({
    id: 'id-2',
    contractNumber: 'CTR-2026-002',
    status: 'PENDING_APPROVAL',
    modificabili: [],
  })
  const attivo = contratto({
    id: 'id-3',
    contractNumber: 'CTR-2026-003',
    status: 'ACTIVE',
    modificabili: ['basePrice'],
    eliminabile: false,
  })
  const cessato = contratto({
    id: 'id-4',
    contractNumber: 'CTR-2026-004',
    status: 'TERMINATED',
    modificabili: [],
    eliminabile: false,
  })

  const vuoto = <T>() =>
    of<PaginatedResponse<T>>({ items: [], total: 0, page: 1, limit: 10, totalPages: 0 })
  const errore = (status: number, body: unknown) =>
    throwError(() => new HttpErrorResponse({ status, error: body }))

  const pulsante = (etichetta: string) =>
    document.body.querySelector(`button[aria-label="${etichetta}"]`) as HTMLButtonElement | null

  const riga = (id: string) => document.body.querySelector(`[data-testid="contratti-riga-${id}"]`)!

  const caricate = () => contracts.list.calls.count()

  beforeEach(() => {
    contracts = jasmine.createSpyObj<ContractsService>('ContractsService', [
      'list',
      'getById',
      'elimina',
      'updateStatus',
      'nextNumber',
      'create',
      'update',
    ])
    contracts.list.and.returnValue(of([bozza, inApprovazione, attivo, cessato]))
    contracts.getById.and.returnValue(of(bozza))
    contracts.elimina.and.returnValue(of(undefined))
    contracts.nextNumber.and.returnValue(of({ contractNumber: 'CTR-2026-005' }))
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn', 'info'])

    const registry = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
    ])
    registry.getProduttori.and.returnValue(vuoto())
    registry.getTrasportatori.and.returnValue(vuoto())
    registry.getDestinatari.and.returnValue(vuoto())
    const cer = jasmine.createSpyObj<CerService>('CerService', ['searchCER'])
    cer.searchCER.and.returnValue(of([]))

    TestBed.configureTestingModule({
      imports: [ContractsListComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: ContractsService, useValue: contracts },
        { provide: ToastService, useValue: toast },
        { provide: RegistryService, useValue: registry },
        { provide: CerService, useValue: cer },
        { provide: AuthService, useValue: { currentUser: signal({ role: 'OPERATOR' }) } },
      ],
    })
    fixture = TestBed.createComponent(ContractsListComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  afterEach(() => chiudiMenuRiga())

  describe('pulsanti', () => {
    it('Modifica disabilitato se modificabili è vuoto, col tooltip del motivo', () => {
      expect(pulsante('Modifica il contratto CTR-2026-001')?.disabled).toBeFalse()
      expect(pulsante('Modifica il contratto CTR-2026-003')?.disabled).toBeFalse()
      expect(
        pulsante(
          'Modifica il contratto CTR-2026-002, non disponibile: Riporta il contratto in bozza per modificarlo'
        )?.disabled
      ).toBeTrue()
      expect(
        pulsante(
          'Modifica il contratto CTR-2026-004, non disponibile: Un contratto scaduto o cessato non si modifica'
        )?.disabled
      ).toBeTrue()
      expect(component.tooltipModifica(inApprovazione)).toBe(
        'Riporta il contratto in bozza per modificarlo'
      )
      expect(component.tooltipModifica(cessato)).toBe(
        'Un contratto scaduto o cessato non si modifica'
      )
      expect(component.tooltipModifica(contratto({ status: 'EXPIRED', modificabili: [] }))).toBe(
        'Un contratto scaduto o cessato non si modifica'
      )
      expect(component.tooltipModifica(bozza)).toBe('Modifica')
      expect(component.tooltipModifica(contratto({ status: 'SUSPENDED', modificabili: [] }))).toBe(
        'Questo contratto non si può modificare'
      )
    })

    it("il motivo di Modifica disabilitato è nell'etichetta accessibile (letto dal DOM)", () => {
      const dis = pulsante(
        'Modifica il contratto CTR-2026-002, non disponibile: Riporta il contratto in bozza per modificarlo'
      )
      expect(dis?.disabled).toBeTrue()
      const cessatoBtn = pulsante(
        'Modifica il contratto CTR-2026-004, non disponibile: Un contratto scaduto o cessato non si modifica'
      )
      expect(cessatoBtn?.disabled).toBeTrue()
      // abilitato: etichetta senza motivo
      expect(pulsante('Modifica il contratto CTR-2026-001')?.disabled).toBeFalse()
    })

    it('un click su Modifica disabilitato non chiama getById', () => {
      pulsante(
        'Modifica il contratto CTR-2026-002, non disponibile: Riporta il contratto in bozza per modificarlo'
      )!.click()
      fixture.detectChanges()
      expect(contracts.getById).not.toHaveBeenCalled()
    })

    it('Elimina compare nel menu ⋯ solo se eliminabile', async () => {
      expect(await apriMenuRiga(fixture, riga('id-1'))).toContain('Elimina')
      chiudiMenuRiga()
      expect(await apriMenuRiga(fixture, riga('id-2'))).toContain('Elimina')
      chiudiMenuRiga()
      expect(await apriMenuRiga(fixture, riga('id-3'))).not.toContain('Elimina')
      chiudiMenuRiga()
      expect(await apriMenuRiga(fixture, riga('id-4'))).not.toContain('Elimina')
    })

    it('Cambia stato apre il dialog del contratto; disabilitato senza transizioni', async () => {
      await scegliVoceRiga(fixture, riga('id-1'), 'Cambia stato')
      expect(component.displayStatus).toBeTrue()
      expect(component.selectedContract()?.id).toBe('id-1')
      component.displayStatus = false
      chiudiMenuRiga()
      const voci = await apriMenuRiga(fixture, riga('id-4'))
      expect(voci[0]).toContain('Non disponibile')
    })
  })

  describe('modifica', () => {
    it('apriModifica rilegge il contratto con getById prima di aprire il dialog', () => {
      const fresco = contratto({ id: 'id-1', contractNumber: 'CTR-2026-001', versione: 7 })
      contracts.getById.and.returnValue(of(fresco))
      pulsante('Modifica il contratto CTR-2026-001')!.click()
      fixture.detectChanges()
      expect(contracts.getById).toHaveBeenCalledOnceWith('id-1')
      expect(component.contrattoInModifica?.versione).toBe(7)
      expect(component.displayCreate).toBeTrue()
    })

    it('se nel frattempo non è più modificabile non apre il dialog e ricarica', () => {
      contracts.getById.and.returnValue(of(contratto({ id: 'id-1', modificabili: [] })))
      const prima = caricate()
      component.apriModifica(bozza)
      expect(component.displayCreate).toBeFalse()
      expect(toast.warn).toHaveBeenCalledWith('Il contratto non è più modificabile')
      expect(caricate()).toBe(prima + 1)
    })

    it('durante la rilettura il pulsante è disabilitato e un secondo click non rilegge', () => {
      const risposta = new Subject<Contract>()
      contracts.getById.and.returnValue(risposta)
      pulsante('Modifica il contratto CTR-2026-001')!.click()
      fixture.detectChanges()
      expect(pulsante('Modifica il contratto CTR-2026-001')?.disabled).toBeTrue()
      component.apriModifica(bozza)
      expect(contracts.getById).toHaveBeenCalledTimes(1)
      risposta.next(bozza)
      risposta.complete()
      fixture.detectChanges()
      expect(component.apriInCorso()).toBeNull()
      expect(component.displayCreate).toBeTrue()
    })

    it('getById 404: toast del backend e lista ricaricata', () => {
      contracts.getById.and.returnValue(errore(404, { message: 'Contratto non trovato' }))
      const prima = caricate()
      component.apriModifica(bozza)
      expect(toast.error).toHaveBeenCalledWith('Contratto non trovato')
      expect(caricate()).toBe(prima + 1)
      expect(component.apriInCorso()).toBeNull()
      expect(component.displayCreate).toBeFalse()
    })

    it('getById con altro errore: solo toast, nessun ricaricamento', () => {
      contracts.getById.and.returnValue(errore(500, {}))
      const prima = caricate()
      component.apriModifica(bozza)
      expect(toast.error).toHaveBeenCalledWith('Errore nel caricamento del contratto')
      expect(caricate()).toBe(prima)
    })

    it('Nuovo contratto apre il dialog in creazione (contratto null)', () => {
      component.contrattoInModifica = bozza
      component.apriCreazione()
      expect(component.contrattoInModifica).toBeNull()
      expect(component.displayCreate).toBeTrue()
    })

    it('dopo una modifica riuscita la lista si ricarica', () => {
      const prima = caricate()
      const dialog = fixture.debugElement.query(By.directive(ContractCreateDialogComponent))
      ;(dialog.componentInstance as ContractCreateDialogComponent).modificato.emit()
      expect(caricate()).toBe(prima + 1)
    })

    it('dopo il ricaricamento il contratto nel dialog resta lo stesso oggetto', () => {
      contracts.getById.and.returnValue(of(bozza))
      component.apriModifica(bozza)
      const aperto = component.contrattoInModifica
      component.loadContracts()
      fixture.detectChanges()
      expect(component.contrattoInModifica).toBe(aperto)
    })
  })

  describe('eliminazione', () => {
    const apriConferma = async () => {
      await scegliVoceRiga(fixture, riga('id-1'), 'Elimina')
    }
    const bottoneConferma = (classe: string) =>
      document.body.querySelector(`.p-confirm-dialog ${classe}`) as HTMLButtonElement | null

    it('chiede conferma col numero del contratto, senza id', async () => {
      await apriConferma()
      const testo = document.body.querySelector('.p-confirm-dialog-message')?.textContent ?? ''
      expect(testo).toContain('CTR-2026-001')
      expect(testo).not.toContain('id-1')
      expect(contracts.elimina).not.toHaveBeenCalled()
    })

    it('se confermata chiama elimina con la versione e ricarica la lista', async () => {
      await apriConferma()
      const prima = caricate()
      bottoneConferma('.p-confirm-dialog-accept')!.click()
      fixture.detectChanges()
      expect(contracts.elimina).toHaveBeenCalledOnceWith('id-1', 3)
      expect(toast.success).toHaveBeenCalledWith('Contratto eliminato')
      expect(caricate()).toBe(prima + 1)
    })

    it('il focus iniziale della conferma è su Annulla', async () => {
      const confirm = spyOn(
        fixture.debugElement.injector.get(ConfirmationService),
        'confirm'
      ).and.callThrough()
      await apriConferma()
      expect(confirm.calls.mostRecent().args[0].defaultFocus).toBe('reject')
    })

    it('durante la chiamata il cestino è disabilitato', async () => {
      const risposta = new Subject<void>()
      contracts.elimina.and.returnValue(risposta)
      await apriConferma()
      bottoneConferma('.p-confirm-dialog-accept')!.click()
      fixture.detectChanges()
      expect(component.eliminando()).toBe('id-1')
      await apriMenuRiga(fixture, riga('id-1'))
      const voceElimina = Array.from(
        document.body.querySelectorAll<HTMLElement>('.p-menu [role="menuitem"]')
      ).find(v => v.textContent?.trim().startsWith('Elimina'))!
      expect(
        voceElimina.getAttribute('aria-disabled') ?? voceElimina.getAttribute('data-p-disabled')
      ).toBe('true')
      risposta.next()
      risposta.complete()
      fixture.detectChanges()
      expect(component.eliminando()).toBeNull()
    })

    it('se annullata non chiama elimina', async () => {
      await apriConferma()
      bottoneConferma('.p-confirm-dialog-reject')!.click()
      fixture.detectChanges()
      expect(contracts.elimina).not.toHaveBeenCalled()
    })

    it('dopo un 409 mostra il messaggio del backend e ricarica la lista', async () => {
      contracts.elimina.and.returnValue(
        errore(409, {
          message: 'Il contratto è stato modificato nel frattempo.',
          error: 'CONTRATTO_MODIFICATO_NEL_FRATTEMPO',
        })
      )
      await apriConferma()
      const prima = caricate()
      bottoneConferma('.p-confirm-dialog-accept')!.click()
      fixture.detectChanges()
      expect(toast.error).toHaveBeenCalledWith('Il contratto è stato modificato nel frattempo.')
      expect(caricate()).toBe(prima + 1)
    })

    it('dopo un 404 ricarica la lista', async () => {
      contracts.elimina.and.returnValue(errore(404, { message: 'Contratto non trovato' }))
      await apriConferma()
      const prima = caricate()
      bottoneConferma('.p-confirm-dialog-accept')!.click()
      fixture.detectChanges()
      expect(toast.error).toHaveBeenCalledWith('Contratto non trovato')
      expect(caricate()).toBe(prima + 1)
    })

    describe('cambio stato', () => {
      const conferma = (err: unknown) => {
        contracts.updateStatus.and.returnValue(err as never)
        component.openStatusDialog(bozza)
        component.targetStatus = 'PENDING_APPROVAL'
        const prima = caricate()
        component.confirmStatusChange()
        return prima
      }

      it('409: mostra il messaggio del backend e ricarica la lista', () => {
        const prima = conferma(
          errore(409, { message: 'Transizione non ammessa.', error: 'CONTRATTO_TRANSIZIONE' })
        )
        expect(toast.error).toHaveBeenCalledWith('Transizione non ammessa.')
        expect(caricate()).toBe(prima + 1)
        expect(component.changingStatus()).toBeFalse()
      })

      it('404: ricarica la lista', () => {
        const prima = conferma(errore(404, { message: 'Contratto non trovato' }))
        expect(toast.error).toHaveBeenCalledWith('Contratto non trovato')
        expect(caricate()).toBe(prima + 1)
      })

      it('altro errore: solo toast, nessun ricaricamento', () => {
        const prima = conferma(errore(500, { message: 'Errore interno' }))
        expect(toast.error).toHaveBeenCalled()
        expect(caricate()).toBe(prima)
      })
    })
  })
})
