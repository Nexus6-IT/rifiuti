import { ForbiddenException } from '@nestjs/common'
/**
 * TDD Task 4 dello scadenzario: l'elenco di trasportatori e destinatari deve
 * riportare lo stato di scadenza (booleano + giorni residui) calcolato al
 * volo, così che il frontend possa avvisare l'operatore SUBITO quando sceglie
 * una controparte in un formulario — non solo via email il giorno dopo.
 *
 * Riusa `calcolaScadenza` (stessa funzione del controllo periodico in
 * `DeadlineCheckerService`, Task 1): niente seconda formula.
 */
import { Test, TestingModule } from '@nestjs/testing'
import { RegistryController } from './registry.controller'
import { CreateProduttoreUseCase } from '../../application/registry/use-cases/create-produttore.use-case'
import { CreateTrasportatoreUseCase } from '../../application/registry/use-cases/create-trasportatore.use-case'
import { CreateDestinatarioUseCase } from '../../application/registry/use-cases/create-destinatario.use-case'
import { ListProduttoriUseCase } from '../../application/registry/use-cases/list-produttori.use-case'
import { ListTrasportatoriUseCase } from '../../application/registry/use-cases/list-trasportatori.use-case'
import { ListDestinatariUseCase } from '../../application/registry/use-cases/list-destinatari.use-case'
import { GetProduttoreUseCase } from '../../application/registry/use-cases/get-produttore.use-case'
import { GetTrasportatoreUseCase } from '../../application/registry/use-cases/get-trasportatore.use-case'
import { GetDestinatarioUseCase } from '../../application/registry/use-cases/get-destinatario.use-case'
import { UpdateProduttoreUseCase } from '../../application/registry/use-cases/update-produttore.use-case'
import { UpdateTrasportatoreUseCase } from '../../application/registry/use-cases/update-trasportatore.use-case'
import { UpdateDestinatarioUseCase } from '../../application/registry/use-cases/update-destinatario.use-case'
import { DeleteProduttoreUseCase } from '../../application/registry/use-cases/delete-produttore.use-case'
import { DeleteTrasportatoreUseCase } from '../../application/registry/use-cases/delete-trasportatore.use-case'
import { DeleteDestinatarioUseCase } from '../../application/registry/use-cases/delete-destinatario.use-case'
import { Result } from '../../core/application/result'
import { Trasportatore } from '../../domain/registry/entities/trasportatore'
import { Destinatario } from '../../domain/registry/entities/destinatario'
import { PartitaIVA } from '../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../domain/registry/value-objects/indirizzo'

function creaIndirizzo(): Indirizzo {
  return Indirizzo.create({
    via: 'Via Roma',
    civico: '1',
    cap: '00100',
    citta: 'Roma',
    provincia: 'RM',
  })
}

function creaTrasportatore(scadenzaIscrizione?: Date): Trasportatore {
  return Trasportatore.create({
    ragioneSociale: 'Trasporti Rossi SRL',
    partitaIVA: PartitaIVA.create('12345678901'),
    sedeLegale: creaIndirizzo(),
    numeroIscrizione: 'AL12345',
    scadenzaIscrizione,
  })
}

function creaDestinatario(scadenzaAutorizzazione?: Date): Destinatario {
  return Destinatario.create({
    ragioneSociale: 'Impianto Verdi SRL',
    partitaIVA: PartitaIVA.create('98765432109'),
    sede: creaIndirizzo(),
    numeroAutorizzazione: 'AUT-999',
    scadenzaAutorizzazione,
  })
}

