/**
 * Create FIR Use Case - TDD Tests
 */

import { CreateFIRUseCase } from './create-fir.use-case'
import { CreateFIRCommand } from '../commands/create-fir.command'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { ICERRepository } from '../../../domain/cer/repositories/cer-repository.interface'
import { ProduttoreRepository } from '../../../domain/registry/repositories/produttore.repository'
import { TrasportatoreRepository } from '../../../domain/registry/repositories/trasportatore.repository'
import { DestinatarioRepository } from '../../../domain/registry/repositories/destinatario.repository'
import { Produttore } from '../../../domain/registry/entities/produttore'
import { Trasportatore } from '../../../domain/registry/entities/trasportatore'
import { Destinatario } from '../../../domain/registry/entities/destinatario'
import { PartitaIVA } from '../../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import { FIR, FIRStato, TipoTratta } from '../../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'

// Mock Repositories
class MockFIRRepository implements IFIRRepository {
  private firs: Map<string, FIR> = new Map()

  async findById(id: string): Promise<FIR | null> {
    return this.firs.get(id) || null
  }

  async findByIdPublic(id: string): Promise<FIR | null> {
    return this.firs.get(id) || null
  }

  async findByNumeroProgressivo(numeroProgressivo: string): Promise<FIR | null> {
    for (const fir of this.firs.values()) {
      if (fir.numeroProgressivo === numeroProgressivo) return fir
    }
    return null
  }

  async findByTenant(_tenantId: string, _filters?: any): Promise<FIR[]> {
    return Array.from(this.firs.values())
  }

  async findByStato(stato: FIRStato, _tenantId?: string): Promise<FIR[]> {
    return Array.from(this.firs.values()).filter(f => f.stato === stato)
  }

  async save(fir: FIR): Promise<void> {
    this.firs.set(fir.id, fir)
  }

  async delete(id: string): Promise<void> {
    this.firs.delete(id)
  }

  async existsNumeroProgressivo(numeroProgressivo: string): Promise<boolean> {
    return (await this.findByNumeroProgressivo(numeroProgressivo)) !== null
  }

  async generateNumeroProgressivo(tenantId: string, anno: number): Promise<string> {
    const count = this.firs.size + 1
    return `FIR-${anno}-${String(count).padStart(6, '0')}`
  }

  async count(_filters?: any): Promise<number> {
    return this.firs.size
  }
}

class MockCERRepository implements ICERRepository {
  private existingCodes = new Set<string>()

  addCode(code: string) {
    this.existingCodes.add(code)
  }

  async findByCode(code: string): Promise<any> {
    return this.existingCodes.has(code) ? { code } : null
  }

  async findById(_id: string): Promise<any> {
    return null
  }

  async search(_keyword: string, _filters?: any): Promise<any[]> {
    return []
  }

  async findByCategory(_category: string): Promise<any[]> {
    return []
  }

  async findAllPericolosi(): Promise<any[]> {
    return []
  }

  async findPaginated(): Promise<{ items: any[]; total: number }> {
    return { items: [], total: 0 }
  }

  async save(_cer: any): Promise<void> {}

  async saveMany(_cers: any[]): Promise<void> {}

  async count(): Promise<number> {
    return this.existingCodes.size
  }

  async exists(code: string): Promise<boolean> {
    return this.existingCodes.has(code)
  }
}

