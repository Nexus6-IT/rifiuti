/**
 * List FIRs Query Handler - TDD Tests
 */

import { ListFIRsQueryHandler } from './list-firs.handler'
import { ListFIRsQuery } from './list-firs.query'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { FIR, FIRStato } from '../../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'

// Mock Repository
class MockFIRRepository implements IFIRRepository {
  private firs: FIR[] = []

  async findById(): Promise<FIR | null> {
    return null
  }

  async findByIdPublic(id: string): Promise<FIR | null> {
    return null
  }

  async findByNumeroProgressivo(): Promise<FIR | null> {
    return null
  }

  async findByTenant(tenantId: string, filters?: any): Promise<FIR[]> {
    let results = this.firs.filter(
      fir =>
        fir.produttoreId === tenantId ||
        fir.trasportatoreId === tenantId ||
        fir.destinatarioId === tenantId
    )

    if (filters?.stato) {
      results = results.filter(fir => fir.stato === filters.stato)
    }

    return results
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
    return this.firs.length
  }

  addFIRs(firs: FIR[]) {
    this.firs.push(...firs)
  }
}

describe('ListFIRsQueryHandler', () => {
  let handler: ListFIRsQueryHandler
  let repository: MockFIRRepository

  beforeEach(() => {
    repository = new MockFIRRepository()
    handler = new ListFIRsQueryHandler(repository)
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
    it('should list all FIRs for tenant', async () => {
      const fir1 = createFIR('tenant-123')
      const fir2 = createFIR('tenant-123')
      const fir3 = createFIR('tenant-456') // Different tenant
      repository.addFIRs([fir1, fir2, fir3])

      const query = new ListFIRsQuery('tenant-123', 'user-123')

      const result = await handler.execute(query)

      expect(result.isSuccess).toBe(true)
      expect(result.value.items.length).toBe(2);
      expect(result.value.total).toBe(2)
    })

    it('should apply pagination (page 1)', async () => {
      const firs = Array.from({ length: 15 }, () => createFIR('tenant-123'))
      repository.addFIRs(firs)

      const query = new ListFIRsQuery(
        'tenant-123',
        'user-123',
        undefined,
        { page: 1, limit: 10 }
      )

      const result = await handler.execute(query)

      expect(result.value.items.length).toBe(10);
      expect(result.value.page).toBe(1)
      expect(result.value.limit).toBe(10)
      expect(result.value.total).toBe(15)
      expect(result.value.totalPages).toBe(2)
    })

    it('should apply pagination (page 2)', async () => {
      const firs = Array.from({ length: 15 }, () => createFIR('tenant-123'))
      repository.addFIRs(firs)

      const query = new ListFIRsQuery(
        'tenant-123',
        'user-123',
        undefined,
        { page: 2, limit: 10 }
      )

      const result = await handler.execute(query)

      expect(result.value.items.length).toBe(5); // Remaining items
      expect(result.value.page).toBe(2)
    })

    it('should filter by stato', async () => {
      const fir1 = createFIR('tenant-123')
      const fir2 = createFIR('tenant-123')
      // Emit fir2 to change state
      fir2.emetti('FIR-2025-000001', {
        firmatario: 'Test',
        timestamp: new Date(),
        certificato: 'cert',
      })
      repository.addFIRs([fir1, fir2])

      const query = new ListFIRsQuery('tenant-123', 'user-123', {
        stato: FIRStato.EMESSO,
      })

      const result = await handler.execute(query)

      expect(result.value.items.length).toBe(1);
      expect(result.value.items[0].stato).toBe(FIRStato.EMESSO)
    })

    it('should use default pagination (page 1, limit 10)', async () => {
      const firs = Array.from({ length: 3 }, () => createFIR('tenant-123'))
      repository.addFIRs(firs)

      const query = new ListFIRsQuery('tenant-123', 'user-123') // No pagination specified

      const result = await handler.execute(query)

      expect(result.value.page).toBe(1)
      expect(result.value.limit).toBe(10)
      expect(result.value.items.length).toBe(3);
    })

    it('should return empty list if no FIRs', async () => {
      const query = new ListFIRsQuery('tenant-123', 'user-123')

      const result = await handler.execute(query)

      expect(result.isSuccess).toBe(true)
      expect(result.value.items.length).toBe(0);
      expect(result.value.total).toBe(0)
    })

    it('should calculate totalPages correctly', async () => {
      const firs = Array.from({ length: 25 }, () => createFIR('tenant-123'))
      repository.addFIRs(firs)

      const query = new ListFIRsQuery(
        'tenant-123',
        'user-123',
        undefined,
        { page: 1, limit: 10 }
      )

      const result = await handler.execute(query)

      expect(result.value.totalPages).toBe(3) // 25 items / 10 per page = 3 pages
    })
  })
})