describe('RegistryController — stato di scadenza nell’elenco (Task 4 scadenzario)', () => {
  let controller: RegistryController
  let listTrasportatoriUseCase: { execute: jest.Mock }
  let listDestinatariUseCase: { execute: jest.Mock }

  beforeEach(async () => {
    listTrasportatoriUseCase = { execute: jest.fn() }
    listDestinatariUseCase = { execute: jest.fn() }

    const noop = { execute: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RegistryController],
      providers: [
        { provide: CreateProduttoreUseCase, useValue: noop },
        { provide: CreateTrasportatoreUseCase, useValue: noop },
        { provide: CreateDestinatarioUseCase, useValue: noop },
        { provide: ListProduttoriUseCase, useValue: noop },
        { provide: ListTrasportatoriUseCase, useValue: listTrasportatoriUseCase },
        { provide: ListDestinatariUseCase, useValue: listDestinatariUseCase },
        { provide: GetProduttoreUseCase, useValue: noop },
        { provide: GetTrasportatoreUseCase, useValue: noop },
        { provide: GetDestinatarioUseCase, useValue: noop },
        { provide: UpdateProduttoreUseCase, useValue: noop },
        { provide: UpdateTrasportatoreUseCase, useValue: noop },
        { provide: UpdateDestinatarioUseCase, useValue: noop },
        { provide: DeleteProduttoreUseCase, useValue: noop },
        { provide: DeleteTrasportatoreUseCase, useValue: noop },
        { provide: DeleteDestinatarioUseCase, useValue: noop },
      ],
    }).compile()

    controller = module.get(RegistryController)
  })

  it('senza azienda determinabile: 403, nessuna lettura (fail-closed)', async () => {
    await expect(controller.listProduttori({} as any)).rejects.toBeInstanceOf(ForbiddenException)
    await expect(controller.listTrasportatori({ user: {} } as any)).rejects.toBeInstanceOf(
      ForbiddenException
    )
    await expect(controller.listDestinatari({} as any)).rejects.toBeInstanceOf(ForbiddenException)
  })

  function req(tenantId = 'tenant-1'): any {
    return { tenantId }
  }

  describe('GET /registry/destinatari', () => {
    it('riporta autorizzazioneScaduta=true e i giorni (negativi) per un destinatario con autorizzazione scaduta', async () => {
      const scaduta = new Date()
      scaduta.setDate(scaduta.getDate() - 5)
      listDestinatariUseCase.execute.mockResolvedValue(Result.ok([creaDestinatario(scaduta)]))

      const result = await controller.listDestinatari(req())

      expect(result.items[0].autorizzazioneScaduta).toBe(true)
      expect(result.items[0].giorniAllaScadenza).toBeLessThan(0)
    })

    it('riporta autorizzazioneScaduta=false per un’autorizzazione futura', async () => {
      const futura = new Date()
      futura.setDate(futura.getDate() + 20)
      listDestinatariUseCase.execute.mockResolvedValue(Result.ok([creaDestinatario(futura)]))

      const result = await controller.listDestinatari(req())

      expect(result.items[0].autorizzazioneScaduta).toBe(false)
      expect(result.items[0].giorniAllaScadenza).toBeGreaterThan(0)
    })

    it('non inventa uno stato di scadenza quando il dato è assente: autorizzazioneScaduta=false, giorni=null', async () => {
      listDestinatariUseCase.execute.mockResolvedValue(Result.ok([creaDestinatario(undefined)]))

      const result = await controller.listDestinatari(req())

      expect(result.items[0].autorizzazioneScaduta).toBe(false)
      expect(result.items[0].giorniAllaScadenza).toBeNull()
    })

    it('propaga il tenantId dalla request al caso d’uso (isolamento per tenant)', async () => {
      listDestinatariUseCase.execute.mockResolvedValue(Result.ok([]))

      await controller.listDestinatari(req('tenant-xyz'))

      expect(listDestinatariUseCase.execute).toHaveBeenCalledWith({ tenantId: 'tenant-xyz' })
    })
  })

  describe('GET /registry/trasportatori', () => {
    it('riporta iscrizioneScaduta=true e i giorni (negativi) per un trasportatore con iscrizione scaduta', async () => {
      const scaduta = new Date()
      scaduta.setDate(scaduta.getDate() - 3)
      listTrasportatoriUseCase.execute.mockResolvedValue(Result.ok([creaTrasportatore(scaduta)]))

      const result = await controller.listTrasportatori(req())

      expect(result.items[0].iscrizioneScaduta).toBe(true)
      expect(result.items[0].giorniAllaScadenza).toBeLessThan(0)
    })

    it('non inventa uno stato di scadenza quando il dato è assente: iscrizioneScaduta=false, giorni=null', async () => {
      listTrasportatoriUseCase.execute.mockResolvedValue(Result.ok([creaTrasportatore(undefined)]))

      const result = await controller.listTrasportatori(req())

      expect(result.items[0].iscrizioneScaduta).toBe(false)
      expect(result.items[0].giorniAllaScadenza).toBeNull()
    })

    // Correzione di revisione (rilievo minore): stesso test già presente per
    // i destinatari, mancava qui pur essendo il percorso identico
    // (tenantId dalla request al comando del caso d'uso) — copertura
    // asimmetrica, non un difetto di comportamento diverso.
    it('propaga il tenantId dalla request al caso d’uso (isolamento per tenant)', async () => {
      listTrasportatoriUseCase.execute.mockResolvedValue(Result.ok([]))

      await controller.listTrasportatori(req('tenant-xyz'))

      expect(listTrasportatoriUseCase.execute).toHaveBeenCalledWith({ tenantId: 'tenant-xyz' })
    })
  })
})