// Registry mocks: restituiscono un'anagrafica per ogni id non vuoto, salvo
// quelli aggiunti a `missing` (per simulare anagrafica inesistente).
class MockProduttoreRepository implements ProduttoreRepository {
  missing = new Set<string>()
  async save(): Promise<void> {}
  async findById(id: string): Promise<Produttore | null> {
    if (!id || this.missing.has(id)) return null
    return Produttore.reconstitute({
      id,
      ragioneSociale: 'Produttore SpA',
      partitaIVA: PartitaIVA.create('12345678901'),
      sedeLegale: Indirizzo.create({
        via: 'Via Roma',
        civico: '1',
        cap: '00100',
        citta: 'Roma',
        provincia: 'RM',
      }),
      pec: 'prod@pec.it',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }
  async findByTenantId(): Promise<Produttore[]> {
    return []
  }
  async findByPartitaIVA(): Promise<Produttore | null> {
    return null
  }
  async delete(): Promise<void> {}
}

class MockTrasportatoreRepository implements TrasportatoreRepository {
  missing = new Set<string>()
  async save(): Promise<void> {}
  async findById(id: string): Promise<Trasportatore | null> {
    if (!id || this.missing.has(id)) return null
    return Trasportatore.reconstitute({
      id,
      ragioneSociale: 'Trasporti Srl',
      partitaIVA: PartitaIVA.create('22345678901'),
      sedeLegale: Indirizzo.create({
        via: 'Via Po',
        civico: '2',
        cap: '10100',
        citta: 'Torino',
        provincia: 'TO',
      }),
      numeroIscrizione: 'ALBO-123',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }
  async findByTenantId(): Promise<Trasportatore[]> {
    return []
  }
  async findByPartitaIVA(): Promise<Trasportatore | null> {
    return null
  }
  async findByNumeroIscrizione(): Promise<Trasportatore | null> {
    return null
  }
  async delete(): Promise<void> {}
}

class MockDestinatarioRepository implements DestinatarioRepository {
  missing = new Set<string>()
  async save(): Promise<void> {}
  async findById(id: string): Promise<Destinatario | null> {
    if (!id || this.missing.has(id)) return null
    return Destinatario.reconstitute({
      id,
      ragioneSociale: 'Impianto Recupero Srl',
      partitaIVA: PartitaIVA.create('32345678901'),
      sede: Indirizzo.create({
        via: 'Via Etna',
        civico: '3',
        cap: '95100',
        citta: 'Catania',
        provincia: 'CT',
      }),
      numeroAutorizzazione: 'AUT-999',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }
  async findByTenantId(): Promise<Destinatario[]> {
    return []
  }
  async findByPartitaIVA(): Promise<Destinatario | null> {
    return null
  }
  async findByNumeroAutorizzazione(): Promise<Destinatario | null> {
    return null
  }
  async delete(): Promise<void> {}
}

describe('CreateFIRUseCase', () => {
  let useCase: CreateFIRUseCase
  let firRepository: MockFIRRepository
  let cerRepository: MockCERRepository
  let produttoreRepository: MockProduttoreRepository
  let trasportatoreRepository: MockTrasportatoreRepository
  let destinatarioRepository: MockDestinatarioRepository

  beforeEach(() => {
    firRepository = new MockFIRRepository()
    cerRepository = new MockCERRepository()
    produttoreRepository = new MockProduttoreRepository()
    trasportatoreRepository = new MockTrasportatoreRepository()
    destinatarioRepository = new MockDestinatarioRepository()
    useCase = new CreateFIRUseCase(
      firRepository,
      cerRepository,
      produttoreRepository,
      trasportatoreRepository,
      destinatarioRepository
    )
  })

  const createValidCommand = (): CreateFIRCommand => {
    return new CreateFIRCommand(
      'tenant-producer-123',
      {
        cerCode: '13 02 05*',
        quantita: 120,
        unitaMisura: UnitaMisura.KG,
        statoFisico: 'Liquido',
      },
      'tenant-transporter-456',
      'tenant-destination-789',
      'user-123',
      'tenant-1'
    )
  }

  describe('execute', () => {
    it('should create FIR successfully', async () => {
      cerRepository.addCode('13 02 05*')
      const command = createValidCommand()

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value).toBeInstanceOf(FIR)
      expect(result.value.stato).toBe(FIRStato.BOZZA)
      expect(result.value.produttoreId).toBe('tenant-producer-123')
      expect(result.value.rifiuto.cerCode).toBe('13 02 05*')
    })

    it('should snapshot the parties anagrafica from the registries', async () => {
      cerRepository.addCode('13 02 05*')
      const result = await useCase.execute(createValidCommand())

      expect(result.isSuccess).toBe(true)
      // snapshot immutabile: ragione sociale e P.IVA reali, non stringhe vuote
      expect(result.value.produttore?.ragioneSociale).toBe('Produttore SpA')
      expect(result.value.produttore?.partitaIva).toBe('12345678901')
      expect(result.value.produttore?.indirizzo).toContain('Roma')
      expect(result.value.trasportatore?.ragioneSociale).toBe('Trasporti Srl')
      expect(result.value.destinatario?.ragioneSociale).toBe('Impianto Recupero Srl')
      // l'operatore creatore è tracciato per la FK producerUserId
      expect(result.value.creatoDaUserId).toBe('user-123')
      // il FIR porta il tenant reale (isolamento multi-tenant, #7)
      expect(result.value.tenantId).toBe('tenant-1')
    })

    it('should fail if produttore is not in the registry', async () => {
      cerRepository.addCode('13 02 05*')
      produttoreRepository.missing.add('tenant-producer-123')

      const result = await useCase.execute(createValidCommand())

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('Produttore not found')
    })

    it('should persist FIR to repository', async () => {
      cerRepository.addCode('13 02 05*')
      const command = createValidCommand()

      const result = await useCase.execute(command)

      const saved = await firRepository.findById(result.value.id)
      expect(saved).not.toBeNull()
      expect(saved?.id).toBe(result.value.id)
    })

    it('should fail if CER code does not exist', async () => {
      // CER code not added to repository
      const command = createValidCommand()

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('CER code not found')
      expect(result.error).toContain('13 02 05*')
    })

    it('should fail if produttoreId is missing', async () => {
      cerRepository.addCode('13 02 05*')
      const command = new CreateFIRCommand(
        '', // Empty produttoreId
        { cerCode: '13 02 05*', quantita: 120 },
        'tenant-transporter-456',
        'tenant-destination-789',
        'user-123',
        'tenant-1'
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('Produttore, Trasportatore and Destinatario are required')
    })

    it('should fail if trasportatoreId is missing', async () => {
      cerRepository.addCode('13 02 05*')
      const command = new CreateFIRCommand(
        'tenant-producer-123',
        { cerCode: '13 02 05*', quantita: 120 },
        '', // Empty trasportatoreId
        'tenant-destination-789',
        'user-123',
        'tenant-1'
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('Produttore, Trasportatore and Destinatario are required')
    })

    it('should fail if destinatarioId is missing', async () => {
      cerRepository.addCode('13 02 05*')
      const command = new CreateFIRCommand(
        'tenant-producer-123',
        { cerCode: '13 02 05*', quantita: 120 },
        'tenant-transporter-456',
        '', // Empty destinatarioId
        'user-123',
        'tenant-1'
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('Produttore, Trasportatore and Destinatario are required')
    })

    it('should fail if quantita is invalid (negative)', async () => {
      cerRepository.addCode('13 02 05*')
      const command = new CreateFIRCommand(
        'tenant-producer-123',
        { cerCode: '13 02 05*', quantita: -100 }, // Invalid quantity
        'tenant-transporter-456',
        'tenant-destination-789',
        'user-123',
        'tenant-1'
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('Failed to create FIR')
    })

    it('should create FIR with default unitaMisura (KG)', async () => {
      cerRepository.addCode('15 01 01')
      const command = new CreateFIRCommand(
        'tenant-producer-123',
        { cerCode: '15 01 01', quantita: 50 }, // No unitaMisura specified
        'tenant-transporter-456',
        'tenant-destination-789',
        'user-123',
        'tenant-1'
      )

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.rifiuto.quantita.unitaMisura).toBe(UnitaMisura.KG)
    })

    it('should snapshot additional carriers for intermodal transport', async () => {
      cerRepository.addCode('13 02 05*')
      const command = new CreateFIRCommand(
        'tenant-producer-123',
        { cerCode: '13 02 05*', quantita: 120 },
        'tenant-transporter-456',
        'tenant-destination-789',
        'user-123',
        'tenant-1',
        [
          { trasportatoreId: 'carrier-rail', tipoTratta: TipoTratta.FERROVIARIA, ordine: 2 },
          { trasportatoreId: 'carrier-sea', tipoTratta: TipoTratta.MARITTIMA, ordine: 3 },
        ]
      )

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      const tratte = result.value.trasportatoriAggiuntivi
      expect(tratte).toHaveLength(2)
      expect(tratte[0]).toMatchObject({
        ordine: 2,
        tipoTratta: TipoTratta.FERROVIARIA,
        trasportatoreId: 'carrier-rail',
        denominazione: 'Trasporti Srl',
        partitaIva: '22345678901',
        numeroIscrizioneAlbo: 'ALBO-123',
      })
      expect(tratte[1].tipoTratta).toBe(TipoTratta.MARITTIMA)
    })

    it('should fail if an additional carrier is not in the registry', async () => {
      cerRepository.addCode('13 02 05*')
      trasportatoreRepository.missing.add('carrier-missing')
      const command = new CreateFIRCommand(
        'tenant-producer-123',
        { cerCode: '13 02 05*', quantita: 120 },
        'tenant-transporter-456',
        'tenant-destination-789',
        'user-123',
        'tenant-1',
        [{ trasportatoreId: 'carrier-missing', tipoTratta: TipoTratta.TERRESTRE, ordine: 2 }]
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('Trasportatore not found: carrier-missing')
    })

    it('should create a FIR with no additional carriers (backward compatible)', async () => {
      cerRepository.addCode('13 02 05*')
      const result = await useCase.execute(createValidCommand())

      expect(result.isSuccess).toBe(true)
      expect(result.value.trasportatoriAggiuntivi).toEqual([])
    })

    it('should create multiple FIRs independently', async () => {
      cerRepository.addCode('13 02 05*')
      const command1 = createValidCommand()
      const command2 = createValidCommand()

      const result1 = await useCase.execute(command1)
      const result2 = await useCase.execute(command2)

      expect(result1.isSuccess).toBe(true)
      expect(result2.isSuccess).toBe(true)
      expect(result1.value.id).not.toBe(result2.value.id)

      const count = await firRepository.count()
      expect(count).toBe(2)
    })
  })
})
