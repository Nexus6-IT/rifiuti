/**
 * Conferma Consegna FIR Use Case - TDD Tests
 *
 * Task 4 (pipeline P3): la firma del destinatario non è più una costante
 * ('FIRMA-NON-QUALIFICATA') passata dal chiamante, ma prodotta invocando il
 * sottosistema crittografico (DigitalSignatureService) sul documento canonico
 * dell'aggregate FIR crittografico (stessa riga fisica, aggregate separato).
 */

import { ConfermaConsegnaFIRUseCase } from './conferma-consegna-fir.use-case'
import { ConfermaConsegnaFIRCommand } from '../commands/conferma-consegna-fir.command'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { FIR, FIRStato } from '../../../domain/fir/aggregates/fir.aggregate'
import { formattaNumeroFir } from '../../../domain/fir/numero-fir'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { FIR as CryptoFIR } from '../../../domain/fir/fir.aggregate'
import { FIRRepository as CryptoFIRRepository } from '../../../domain/fir/fir.repository'
import { DigitalSignatureService } from '../../signatures/digital-signature.service'
import { LoggerService } from '../../../core/logger/logger.service'

// Mock Repository (ciclo di vita)
class MockFIRRepository implements IFIRRepository {
  private progressiveCounter = 0
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

  async prenotaTrasmissioneRentri(): Promise<boolean> {
    return true
  }

  async registraTransazioneInAttesa(): Promise<boolean> {
    return true
  }

  async elencaTrasmissioniRentriSospese(): Promise<Array<{ firId: string; tenantId: string }>> {
    return []
  }

  async findByRentriNumeroFir(): Promise<FIR | null> {
    return null
  }

  async save(fir: FIR): Promise<void> {
    this.firs.set(fir.id, fir)
  }

  async delete(): Promise<void> {}

  async existsNumeroProgressivo(): Promise<boolean> {
    return false
  }

  async emettiConNumerazione(
    fir: FIR,
    anno: number,
    applica: (n: string) => void
  ): Promise<string> {
    this.progressiveCounter = (this.progressiveCounter ?? 0) + 1
    const numero = formattaNumeroFir(anno, this.progressiveCounter)
    applica(numero)
    await this.save(fir)
    return numero
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

describe('ConfermaConsegnaFIRUseCase', () => {
  let useCase: ConfermaConsegnaFIRUseCase
  let repository: MockFIRRepository
  let cryptoRepository: FakeCryptoFIRRepository
  let signatureService: DigitalSignatureService

  beforeEach(() => {
    repository = new MockFIRRepository()
    cryptoRepository = new FakeCryptoFIRRepository()
    signatureService = new DigitalSignatureService(buildMockLogger())
    useCase = new ConfermaConsegnaFIRUseCase(repository, cryptoRepository, signatureService)
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

    fir.emetti('FIR-2025-000001', {
      firmatario: 'Produttore',
      timestamp: new Date(),
      certificato: 'cert-prod',
    })

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
        120,
        'user-dest-789',
        'Destinatario Bianchi'
      )

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.stato).toBe(FIRStato.CONSEGNATO)
      expect(result.value.pesoEffettivo).toBe(120)
      expect(result.value.dataConsegna).toBeInstanceOf(Date)
    })

    it('should persist FIR with firma destinatario (firma crittografica reale)', async () => {
      const fir = createInTransitoFIR()
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(
        fir.id,
        120,
        'user-dest-789',
        'Destinatario Bianchi'
      )

      await useCase.execute(command)

      const saved = await repository.findById(fir.id)
      expect(saved?.firme.destinatario).toBeDefined()
      expect(saved?.firme.destinatario?.firmatario).toBe('Destinatario Bianchi')
      expect(saved?.firme.destinatario?.timestamp).toBeInstanceOf(Date)
      expect(saved?.firme.destinatario?.certificato).not.toBe('FIRMA-NON-QUALIFICATA')
      expect(saved?.firme.destinatario?.documentHash).toBeTruthy()
      expect(saved?.firme.destinatario?.publicKey).toContain('BEGIN PUBLIC KEY')
    })

    it('should accept peso within +10% tolerance', async () => {
      const fir = createInTransitoFIR() // quantità dichiarata: 120
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(fir.id, 132, 'user-789', 'Destinatario')

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.pesoEffettivo).toBe(132)
    })

