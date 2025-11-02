/**
 * Create FIR Use Case - TDD Tests
 */

import { CreateFIRUseCase } from './create-fir.use-case'
import { CreateFIRCommand } from '../commands/create-fir.command'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { ICERRepository } from '../../../domain/cer/repositories/cer-repository.interface'
import { FIR, FIRStato } from '../../../domain/fir/aggregates/fir.aggregate'
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

  async findByTenant(tenantId: string, filters?: any): Promise<FIR[]> {
    return Array.from(this.firs.values())
  }

  async findByStato(stato: FIRStato, tenantId?: string): Promise<FIR[]> {
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

  async count(filters?: any): Promise<number> {
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

  async findById(id: string): Promise<any> {
    return null
  }

  async search(keyword: string, filters?: any): Promise<any[]> {
    return []
  }

  async findByCategory(category: string): Promise<any[]> {
    return []
  }

  async findAllPericolosi(): Promise<any[]> {
    return []
  }

  async save(cer: any): Promise<void> {}

  async saveMany(cers: any[]): Promise<void> {}

  async count(): Promise<number> {
    return this.existingCodes.size
  }

  async exists(code: string): Promise<boolean> {
    return this.existingCodes.has(code)
  }
}

describe('CreateFIRUseCase', () => {
  let useCase: CreateFIRUseCase
  let firRepository: MockFIRRepository
  let cerRepository: MockCERRepository

  beforeEach(() => {
    firRepository = new MockFIRRepository()
    cerRepository = new MockCERRepository()
    useCase = new CreateFIRUseCase(firRepository, cerRepository)
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
      'user-123'
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
        'user-123'
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
        'user-123'
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
        'user-123'
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
        'user-123'
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
        'user-123'
      )

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.rifiuto.quantita.unitaMisura).toBe(UnitaMisura.KG)
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
