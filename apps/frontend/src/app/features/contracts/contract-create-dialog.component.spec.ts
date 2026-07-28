import { ComponentFixture, TestBed } from '@angular/core/testing'
import { of, throwError } from 'rxjs'
import { ContractCreateDialogComponent } from './contract-create-dialog.component'
import { ContractsService } from './contracts.service'
import { ToastService } from '../../core/services/toast.service'
import { RegistryService } from '../registry/registry.service'
import { CerService } from '../cer/cer.service'

describe('ContractCreateDialogComponent', () => {
  let fixture: ComponentFixture<ContractCreateDialogComponent>
  let component: ContractCreateDialogComponent
  let contracts: jasmine.SpyObj<ContractsService>
  let toast: jasmine.SpyObj<ToastService>

  const vuoto = of({ items: [], total: 0, page: 1, limit: 10, totalPages: 0 } as any)

  beforeEach(() => {
    contracts = jasmine.createSpyObj<ContractsService>('ContractsService', ['create', 'nextNumber'])
    contracts.nextNumber.and.returnValue(of({ contractNumber: 'CTR-2026-004' }))
    contracts.create.and.returnValue(of({} as any))

    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn'])

    const registry = jasmine.createSpyObj<RegistryService>('RegistryService', [
      'getProduttori',
      'getTrasportatori',
      'getDestinatari',
    ])
    registry.getProduttori.and.returnValue(vuoto)
    registry.getTrasportatori.and.returnValue(vuoto)
    registry.getDestinatari.and.returnValue(vuoto)

    const cer = jasmine.createSpyObj<CerService>('CerService', ['searchCER'])
    cer.searchCER.and.returnValue(of([]))

    TestBed.configureTestingModule({
      imports: [ContractCreateDialogComponent],
      providers: [
        { provide: ContractsService, useValue: contracts },
        { provide: ToastService, useValue: toast },
        { provide: RegistryService, useValue: registry },
        { provide: CerService, useValue: cer },
      ],
    })

    fixture = TestBed.createComponent(ContractCreateDialogComponent)
    component = fixture.componentInstance
    fixture.detectChanges()
  })

  describe('registro della controparte dedotto dal tipo di contratto', () => {
    it('Trasporto pesca dai trasportatori', () => {
      component.onTipoContrattoCambiato('WASTE_TRANSPORT')
      expect(component.registroEffettivo()).toBe('trasportatori')
      expect(component.etichettaControparte()).toBe('Trasportatore')
    })

    it('Smaltimento pesca dai destinatari', () => {
      component.onTipoContrattoCambiato('WASTE_DISPOSAL')
      expect(component.registroEffettivo()).toBe('destinatari')
      expect(component.etichettaControparte()).toBe('Destinatario')
    })

    it('Servizio completo non implica un registro: va scelto a mano', () => {
      component.onTipoContrattoCambiato('FULL_SERVICE')

      expect(component.registroImplicito()).toBeNull()
      expect(component.registroEffettivo()).toBeNull()

      component.onRegistroScelto('destinatari')
      expect(component.registroEffettivo()).toBe('destinatari')
    })

    it('Accordo quadro si comporta come Servizio completo', () => {
      component.onTipoContrattoCambiato('FRAMEWORK')
      expect(component.registroImplicito()).toBeNull()
    })
  })

  describe('coerenza fra tipo e controparte già scelta', () => {
    it('azzera la controparte quando il registro cambia', () => {
      component.onTipoContrattoCambiato('WASTE_TRANSPORT')
      component.form.counterpartyId = 'trasportatore-1'

      component.onTipoContrattoCambiato('WASTE_DISPOSAL')

      expect(component.form.counterpartyId).toBe('')
    })

    it('NON azzera la controparte se il registro resta lo stesso', () => {
      component.onTipoContrattoCambiato('WASTE_TRANSPORT')
      component.form.counterpartyId = 'trasportatore-1'

      component.onTipoContrattoCambiato('WASTE_TRANSPORT')

      expect(component.form.counterpartyId).toBe('trasportatore-1')
    })

    it('azzera la controparte anche cambiando il registro scelto a mano', () => {
      component.onTipoContrattoCambiato('FRAMEWORK')
      component.onRegistroScelto('trasportatori')
      component.form.counterpartyId = 'trasportatore-1'

      component.onRegistroScelto('destinatari')

      expect(component.form.counterpartyId).toBe('')
    })

    it('tornando a un tipo che implica un registro, scarta la scelta manuale', () => {
      component.onTipoContrattoCambiato('FRAMEWORK')
      component.onRegistroScelto('destinatari')

      component.onTipoContrattoCambiato('WASTE_TRANSPORT')

      expect(component.registroScelto()).toBeNull()
      expect(component.registroEffettivo()).toBe('trasportatori')
    })
  })

  describe('numero contratto', () => {
    it("all'apertura arriva precompilato dal backend", () => {
      component.onVisibleChange(true)
      expect(component.form.contractNumber).toBe('CTR-2026-004')
    })

    it('se il backend non risponde il campo resta libero, senza bloccare', () => {
      contracts.nextNumber.and.returnValue(throwError(() => new Error('offline')))

      component.onVisibleChange(true)

      expect(component.form.contractNumber).toBe('')
      expect(toast.error).not.toHaveBeenCalled()
    })
  })

  describe('invio', () => {
    const compila = () => {
      component.onTipoContrattoCambiato('WASTE_TRANSPORT')
      component.form.contractNumber = 'CTR-2026-004'
      component.form.producerId = 'prod-1'
      component.form.counterpartyId = 'trasp-1'
      component.form.cerCodes = ['150101']
      component.startDate = new Date(2026, 0, 15)
    }

    it("deriva counterpartyType dal registro, senza chiederlo all'operatore", () => {
      compila()
      component.crea()

      expect(contracts.create).toHaveBeenCalled()
      const dto = contracts.create.calls.mostRecent().args[0]
      expect(dto.counterpartyType).toBe('TRANSPORTER')
      expect(dto.startDate).toBe('2026-01-15')
    })

    it('per un contratto di smaltimento manda DISPOSER', () => {
      compila()
      component.onTipoContrattoCambiato('WASTE_DISPOSAL')
      component.form.counterpartyId = 'dest-1'

      component.crea()

      expect(contracts.create.calls.mostRecent().args[0].counterpartyType).toBe('DISPOSER')
    })

    it('non invia se manca la controparte', () => {
      compila()
      component.form.counterpartyId = ''

      component.crea()

      expect(contracts.create).not.toHaveBeenCalled()
      expect(toast.warn).toHaveBeenCalled()
    })

    it('non invia se il registro non è ancora determinato', () => {
      compila()
      component.onTipoContrattoCambiato('FULL_SERVICE')
      component.form.counterpartyId = 'qualcuno'

      component.crea()

      expect(contracts.create).not.toHaveBeenCalled()
    })

    it('non invia senza codici CER', () => {
      compila()
      component.form.cerCodes = []

      component.crea()

      expect(contracts.create).not.toHaveBeenCalled()
    })
  })
})
