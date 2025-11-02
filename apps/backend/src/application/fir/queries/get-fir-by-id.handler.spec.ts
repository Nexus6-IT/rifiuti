/**
 * Get FIR by ID Query Handler - TDD Tests
 */

import { GetFIRByIdQueryHandler } from './get-fir-by-id.handler'
import { GetFIRByIdQuery } from './get-fir-by-id.query'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { FIR, FIRStato } from '../../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'

// Mock Repository
class MockFIRRepository implements IFIRRepository {
  private firs: Map<string, FIR> = new Map()

  async findById(id: string): Promise<FIR | null> {
    return this.firs.get(id) || null
  }

  async findByIdPublic(id: string): Promise<FIR | null> {
    return this.firs.get(id) || null
  }

  async findByNumeroProgressivo(): Promise<FIR | null> {
    return null
  }

  async findByTenant(): Promise<FIR[]> {
    return []
  }

  async findByStato(): Promise<FIR[]> {
    return []
  }

  async save(): Promise<void> {}

  async delete(): Promise<void> {}

  async existsNumeroProgressivo(): Promise<boolean> {
    return false
  }

  async generateNumeroProgressivo(): Promise<string> {
    return 'FIR-2025-000001'
  }

  async count(): Promise<number> {
    return this.firs.size
  }

  addFIR(fir: FIR) {
    this.firs.set(fir.id, fir)
  }
}

describe('GetFIRByIdQueryHandler', () => {
  let handler: GetFIRByIdQueryHandler
  let repository: MockFIRRepository

  beforeEach(() => {
    repository = new MockFIRRepository()
    handler = new GetFIRByIdQueryHandler(repository)
  })

  const createFIR = (produttoreId: string): FIR => {
    return FIR.create({
      produttoreId,
      rifiuto: {
        cerCode: '13 02 05*',
        quantita: 120,
        unitaMisura: UnitaMisura.KG,
      },
      trasportatoreId: 'tenant-transporter-456',
      destinatarioId: 'tenant-destination-789',
    })
  }

  describe('execute', () => {
    it('should retrieve FIR by ID', async () => {
      const fir = createFIR('tenant-producer-123')
      repository.addFIR(fir)

      const query = new GetFIRByIdQuery(fir.id, 'user-123', 'tenant-producer-123')

      const result = await handler.execute(query)

      expect(result.isSuccess).toBe(true)
      expect(result.value.id).toBe(fir.id)
      expect(result.value.stato).toBe(FIRStato.BOZZA)
    })

    it('should fail if FIR not found', async () => {
      const query = new GetFIRByIdQuery('non-existent-id', 'user-123', 'tenant-123')

      const result = await handler.execute(query)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('FIR not found')
    })

    it('should authorize produttore tenant', async () => {
      const fir = createFIR('tenant-producer-123')
      repository.addFIR(fir)

      const query = new GetFIRByIdQuery(fir.id, 'user-123', 'tenant-producer-123')

      const result = await handler.execute(query)

      expect(result.isSuccess).toBe(true)
    })

    it('should authorize trasportatore tenant', async () => {
      const fir = createFIR('tenant-producer-123')
      repository.addFIR(fir)

      const query = new GetFIRByIdQuery(fir.id, 'user-456', 'tenant-transporter-456')

      const result = await handler.execute(query)

      expect(result.isSuccess).toBe(true)
    })

    it('should authorize destinatario tenant', async () => {
      const fir = createFIR('tenant-producer-123')
      repository.addFIR(fir)

      const query = new GetFIRByIdQuery(fir.id, 'user-789', 'tenant-destination-789')

      const result = await handler.execute(query)

      expect(result.isSuccess).toBe(true)
    })

    it('should fail if user not authorized (different tenant)', async () => {
      const fir = createFIR('tenant-producer-123')
      repository.addFIR(fir)

      const query = new GetFIRByIdQuery(fir.id, 'user-999', 'tenant-other-999')

      const result = await handler.execute(query)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('not authorized')
    })
  })
})