    it('should accept peso within -10% tolerance', async () => {
      const fir = createInTransitoFIR() // quantità dichiarata: 120
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(fir.id, 108, 'user-789', 'Destinatario')

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.pesoEffettivo).toBe(108)
    })

    it('should fail if peso exceeds +10% tolerance', async () => {
      const fir = createInTransitoFIR() // quantità dichiarata: 120
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(fir.id, 135, 'user-789', 'Destinatario')

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('tolleranza')
    })

    it('should fail if peso exceeds -10% tolerance', async () => {
      const fir = createInTransitoFIR() // quantità dichiarata: 120
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(fir.id, 105, 'user-789', 'Destinatario')

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('tolleranza')
    })

    it('should fail if FIR not found', async () => {
      const command = new ConfermaConsegnaFIRCommand('non-existent-id', 120, 'user-123', 'Test')

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

      const command = new ConfermaConsegnaFIRCommand(fir.id, 120, 'user-123', 'Test')

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('Invalid state transition')
    })

    it('should emit domain event on success', async () => {
      const fir = createInTransitoFIR()
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(fir.id, 120, 'user-789', 'Destinatario')

      const result = await useCase.execute(command)

      const events = result.value.domainEvents
      const consegnatoEvent = events.find(e => e.eventName === 'fir.consegnato')
      expect(consegnatoEvent).toBeDefined()
    })

    it('should set dataConsegna to current timestamp', async () => {
      const fir = createInTransitoFIR()
      repository.addFIR(fir)

      const beforeExecution = new Date()

      const command = new ConfermaConsegnaFIRCommand(fir.id, 120, 'user-789', 'Destinatario')

      const result = await useCase.execute(command)

      const afterExecution = new Date()

      expect(result.value.dataConsegna).toBeDefined()
      expect(result.value.dataConsegna!.getTime()).toBeGreaterThanOrEqual(beforeExecution.getTime())
      expect(result.value.dataConsegna!.getTime()).toBeLessThanOrEqual(afterExecution.getTime())
    })

    it('should verify the persisted signature cryptographically after reload', async () => {
      const fir = createInTransitoFIR()
      repository.addFIR(fir)

      const command = new ConfermaConsegnaFIRCommand(
        fir.id,
        120,
        'user-dest-789',
        'Destinatario Bianchi'
      )
      await useCase.execute(command)

      const reloaded = await repository.findById(fir.id)
      const firma = reloaded!.firme.destinatario!

      const isValid = await signatureService.verify(
        firma.documentHash!,
        firma.certificato,
        firma.publicKey!
      )
      expect(isValid).toBe(true)
    })

    it(
      'fail-closed: se il provider di firma non è configurato la transizione ' +
        'NON avviene e il FIR resta IN_TRANSITO',
      async () => {
        const fir = createInTransitoFIR()
        repository.addFIR(fir)

        const unconfiguredSignatureService = new DigitalSignatureService(buildMockLogger())
        useCase = new ConfermaConsegnaFIRUseCase(
          repository,
          cryptoRepository,
          unconfiguredSignatureService
        )

        const originalEnv = process.env.NODE_ENV
        process.env.NODE_ENV = 'production'
        try {
          const command = new ConfermaConsegnaFIRCommand(
            fir.id,
            120,
            'user-dest-789',
            'Destinatario Bianchi'
          )
          const result = await useCase.execute(command)

          expect(result.isFailure).toBe(true)
          expect(result.error).toContain('Firma destinatario non riuscita')

          const stillInTransito = await repository.findById(fir.id)
          expect(stillInTransito?.stato).toBe(FIRStato.IN_TRANSITO)
          expect(stillInTransito?.dataConsegna).toBeNull()
          expect(stillInTransito?.pesoEffettivo).toBeNull()
          expect(stillInTransito?.firme.destinatario).toBeUndefined()
        } finally {
          process.env.NODE_ENV = originalEnv
        }
      }
    )
  })
})
