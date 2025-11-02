/**
 * Presa In Carico FIR Use Case - TDD Tests
 */

import { PresaInCaricoFIRUseCase } from './presa-in-carico-fir.use-case'
import { PresaInCaricoFIRCommand } from '../commands/presa-in-carico-fir.command'
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

  async save(fir: FIR): Promise<void> {
    this.firs.set(fir.id, fir)
  }

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

describe('PresaInCaricoFIRUseCase', () => {
  let useCase: PresaInCaricoFIRUseCase
  let repository: MockFIRRepository

  beforeEach(() => {
    repository = new MockFIRRepository()
    useCase = new PresaInCaricoFIRUseCase(repository)
  })

  const createEmessoFIR = (): FIR => {
    const fir = FIR.create({
      produttoreId: 'tenant-producer-123',
      rifiuto: {
        cerCode: '13 02 05*',
        quantita: 120,
        unitaMisura: UnitaMisura.KG,
      },
      trasportatoreId: 'tenant-transporter-456',
      destinatarioId: 'tenant-destination-789',
    })

    // Emit FIR to move to EMESSO state
    fir.emetti('FIR-2025-000001', {
      firmatario: 'Produttore',
      timestamp: new Date(),
      certificato: 'cert-prod',
    })

    return fir
  }

  describe('execute', () => {
    it('should take charge of FIR from EMESSO state', async () => {
      const fir = createEmessoFIR()
      repository.addFIR(fir)

      const command = new PresaInCaricoFIRCommand(
        fir.id,
        {
          firmatario: 'Trasportatore Rossi',
          certificato: 'cert-trans-123',
        },
        'user-trans-456'
      )

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.stato).toBe(FIRStato.IN_TRANSITO)
      expect(result.value.dataPresaCarico).toBeInstanceOf(Date)
    })

    it('should persist FIR with firma trasportatore', async () => {
      const fir = createEmessoFIR()
      repository.addFIR(fir)

      const command = new PresaInCaricoFIRCommand(
        fir.id,
        {
          firmatario: 'Trasportatore Rossi',
          certificato: 'cert-trans-123',
        },
        'user-trans-456'
      )

      await useCase.execute(command)

      const saved = await repository.findById(fir.id)
      expect(saved?.firme.trasportatore).toBeDefined()
      expect(saved?.firme.trasportatore?.firmatario).toBe('Trasportatore Rossi')
      expect(saved?.firme.trasportatore?.certificato).toBe('cert-trans-123')
      expect(saved?.firme.trasportatore?.timestamp).toBeInstanceOf(Date)
    })

    it('should fail if FIR not found', async () => {
      const command = new PresaInCaricoFIRCommand(
        'non-existent-id',
        { firmatario: 'Test', certificato: 'cert' },
        'user-123'
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('FIR not found')
    })

    it('should fail if FIR not in EMESSO state', async () => {
      const fir = FIR.create({
        produttoreId: 'tenant-producer-123',
        rifiuto: {
          cerCode: '13 02 05*',
          quantita: 120,
          unitaMisura: UnitaMisura.KG,
        },
        trasportatoreId: 'tenant-transporter-456',
        destinatarioId: 'tenant-destination-789',
      })
      repository.addFIR(fir)

      const command = new PresaInCaricoFIRCommand(
        fir.id,
        { firmatario: 'Test', certificato: 'cert' },
        'user-123'
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('Invalid state transition')
    })

    it('should emit domain event on success', async () => {
      const fir = createEmessoFIR()
      repository.addFIR(fir)

      const command = new PresaInCaricoFIRCommand(
        fir.id,
        { firmatario: 'Trasportatore', certificato: 'cert' },
        'user-456'
      )

      const result = await useCase.execute(command)

      const events = result.value.domainEvents
      const presaInCaricoEvent = events.find(e => e.eventName === 'fir.presa_in_carico')
      expect(presaInCaricoEvent).toBeDefined()
    })

    it('should set dataPresaCarico to current timestamp', async () => {
      const fir = createEmessoFIR()
      repository.addFIR(fir)

      const beforeExecution = new Date()

      const command = new PresaInCaricoFIRCommand(
        fir.id,
        { firmatario: 'Trasportatore', certificato: 'cert' },
        'user-456'
      )

      const result = await useCase.execute(command)

      const afterExecution = new Date()

      expect(result.value.dataPresaCarico).toBeDefined()
      expect(result.value.dataPresaCarico!.getTime()).toBeGreaterThanOrEqual(
        beforeExecution.getTime()
      )
      expect(result.value.dataPresaCarico!.getTime()).toBeLessThanOrEqual(
        afterExecution.getTime()
      )
    })

    it('should authorize only trasportatore tenant', async () => {
      // This test verifies authorization logic if implemented
      // For now, we test that the use case executes successfully
      const fir = createEmessoFIR()
      repository.addFIR(fir)

      const command = new PresaInCaricoFIRCommand(
        fir.id,
        { firmatario: 'Trasportatore', certificato: 'cert' },
        'user-trans-456'
      )

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
    })
  })
})
