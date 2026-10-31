import { ComponentFixture, TestBed } from '@angular/core/testing'
import { provideNoopAnimations } from '@angular/platform-browser/animations'
import { of, throwError } from 'rxjs'
import { HttpErrorResponse } from '@angular/common/http'
import { ContractCreateDialogComponent } from './contract-create-dialog.component'
import { CAMPI_CONTRATTO, CampoContratto, Contract, ContractsService } from './contracts.service'
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
    contracts = jasmine.createSpyObj<ContractsService>('ContractsService', [
      'create',
      'nextNumber',
      'update',
    ])
    contracts.nextNumber.and.returnValue(of({ contractNumber: 'CTR-2026-004' }))
    contracts.create.and.returnValue(of({} as any))
    contracts.update.and.returnValue(of({} as any))

    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'warn', 'info'])

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
        provideNoopAnimations(),
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
    it('in creazione aria-describedby punta al suggerimento "Proposto in automatico"', () => {
      component.onVisibleChange(true)
      fixture.detectChanges()
      const campi = document.body.querySelectorAll('#c-number')
      expect(campi[campi.length - 1].getAttribute('aria-describedby')).toBe('c-number-hint')
      expect(document.body.querySelector('#c-number-hint')).not.toBeNull()
    })

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

  // ─── Modifica (Fase 4 pezzo 0) ────────────────────────────────────────────
  describe('modifica', () => {
    const TUTTI: CampoContratto[] = [...CAMPI_CONTRATTO]
    const TERMINI: CampoContratto[] = [
      'description',
      'cerCodes',
      'pricingModel',
      'basePrice',
      'unitOfMeasure',
      'endDate',
      'durationMonths',
      'autoRenew',
      'renewalNoticeDays',
      'paymentTerms',
      'billingFrequency',
    ]
    const contratto = (over: Partial<Contract> = {}): Contract =>
      ({
        id: 'k1',
        tenantId: 't1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        contractNumber: 'CTR-2026-001',
        producerId: 'prod-1',
        counterpartyId: 'trasp-1',
        counterpartyType: 'TRANSPORTER',
        contractType: 'WASTE_TRANSPORT',
        description: null,
        cerCodes: ['150101', '150102'],
        pricingModel: 'FLAT_RATE',
        basePrice: '120',
        unitOfMeasure: 'kg',
        startDate: '2026-01-15T00:00:00.000Z',
        endDate: '2026-12-31T00:00:00.000Z',
        durationMonths: null,
        autoRenew: false,
        renewalNoticeDays: 60,
        paymentTerms: 'net_30',
        billingFrequency: 'monthly',
        status: 'DRAFT',
        versione: 4,
        modificabili: TUTTI,
        eliminabile: true,
        ...over,
      }) as Contract

    const apri = (c: Contract) => {
      component.contratto = c
      component.onVisibleChange(true)
      fixture.detectChanges()
    }
    const errore = (status: number, body: unknown) =>
      throwError(() => new HttpErrorResponse({ status, error: body }))

    it('con un contratto in ingresso il titolo è "Modifica contratto" e il form è precompilato', () => {
      apri(contratto())
      expect(component.contratto).not.toBeNull()
      expect(component.form.contractNumber).toBe('CTR-2026-001')
      expect(component.form.contractType).toBe('WASTE_TRANSPORT')
      expect(component.form.producerId).toBe('prod-1')
      expect(component.form.counterpartyId).toBe('trasp-1')
      expect(component.form.cerCodes).toEqual(['150101', '150102'])
      expect(component.form.basePrice).toBe(120)
      expect(component.startDate).toEqual(new Date(2026, 0, 15))
      expect(component.endDate).toEqual(new Date(2026, 11, 31))
      expect(component.registroEffettivo()).toBe('trasportatori')
      // Altri spec possono lasciare dialog nel body: si cerca fra tutte le intestazioni
      const titoli = Array.from(document.body.querySelectorAll('.p-dialog-title')).map(
        t => t.textContent
      )
      expect(titoli.some(t => t?.includes('Modifica contratto'))).toBeTrue()
    })

    it('registro dedotto da counterpartyType anche per un tipo senza registro implicito', () => {
      apri(contratto({ contractType: 'FRAMEWORK', counterpartyType: 'DISPOSER' }))
      expect(component.registroEffettivo()).toBe('destinatari')
    })

    it('in modifica non chiede il prossimo numero', () => {
      contracts.nextNumber.calls.reset()
      apri(contratto())
      expect(contracts.nextNumber).not.toHaveBeenCalled()
    })

    it('si apre anche con visible impostato dal padre', () => {
      contracts.nextNumber.calls.reset()
      component.contratto = contratto({ contractNumber: 'CTR-X' })
      fixture.componentRef.setInput('visible', true)
      fixture.detectChanges()
      expect(component.form.contractNumber).toBe('CTR-X')
      expect(contracts.nextNumber).not.toHaveBeenCalled()
    })

    it('contratto attivo: produttore, controparte, tipo, numero e data di inizio disabilitati', async () => {
      apri(contratto({ status: 'ACTIVE', modificabili: TERMINI, eliminabile: false }))
      for (const c of [
        'contractNumber',
        'producerId',
        'counterpartyId',
        'counterpartyType',
        'contractType',
        'startDate',
      ] as CampoContratto[]) {
        expect(component.campoBloccato(c)).withContext(c).toBeTrue()
      }
      for (const c of TERMINI) expect(component.campoBloccato(c)).withContext(c).toBeFalse()
      // NgModel applica `disabled` in un microtask
      await fixture.whenStable()
      fixture.detectChanges()
      const numero = document.body.querySelector('#c-number') as HTMLInputElement
      expect(numero.disabled).toBeTrue()
      const prezzo = document.body.querySelector('#c-uom') as HTMLInputElement
      expect(prezzo.disabled).toBeFalse()
      expect(document.body.querySelector('[data-testid="c-bloccati"]')).not.toBeNull()
    })

    it('in creazione nessun campo è bloccato', () => {
      expect(component.campoBloccato('contractNumber')).toBeFalse()
    })

    it('salva in modifica manda solo i campi cambiati più la versione', () => {
      apri(contratto())
      component.form.basePrice = 130
      component.salva()
      expect(contracts.create).not.toHaveBeenCalled()
      expect(contracts.update).toHaveBeenCalledOnceWith('k1', { basePrice: 130, versione: 4 })
      expect(toast.success).toHaveBeenCalled()
    })

    it('togliere la data di fine manda endDate null', () => {
      apri(contratto())
      component.endDate = null
      component.salva()
      expect(contracts.update).toHaveBeenCalledOnceWith('k1', { endDate: null, versione: 4 })
    })

    it('CER in altro ordine o descrizione vuota contro null non sono cambiamenti', () => {
      apri(contratto())
      component.form.cerCodes = ['150102', '150101']
      component.form.description = '  '
      component.form.contractNumber = ' CTR-2026-001 '
      component.salva()
      expect(contracts.update).not.toHaveBeenCalled()
    })

    it('CER nel formato del multi-select ("15 01 01", "16 06 01*") finiscono nel corpo così come sono', () => {
      apri(contratto())
      component.form.cerCodes = ['16 06 01*', '15 01 01']
      component.salva()
      expect(contracts.update).toHaveBeenCalledOnceWith('k1', {
        cerCodes: ['15 01 01', '16 06 01*'],
        versione: 4,
      })
    })

    it('preavviso svuotato con il rinnovo automatico: errore di validazione, nessun invio', () => {
      apri(contratto({ autoRenew: true, renewalNoticeDays: 30 }))
      component.form.renewalNoticeDays = null as unknown as number
      component.salva()
      expect(contracts.update).not.toHaveBeenCalled()
      expect(toast.warn).toHaveBeenCalledWith('Compila tutti i campi obbligatori')
    })

    it('preavviso 0 esplicito è valido e viene inviato', () => {
      apri(contratto({ autoRenew: true, renewalNoticeDays: 30 }))
      component.form.renewalNoticeDays = 0
      component.salva()
      expect(contracts.update).toHaveBeenCalledOnceWith('k1', {
        renewalNoticeDays: 0,
        versione: 4,
      })
    })

    it('nessun cambiamento: non chiama update e chiude con un avviso', () => {
      apri(contratto())
      const chiuso = spyOn(component.visibleChange, 'emit')
      component.salva()
      expect(contracts.update).not.toHaveBeenCalled()
      expect(toast.info).toHaveBeenCalledWith('Nessuna modifica da salvare')
      expect(chiuso).toHaveBeenCalledWith(false)
    })

    it('409 CONTRATTO_MODIFICATO_NEL_FRATTEMPO: toast col messaggio del backend ed emette modificato', () => {
      apri(contratto())
      component.form.basePrice = 130
      contracts.update.and.returnValue(
        errore(409, {
          message: 'Il contratto è stato modificato nel frattempo.',
          error: 'CONTRATTO_MODIFICATO_NEL_FRATTEMPO',
        })
      )
      const emesso = spyOn(component.modificato, 'emit')
      const chiuso = spyOn(component.visibleChange, 'emit')
      component.salva()
      expect(toast.error).toHaveBeenCalledWith('Il contratto è stato modificato nel frattempo.')
      expect(emesso).toHaveBeenCalled()
      expect(chiuso).toHaveBeenCalledWith(false)
    })

    it('409 CONTRATTO_NON_MODIFICABILE per stato: ricarica e chiude', () => {
      apri(contratto())
      component.form.basePrice = 130
      contracts.update.and.returnValue(
        errore(409, {
          message: 'Un contratto cessato non si modifica.',
          error: 'CONTRATTO_NON_MODIFICABILE',
        })
      )
      const emesso = spyOn(component.modificato, 'emit')
      const chiuso = spyOn(component.visibleChange, 'emit')
      component.salva()
      expect(emesso).toHaveBeenCalled()
      expect(chiuso).toHaveBeenCalledWith(false)
    })

    it('409 CONTRATTO_CAMPI_NON_AMMESSI: dialog resta aperto (decide il solo codice)', () => {
      apri(contratto())
      component.form.basePrice = 130
      contracts.update.and.returnValue(
        errore(409, {
          message: 'In un contratto attivo o sospeso non si possono cambiare: Produttore.',
          error: 'CONTRATTO_CAMPI_NON_AMMESSI',
        })
      )
      const emesso = spyOn(component.modificato, 'emit')
      const chiuso = spyOn(component.visibleChange, 'emit')
      component.salva()
      expect(toast.error).toHaveBeenCalledWith(
        'In un contratto attivo o sospeso non si possono cambiare: Produttore.'
      )
      expect(emesso).not.toHaveBeenCalled()
      expect(chiuso).not.toHaveBeenCalled()
    })

    it('il testo del messaggio non conta: stesso testo, codice CONTRATTO_NON_MODIFICABILE chiude', () => {
      apri(contratto())
      component.form.basePrice = 130
      contracts.update.and.returnValue(
        errore(409, { message: 'Testo qualsiasi.', error: 'CONTRATTO_NON_MODIFICABILE' })
      )
      const chiuso = spyOn(component.visibleChange, 'emit')
      component.salva()
      expect(chiuso).toHaveBeenCalledWith(false)
    })

    it('409 numero duplicato: dialog resta aperto', () => {
      apri(contratto())
      component.form.contractNumber = 'CTR-2026-009'
      contracts.update.and.returnValue(
        errore(409, {
          message: 'Esiste già un contratto con questo numero.',
          error: 'CONTRATTO_NUMERO_DUPLICATO',
        })
      )
      const emesso = spyOn(component.modificato, 'emit')
      const chiuso = spyOn(component.visibleChange, 'emit')
      component.salva()
      expect(toast.error).toHaveBeenCalledWith('Esiste già un contratto con questo numero.')
      expect(emesso).not.toHaveBeenCalled()
      expect(chiuso).not.toHaveBeenCalled()
      expect(component.saving()).toBeFalse()
    })

    it('404: ricarica e chiude', () => {
      apri(contratto())
      component.form.basePrice = 130
      contracts.update.and.returnValue(errore(404, { message: 'Contratto non trovato' }))
      const emesso = spyOn(component.modificato, 'emit')
      const chiuso = spyOn(component.visibleChange, 'emit')
      component.salva()
      expect(toast.error).toHaveBeenCalledWith('Contratto non trovato')
      expect(emesso).toHaveBeenCalled()
      expect(chiuso).toHaveBeenCalledWith(false)
    })

    it('contratto attivo con counterpartyType storico incoerente: nessun errore di campi, corpo senza counterpartyType', () => {
      apri(
        contratto({
          status: 'ACTIVE',
          modificabili: TERMINI,
          eliminabile: false,
          contractType: 'WASTE_TRANSPORT',
          counterpartyType: 'DISPOSER',
        })
      )
      // il registro dedotto dal tipo (trasportatori) non coincide con counterpartyType
      component.form.basePrice = 150
      component.salva()
      expect(toast.warn).not.toHaveBeenCalled()
      expect(contracts.update).toHaveBeenCalledOnceWith('k1', { basePrice: 150, versione: 4 })
    })

    it('contratto con controparte BROKER: i campi bloccati non fanno scattare la validazione', () => {
      apri(
        contratto({
          status: 'ACTIVE',
          modificabili: TERMINI,
          eliminabile: false,
          contractType: 'FRAMEWORK',
          counterpartyType: 'BROKER',
        })
      )
      expect(component.registroEffettivo()).toBeNull()
      component.form.description = 'Nota'
      component.salva()
      expect(toast.warn).not.toHaveBeenCalled()
      expect(contracts.update).toHaveBeenCalledOnceWith('k1', {
        description: 'Nota',
        versione: 4,
      })
    })

    it('un campo bloccato alterato nel form non va mai nel corpo', () => {
      apri(contratto({ status: 'ACTIVE', modificabili: TERMINI, eliminabile: false }))
      component.form.producerId = 'altro'
      component.form.basePrice = 150
      component.salva()
      expect(contracts.update).toHaveBeenCalledOnceWith('k1', { basePrice: 150, versione: 4 })
    })

    it('a dialog aperto, un contratto con un altro id riallinea il form', () => {
      const a = contratto({ id: 'k1', contractNumber: 'CTR-A' })
      const b = contratto({ id: 'k2', contractNumber: 'CTR-B', cerCodes: ['200101'] })
      fixture.componentRef.setInput('contratto', a)
      fixture.componentRef.setInput('visible', true)
      fixture.detectChanges()
      expect(component.form.contractNumber).toBe('CTR-A')
      component.form.description = 'a metà'
      fixture.componentRef.setInput('contratto', b)
      fixture.detectChanges()
      expect(component.form.contractNumber).toBe('CTR-B')
      expect(component.form.cerCodes).toEqual(['200101'])
      expect(component.form.description).toBe('')
    })

    it('aria-describedby sul numero: nota dei campi bloccati in modifica', async () => {
      apri(contratto({ status: 'ACTIVE', modificabili: TERMINI, eliminabile: false }))
      await fixture.whenStable()
      fixture.detectChanges()
      const campi = document.body.querySelectorAll('#c-number')
      expect(campi[campi.length - 1].getAttribute('aria-describedby')).toBe('c-bloccati-nota')
      expect(document.body.querySelector('#c-bloccati-nota')).not.toBeNull()
    })

    it('a dialog aperto, lo stesso contratto con altra versione non azzera quanto digitato', () => {
      apri(contratto())
      component.form.description = 'in corso'
      fixture.componentRef.setInput('contratto', contratto({ versione: 5 }))
      fixture.detectChanges()
      expect(component.form.description).toBe('in corso')
    })

    it('400 CONTRATTO_NON_VALIDO: toast coi messaggi del backend, dialog resta aperto', () => {
      apri(contratto())
      component.form.basePrice = 130
      contracts.update.and.returnValue(
        errore(400, {
          message: ['Indica almeno un codice CER.', 'Il prezzo base non può essere negativo.'],
          error: 'CONTRATTO_NON_VALIDO',
        })
      )
      const emesso = spyOn(component.modificato, 'emit')
      const chiuso = spyOn(component.visibleChange, 'emit')
      component.salva()
      expect(toast.error).toHaveBeenCalledWith(
        'Indica almeno un codice CER. Il prezzo base non può essere negativo.'
      )
      expect(emesso).not.toHaveBeenCalled()
      expect(chiuso).not.toHaveBeenCalled()
      expect(component.saving()).toBeFalse()
    })

    it('il pulsante reale "Salva modifiche" salva (click DOM)', () => {
      apri(contratto())
      component.form.basePrice = 140
      const bottoni = Array.from(document.body.querySelectorAll('.p-dialog-footer button'))
      const salva = bottoni.find(b => b.textContent?.includes('Salva modifiche')) as HTMLElement
      expect(salva).toBeTruthy()
      salva.click()
      expect(contracts.update).toHaveBeenCalledOnceWith('k1', { basePrice: 140, versione: 4 })
    })
  })
})
