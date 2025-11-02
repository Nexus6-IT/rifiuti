/**
 * Conferma Consegna FIR Use Case - TDD Tests
 */

import { ConfermaConsegnaFIRUseCase } from './conferma-consegna-fir.use-case'
import { ConfermaConsegnaFIRCommand } from '../commands/conferma-consegna-fir.command'
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

describe('ConfermaConsegnaFIRUseCase', () => {
  let useCase: ConfermaConsegnaFIRUseCase
  let repository: MockFIRRepository

  beforeEach(() => {
    repository = new MockFIRRepository()
    useCase = new ConfermaConsegnaFIRUseCase(repository)
  })

  const createInTransitoFIR = (): FIR => {
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

    // Take charge to move to IN_TRANSITO state
    fir.presaInCarico(new Date(), {
      firmatario: 'Trasportatore',
      timestamp: new Date(),
      certificato: 'cert-trans',
    })

    return fir
  }

  describe('execute', () => {
    it('should confirm delivery from IN_TRANSITO state', async () => {
      const fir = createInTransitoFIR()
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(
        fir.id,
        120, // Peso effettivo matches quantità dichiarata
        {
          firmatario: 'Destinatario Bianchi',
          certificato: 'cert-dest-789',
        },
        'user-dest-789'
      )

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.stato).toBe(FIRStato.CONSEGNATO)
      expect(result.value.pesoEffettivo).toBe(120)
      expect(result.value.dataConsegna).toBeInstanceOf(Date)
    })

    it('should persist FIR with firma destinatario', async () => {
      const fir = createInTransitoFIR()
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(
        fir.id,
        120,
        {
          firmatario: 'Destinatario Bianchi',
          certificato: 'cert-dest-789',
        },
        'user-dest-789'
      )

      await useCase.execute(command)

      const saved = await repository.findById(fir.id)
      expect(saved?.firme.destinatario).toBeDefined()
      expect(saved?.firme.destinatario?.firmatario).toBe('Destinatario Bianchi')
      expect(saved?.firme.destinatario?.certificato).toBe('cert-dest-789')
      expect(saved?.firme.destinatario?.timestamp).toBeInstanceOf(Date)
    })

    it('should accept peso within +10% tolerance', async () => {
      const fir = createInTransitoFIR() // quantità dichiarata: 120
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(
        fir.id,
        132, // +10% = 132 kg (boundary)
        { firmatario: 'Destinatario', certificato: 'cert' },
        'user-789'
      )

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.pesoEffettivo).toBe(132)
    })

    it('should accept peso within -10% tolerance', async () => {
      const fir = createInTransitoFIR() // quantità dichiarata: 120
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(
        fir.id,
        108, // -10% = 108 kg (boundary)
        { firmatario: 'Destinatario', certificato: 'cert' },
        'user-789'
      )

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.pesoEffettivo).toBe(108)
    })

    it('should fail if peso exceeds +10% tolerance', async () => {
      const fir = createInTransitoFIR() // quantità dichiarata: 120
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(
        fir.id,
        135, // Exceeds +10%
        { firmatario: 'Destinatario', certificato: 'cert' },
        'user-789'
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('tolleranza')
    })

    it('should fail if peso exceeds -10% tolerance', async () => {
      const fir = createInTransitoFIR() // quantità dichiarata: 120
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(
        fir.id,
        105, // Exceeds -10%
        { firmatario: 'Destinatario', certificato: 'cert' },
        'user-789'
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('tolleranza')
    })

    it('should fail if FIR not found', async () => {
      const command = new ConfermaConsegnaFIRCommand(
        'non-existent-id',
        120,
        { firmatario: 'Test', certificato: 'cert' },
        'user-123'
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('FIR not found')
    })

    it('should fail if FIR not in IN_TRANSITO state', async () => {
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

      const command = new ConfermaConsegnaFIRCommand(
        fir.id,
        120,
        { firmatario: 'Test', certificato: 'cert' },
        'user-123'
      )

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('Invalid state transition')
    })

    it('should emit domain event on success', async () => {
      const fir = createInTransitoFIR()
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(
        fir.id,
        120,
        { firmatario: 'Destinatario', certificato: 'cert' },
        'user-789'
      )

      const result = await useCase.execute(command)

      const events = result.value.domainEvents
      const consegnatoEvent = events.find(e => e.eventName === 'fir.consegnato')
      expect(consegnatoEvent).toBeDefined()
    })

    it('should set dataConsegna to current timestamp', async () => {
      const fir = createInTransitoFIR()
      repository.addFIR(fir)

      const beforeExecution = new Date()

      const command = new ConfermaConsegnaFIRCommand(
        fir.id,
        120,
        { firmatario: 'Destinatario', certificato: 'cert' },
        'user-789'
      )

      const result = await useCase.execute(command)

      const afterExecution = new Date()

      expect(result.value.dataConsegna).toBeDefined()
      expect(result.value.dataConsegna!.getTime()).toBeGreaterThanOrEqual(
        beforeExecution.getTime()
      )
      expect(result.value.dataConsegna!.getTime()).toBeLessThanOrEqual(
        afterExecution.getTime()
      )
    })
  })
})
