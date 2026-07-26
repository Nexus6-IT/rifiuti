/**
 * Presa In Carico FIR Use Case - TDD Tests
 *
 * Task 4 (pipeline P3): la firma del trasportatore non è più una costante
 * ('FIRMA-NON-QUALIFICATA') passata dal chiamante, ma prodotta invocando il
 * sottosistema crittografico (DigitalSignatureService) sul documento canonico
 * dell'aggregate FIR crittografico (stessa riga fisica, aggregate separato).
 */

import { PresaInCaricoFIRUseCase } from './presa-in-carico-fir.use-case'
import { PresaInCaricoFIRCommand } from '../commands/presa-in-carico-fir.command'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { FIR, FIRStato } from '../../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { FIR as CryptoFIR } from '../../../domain/fir/fir.aggregate'
import { FIRRepository as CryptoFIRRepository } from '../../../domain/fir/fir.repository'
import { DigitalSignatureService } from '../../signatures/digital-signature.service'
import { LoggerService } from '../../../core/logger/logger.service'

// Mock Repository (ciclo di vita)
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

  async findByIds(): Promise<FIR[]> {
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

/** Fake del repository crittografico: risponde per qualsiasi id richiesto. */
class FakeCryptoFIRRepository implements CryptoFIRRepository {
  private buildCryptoFir(id: string): CryptoFIR {
    return CryptoFIR.create({
      id,
      firNumber: 'FIR-2025-000001',
      tenantId: 'tenant-uuid-1',
      producerPartitaIva: '12345678901',
      producerName: 'Produttore SRL',
      cerCode: '13 02 05*',
      quantity: 120,
      unit: 'KG',
    })
  }

  async findById(id: string): Promise<CryptoFIR | null> {
    return this.buildCryptoFir(id)
  }

  async findByIdPublic(id: string): Promise<CryptoFIR | null> {
    return this.findById(id)
  }

  async findByNumeroProgressivo(): Promise<CryptoFIR | null> {
    return null
  }

  async save(fir: CryptoFIR): Promise<CryptoFIR> {
    return fir
  }

  async update(fir: CryptoFIR): Promise<CryptoFIR> {
    return fir
  }

  async delete(): Promise<void> {}

  async getCurrentWorkloadByDriver(): Promise<number> {
    return 0
  }
}

function buildMockLogger(): jest.Mocked<LoggerService> {
  return {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as any
}

describe('PresaInCaricoFIRUseCase', () => {
  let useCase: PresaInCaricoFIRUseCase
  let repository: MockFIRRepository
  let cryptoRepository: FakeCryptoFIRRepository
  let signatureService: DigitalSignatureService

  beforeEach(() => {
    repository = new MockFIRRepository()
    cryptoRepository = new FakeCryptoFIRRepository()
    signatureService = new DigitalSignatureService(buildMockLogger())
    useCase = new PresaInCaricoFIRUseCase(repository, cryptoRepository, signatureService)
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

      const command = new PresaInCaricoFIRCommand(fir.id, 'user-trans-456', 'Trasportatore Rossi')

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.stato).toBe(FIRStato.IN_TRANSITO)
      expect(result.value.dataPresaCarico).toBeInstanceOf(Date)
    })

    it('should persist FIR with firma trasportatore (firma crittografica reale)', async () => {
      const fir = createEmessoFIR()
      repository.addFIR(fir)

      const command = new PresaInCaricoFIRCommand(fir.id, 'user-trans-456', 'Trasportatore Rossi')

      await useCase.execute(command)

      const saved = await repository.findById(fir.id)
      expect(saved?.firme.trasportatore).toBeDefined()
      expect(saved?.firme.trasportatore?.firmatario).toBe('Trasportatore Rossi')
      expect(saved?.firme.trasportatore?.timestamp).toBeInstanceOf(Date)
      expect(saved?.firme.trasportatore?.certificato).not.toBe('FIRMA-NON-QUALIFICATA')
      expect(saved?.firme.trasportatore?.documentHash).toBeTruthy()
      expect(saved?.firme.trasportatore?.publicKey).toContain('BEGIN PUBLIC KEY')
    })

    it('should fail if FIR not found', async () => {
      const command = new PresaInCaricoFIRCommand('non-existent-id', 'user-123', 'Test')

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

      const command = new PresaInCaricoFIRCommand(fir.id, 'user-123', 'Test')

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('Invalid state transition')
    })

    it('should emit domain event on success', async () => {
      const fir = createEmessoFIR()
      repository.addFIR(fir)

      const command = new PresaInCaricoFIRCommand(fir.id, 'user-456', 'Trasportatore')

      const result = await useCase.execute(command)

      const events = result.value.domainEvents
      const presaInCaricoEvent = events.find(e => e.eventName === 'fir.presa_in_carico')
      expect(presaInCaricoEvent).toBeDefined()
    })

    it('should set dataPresaCarico to current timestamp', async () => {
      const fir = createEmessoFIR()
      repository.addFIR(fir)

      const beforeExecution = new Date()

      const command = new PresaInCaricoFIRCommand(fir.id, 'user-456', 'Trasportatore')

      const result = await useCase.execute(command)

      const afterExecution = new Date()

      expect(result.value.dataPresaCarico).toBeDefined()
      expect(result.value.dataPresaCarico!.getTime()).toBeGreaterThanOrEqual(
        beforeExecution.getTime()
      )
      expect(result.value.dataPresaCarico!.getTime()).toBeLessThanOrEqual(afterExecution.getTime())
    })

    it('should verify the persisted signature cryptographically after reload', async () => {
      const fir = createEmessoFIR()
      repository.addFIR(fir)

      const command = new PresaInCaricoFIRCommand(fir.id, 'user-trans-456', 'Trasportatore Rossi')
      await useCase.execute(command)

      const reloaded = await repository.findById(fir.id)
      const firma = reloaded!.firme.trasportatore!

      const isValid = await signatureService.verify(
        firma.documentHash!,
        firma.certificato,
        firma.publicKey!
      )
      expect(isValid).toBe(true)
    })

    it(
      'fail-closed: se il provider di firma non è configurato la transizione ' +
        'NON avviene e il FIR resta EMESSO',
      async () => {
        const fir = createEmessoFIR()
        repository.addFIR(fir)

        const unconfiguredSignatureService = new DigitalSignatureService(buildMockLogger())
        useCase = new PresaInCaricoFIRUseCase(
          repository,
          cryptoRepository,
          unconfiguredSignatureService
        )

        const originalEnv = process.env.NODE_ENV
        process.env.NODE_ENV = 'production'
        try {
          const command = new PresaInCaricoFIRCommand(
            fir.id,
            'user-trans-456',
            'Trasportatore Rossi'
          )
          const result = await useCase.execute(command)

          expect(result.isFailure).toBe(true)
          expect(result.error).toContain('Firma trasportatore non riuscita')

          const stillEmesso = await repository.findById(fir.id)
          expect(stillEmesso?.stato).toBe(FIRStato.EMESSO)
          expect(stillEmesso?.dataPresaCarico).toBeNull()
          expect(stillEmesso?.firme.trasportatore).toBeUndefined()
        } finally {
          process.env.NODE_ENV = originalEnv
        }
      }
    )
  })
})
