/**
 * Emetti FIR Use Case - TDD Tests
 */

import { EmettiFIRUseCase } from './emetti-fir.use-case'
import { EmettiFIRCommand } from '../commands/emetti-fir.command'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { FIR, FIRStato } from '../../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'

// Mock Repository
class MockFIRRepository implements IFIRRepository {
  private firs: Map<string, FIR> = new Map()
  private progressiveCounter = 0

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

  async findByTenant(): Promise<FIR[]> {
    return []
  }

  async findByStato(): Promise<FIR[]> {
    return []
  }

  async save(fir: FIR): Promise<void> {
    this.firs.set(fir.id, fir)
  }

  async delete(): Promise<void> {}

  async existsNumeroProgressivo(numeroProgressivo: string): Promise<boolean> {
    return (await this.findByNumeroProgressivo(numeroProgressivo)) !== null
  }

  async generateNumeroProgressivo(tenantId: string, anno: number): Promise<string> {
    this.progressiveCounter++
    return `FIR-${anno}-${String(this.progressiveCounter).padStart(6, '0')}`
  }

  async count(): Promise<number> {
    return this.firs.size
  }

  addFIR(fir: FIR) {
    this.firs.set(fir.id, fir)
  }
}

describe('EmettiFIRUseCase', () => {
  let useCase: EmettiFIRUseCase
  let repository: MockFIRRepository

  beforeEach(() => {
    repository = new MockFIRRepository()
    useCase = new EmettiFIRUseCase(repository)
  })

  const createBozzaFIR = (): FIR => {
    return FIR.create({
      produttoreId: 'tenant-producer-123',
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
    it('should emit FIR from BOZZA state', async () => {
      const fir = createBozzaFIR()
      repository.addFIR(fir)

      const command = new EmettiFIRCommand(
        fir.id,
        {
          firmatario: 'Mario Rossi',
          certificato: 'cert-mock-123',
        },
        'user-123'
      )

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.stato).toBe(FIRStato.EMESSO)
      expect(result.value.numeroProgressivo).toBeDefined()
      expect(result.value.numeroProgressivo).toMatch(/^FIR-\d{4}-\d{6}$/)
    })

    it('should generate sequential numero progressivo', async () => {
      const fir1 = createBozzaFIR()
      const fir2 = createBozzaFIR()
      repository.addFIR(fir1)
      repository.addFIR(fir2)

      const command1 = new EmettiFIRCommand(
        fir1.id,
        { firmatario: 'User 1', certificato: 'cert-1' },
        'user-1'
      )

      const command2 = new EmettiFIRCommand(
        fir2.id,
        { firmatario: 'User 2', certificato: 'cert-2' },
        'user-2'
      )

      const result1 = await useCase.execute(command1)
      const result2 = await useCase.execute(command2)

      expect(result1.value.numeroProgressivo).toContain('000001')
      expect(result2.value.numeroProgressivo).toContain('000002')
    })

    it('should persist FIR with firma produttore', async () => {
      const fir = createBozzaFIR()
      repository.addFIR(fir)

      const command = new EmettiFIRCommand(
        fir.id,
        {
          firmatario: 'Mario Rossi',
          certificato: 'cert-mock-123',
        },
        'user-123'
      )

      const result = await useCase.execute(command)

      const saved = await repository.findById(fir.id)
      expect(saved?.firme.produttore).toBeDefined()
      expect(saved?.firme.produttore?.firmatario).toBe('Mario Rossi')
      expect(saved?.firme.produttore?.certificato).toBe('cert-mock-123')
      expect(saved?.firme.produttore?.timestamp).toBeInstanceOf(Date)
    })

    it('should fail if FIR not found', async () => {
      const command = new EmettiFIRCommand(
        'non-existent-id',
        { firmatario: 'Test', certificato: 'cert' },
        'user-123'
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('FIR not found')
    })

    it('should emit domain event on success', async () => {
      const fir = createBozzaFIR()
      repository.addFIR(fir)

      const command = new EmettiFIRCommand(
        fir.id,
        { firmatario: 'Test', certificato: 'cert' },
        'user-123'
      )

      const result = await useCase.execute(command)

      expect(result.value.domainEvents.length).toBe(1);
      expect(result.value.domainEvents[0].eventName).toBe('fir.emesso')
    })

    it('should include numero progressivo in current year', async () => {
      const fir = createBozzaFIR()
      repository.addFIR(fir)

      const command = new EmettiFIRCommand(
        fir.id,
        { firmatario: 'Test', certificato: 'cert' },
        'user-123'
      )

      const result = await useCase.execute(command)
      const currentYear = new Date().getFullYear()

      expect(result.value.numeroProgressivo).toContain(`FIR-${currentYear}-`)
    })
  })
})
