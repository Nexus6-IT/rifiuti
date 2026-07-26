/**
 * Emetti FIR Use Case - TDD Tests
 *
 * Task 4 (pipeline P3): la firma del produttore non è più una costante
 * ('FIRMA-NON-QUALIFICATA') passata dal chiamante, ma prodotta invocando il
 * sottosistema crittografico (DigitalSignatureService) sul documento canonico
 * dell'aggregate FIR crittografico (stessa riga fisica, aggregate separato).
 */

import { EmettiFIRUseCase } from './emetti-fir.use-case'
import { EmettiFIRCommand } from '../commands/emetti-fir.command'
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

  async findByIds(): Promise<FIR[]> {
    return []
  }

  async findByRentriNumeroFir(): Promise<FIR | null> {
    return null
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

/**
 * Fake del repository crittografico (fir.repository.ts): rappresenta la
 * STESSA riga fisica FIR letta dall'aggregate crittografico. `firNumber` è
 * mutabile per simulare l'assegnazione del numero progressivo all'emissione
 * (task di stabilità: la firma va verificata come valida anche dopo).
 */
class FakeCryptoFIRRepository implements CryptoFIRRepository {
  firNumber: string | null = null

  // NOTA: `firId` non è più usato per filtrare — il fake risponde per
  // QUALSIASI id richiesto (i test istanziano più FIR lifecycle sullo stesso
  // repository crittografico condiviso). Il parametro resta nel costruttore
  // solo per retrocompatibilità di firma con i call site esistenti.
  constructor(_firId?: string) {}

  private buildCryptoFir(id: string): CryptoFIR {
    return CryptoFIR.create({
      id,
      firNumber: this.firNumber,
      tenantId: 'tenant-uuid-real-001',
      producerPartitaIva: '12345678901',
      producerName: 'Produttore SRL',
      producerAddress: 'Via Test 1',
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

/**
 * Fake dell'orchestrazione RENTRI (R1 Task 2): questa suite copre
 * l'emissione del ciclo di vita, non la decisione di trasmissione secondo
 * la modalità (coperta da `trasmetti-fir-secondo-modalita.use-case.spec.ts`).
 * Qui basta uno spy che registra le invocazioni.
 */
function buildMockTrasmissioneRentri(): { eseguiSeAutomatica: jest.Mock } {
  return {
    eseguiSeAutomatica: jest.fn().mockResolvedValue({ avviata: false, motivo: 'MANUALE' }),
  }
}

describe('EmettiFIRUseCase', () => {
  let useCase: EmettiFIRUseCase
  let repository: MockFIRRepository
  let cryptoRepository: FakeCryptoFIRRepository
  let signatureService: DigitalSignatureService
  let trasmissioneRentri: ReturnType<typeof buildMockTrasmissioneRentri>
  let logger: jest.Mocked<LoggerService>

  const TENANT_ID = 'tenant-uuid-real-001'
  const PRODUTTORE_ID = 'produttore-uuid-different-999'

  const createBozzaFIR = (): FIR => {
    return FIR.create({
      produttoreId: PRODUTTORE_ID,
      tenantId: TENANT_ID,
      rifiuto: {
        cerCode: '13 02 05*',
        quantita: 120,
        unitaMisura: UnitaMisura.KG,
      },
      trasportatoreId: 'tenant-transporter-456',
      destinatarioId: 'tenant-destination-789',
    })
  }

  beforeEach(() => {
    repository = new MockFIRRepository()
    const fir = createBozzaFIR()
    repository.addFIR(fir)
    cryptoRepository = new FakeCryptoFIRRepository(fir.id)
    signatureService = new DigitalSignatureService(buildMockLogger())
    trasmissioneRentri = buildMockTrasmissioneRentri()
    logger = buildMockLogger()
    useCase = new EmettiFIRUseCase(
      repository,
      cryptoRepository,
      signatureService,
      trasmissioneRentri as any,
      logger
    )
  })

  // Le suite originali usano un FIR diverso creato ad-hoc in ogni test tramite
  // `createBozzaFIR()` + `repository.addFIR`; il fir di beforeEach resta
  // inutilizzato in quei casi (nessun conflitto, id sempre nuovo per FIR.create).

  describe('execute', () => {
    it('should emit FIR from BOZZA state', async () => {
      const fir = createBozzaFIR()
      repository.addFIR(fir)
      cryptoRepository = new FakeCryptoFIRRepository(fir.id)
      useCase = new EmettiFIRUseCase(
        repository,
        cryptoRepository,
        signatureService,
        trasmissioneRentri as any,
        logger
      )

      const command = new EmettiFIRCommand(fir.id, 'user-123', 'Mario Rossi')

      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.stato).toBe(FIRStato.EMESSO)
      expect(result.value.numeroProgressivo).toBeDefined()
      expect(result.value.numeroProgressivo).toMatch(/^FIR-\d{4}-\d{6}$/)
    })

    /**
     * R1 Task 2: il punto di aggancio con la trasmissione RENTRI è
     * un'invocazione diretta, non un evento — dopo un'emissione riuscita
     * `TrasmettiFIRSecondoModalitaUseCase.eseguiSeAutomatica` DEVE essere
     * chiamato senza che il chiamante di `EmettiFIRUseCase` debba fare
     * nient'altro: è esattamente "senza alcuna chiamata esplicita".
     */
    it("chiama l'orchestrazione RENTRI dopo un'emissione riuscita, senza alcuna chiamata esplicita del test", async () => {
      const fir = createBozzaFIR()
      repository.addFIR(fir)
      cryptoRepository = new FakeCryptoFIRRepository(fir.id)
      useCase = new EmettiFIRUseCase(
        repository,
        cryptoRepository,
        signatureService,
        trasmissioneRentri as any,
        logger
      )

      const command = new EmettiFIRCommand(fir.id, 'user-123', 'Mario Rossi')
      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(trasmissioneRentri.eseguiSeAutomatica).toHaveBeenCalledTimes(1)
      expect(trasmissioneRentri.eseguiSeAutomatica).toHaveBeenCalledWith({
        firId: fir.id,
        tenantId: TENANT_ID,
      })
    })

    it("NON chiama l'orchestrazione RENTRI se l'emissione fallisce (FIR non trovato)", async () => {
      const command = new EmettiFIRCommand('non-existent-id', 'user-123', 'Test')

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(trasmissioneRentri.eseguiSeAutomatica).not.toHaveBeenCalled()
    })

    it("un fallimento imprevisto dell'orchestrazione RENTRI non invalida un'emissione già valida", async () => {
      const fir = createBozzaFIR()
      repository.addFIR(fir)
      cryptoRepository = new FakeCryptoFIRRepository(fir.id)
      trasmissioneRentri.eseguiSeAutomatica.mockRejectedValue(new Error('boom'))
      useCase = new EmettiFIRUseCase(
        repository,
        cryptoRepository,
        signatureService,
        trasmissioneRentri as any,
        logger
      )

      const command = new EmettiFIRCommand(fir.id, 'user-123', 'Mario Rossi')
      const result = await useCase.execute(command)

      expect(result.isSuccess).toBe(true)
      expect(result.value.stato).toBe(FIRStato.EMESSO)
      expect(logger.error).toHaveBeenCalled()
    })

    it('should generate sequential numero progressivo', async () => {
      const fir1 = createBozzaFIR()
      const fir2 = createBozzaFIR()
      repository.addFIR(fir1)
      repository.addFIR(fir2)

      const command1 = new EmettiFIRCommand(fir1.id, 'user-1', 'User 1')
      const command2 = new EmettiFIRCommand(fir2.id, 'user-2', 'User 2')

      const result1 = await useCase.execute(command1)
      const result2 = await useCase.execute(command2)

      expect(result1.value.numeroProgressivo).toContain('000001')
      expect(result2.value.numeroProgressivo).toContain('000002')
    })

    it('should persist FIR with firma produttore (firma crittografica reale)', async () => {
      const fir = createBozzaFIR()
      repository.addFIR(fir)
      cryptoRepository = new FakeCryptoFIRRepository(fir.id)
      useCase = new EmettiFIRUseCase(
        repository,
        cryptoRepository,
        signatureService,
        trasmissioneRentri as any,
        logger
      )

      const command = new EmettiFIRCommand(fir.id, 'user-123', 'Mario Rossi')

      await useCase.execute(command)

      const saved = await repository.findById(fir.id)
      expect(saved?.firme.produttore).toBeDefined()
      expect(saved?.firme.produttore?.firmatario).toBe('Mario Rossi')
      expect(saved?.firme.produttore?.timestamp).toBeInstanceOf(Date)
      // La firma non è più una costante: certificato porta il valore reale
      // della firma ECDSA prodotta dal provider.
      expect(saved?.firme.produttore?.certificato).not.toBe('FIRMA-NON-QUALIFICATA')
      expect(saved?.firme.produttore?.documentHash).toBeTruthy()
      expect(saved?.firme.produttore?.publicKey).toContain('BEGIN PUBLIC KEY')
    })

    it('should fail if FIR not found', async () => {
      const command = new EmettiFIRCommand('non-existent-id', 'user-123', 'Test')

      const result = await useCase.execute(command)

      expect(result.isFailure).toBe(true)
      expect(result.error).toContain('FIR not found')
    })

    it('should emit domain event on success', async () => {
      const fir = createBozzaFIR()
      repository.addFIR(fir)
      cryptoRepository = new FakeCryptoFIRRepository(fir.id)
      useCase = new EmettiFIRUseCase(
        repository,
        cryptoRepository,
        signatureService,
        trasmissioneRentri as any,
        logger
      )

      const command = new EmettiFIRCommand(fir.id, 'user-123', 'Test')

      const result = await useCase.execute(command)

      expect(result.value.domainEvents.length).toBe(1)
      expect(result.value.domainEvents[0].eventName).toBe('fir.emesso')
    })

    it('due FIR sullo stesso tenant generano progressivi distinti e crescenti', async () => {
      const fir1 = createBozzaFIR()
      const fir2 = createBozzaFIR()
      repository.addFIR(fir1)
      repository.addFIR(fir2)

      const spy = jest.spyOn(repository, 'generateNumeroProgressivo')

      const cmd1 = new EmettiFIRCommand(fir1.id, 'u1', 'A')
      const cmd2 = new EmettiFIRCommand(fir2.id, 'u2', 'B')

      const r1 = await useCase.execute(cmd1)
      const r2 = await useCase.execute(cmd2)

      expect(r1.isSuccess).toBe(true)
      expect(r2.isSuccess).toBe(true)

      expect(r1.value.numeroProgressivo).toContain('000001')
      expect(r2.value.numeroProgressivo).toContain('000002')

      const calls = spy.mock.calls
      expect(calls.length).toBe(2)
      expect(calls[0][0]).toBe(TENANT_ID)
      expect(calls[0][0]).not.toBe(PRODUTTORE_ID)
      expect(calls[1][0]).toBe(TENANT_ID)
    })

    it('should include numero progressivo in current year', async () => {
      const fir = createBozzaFIR()
      repository.addFIR(fir)
      cryptoRepository = new FakeCryptoFIRRepository(fir.id)
      useCase = new EmettiFIRUseCase(
        repository,
        cryptoRepository,
        signatureService,
        trasmissioneRentri as any,
        logger
      )

      const command = new EmettiFIRCommand(fir.id, 'user-123', 'Test')

      const result = await useCase.execute(command)
      const currentYear = new Date().getFullYear()

      expect(result.value.numeroProgressivo).toContain(`FIR-${currentYear}-`)
    })

    it(
      'produce una firma crittografica verificabile e stabile: firmata in BOZZA ' +
        '(firNumber assente dal documento), resta valida dopo l’assegnazione del firNumber',
      async () => {
        const fir = createBozzaFIR()
        repository.addFIR(fir)
        cryptoRepository = new FakeCryptoFIRRepository(fir.id)
        useCase = new EmettiFIRUseCase(
          repository,
          cryptoRepository,
          signatureService,
          trasmissioneRentri as any,
          logger
        )

        const command = new EmettiFIRCommand(fir.id, 'user-123', 'Mario Rossi')
        const result = await useCase.execute(command)
        expect(result.isSuccess).toBe(true)

        // Simula il "reload": rilegge il FIR dal repository lifecycle.
        const reloaded = await repository.findById(fir.id)
        const firma = reloaded!.firme.produttore!

        // Verifica crittografica diretta con i dati persistiti (documentHash,
        // signatureValue, publicKey) — prova che è una firma reale, non un
        // segnaposto.
        const validBeforeAssignment = await signatureService.verify(
          firma.documentHash!,
          firma.certificato,
          firma.publicKey!
        )
        expect(validBeforeAssignment).toBe(true)

        // Ora simula l'assegnazione del firNumber sulla riga fisica (avvenuta
        // nello stesso use-case, con numeroProgressivo generato).
        cryptoRepository.firNumber = reloaded!.numeroProgressivo

        // Ricalcola il documento canonico DOPO l'assegnazione: deve restare
        // identico (firNumber è escluso di proposito da toSignableDocument),
        // quindi l'hash non cambia e la firma resta verificabile.
        const cryptoFirAfterEmission = await cryptoRepository.findById(fir.id)
        const documentAfterEmission = cryptoFirAfterEmission!.toSignableDocument()
        const hashAfterEmission = signatureService.hashDocument(documentAfterEmission)

        expect(hashAfterEmission).toBe(firma.documentHash)

        const validAfterAssignment = await signatureService.verify(
          firma.documentHash!,
          firma.certificato,
          firma.publicKey!
        )
        expect(validAfterAssignment).toBe(true)
      }
    )

    it(
      'fail-closed: se il provider di firma non è configurato (produzione senza ' +
        'SIGNATURE_PROVIDER) la transizione NON avviene e il FIR resta BOZZA',
      async () => {
        const fir = createBozzaFIR()
        repository.addFIR(fir)
        cryptoRepository = new FakeCryptoFIRRepository(fir.id)
        // Nessun provider iniettato + NODE_ENV=production: createSignature deve
        // rifiutarsi di ripiegare in silenzio su sandbox (Task 1).
        const unconfiguredSignatureService = new DigitalSignatureService(buildMockLogger())
        useCase = new EmettiFIRUseCase(
          repository,
          cryptoRepository,
          unconfiguredSignatureService,
          trasmissioneRentri as any,
          logger
        )

        const originalEnv = process.env.NODE_ENV
        process.env.NODE_ENV = 'production'
        try {
          const command = new EmettiFIRCommand(fir.id, 'user-123', 'Mario Rossi')
          const result = await useCase.execute(command)

          expect(result.isFailure).toBe(true)
          expect(result.error).toContain('Firma produttore non riuscita')

          // Il FIR NON è stato mutato: resta BOZZA, senza numero né firma.
          const stillBozza = await repository.findById(fir.id)
          expect(stillBozza?.stato).toBe(FIRStato.BOZZA)
          expect(stillBozza?.numeroProgressivo).toBeNull()
          expect(stillBozza?.firme.produttore).toBeUndefined()
        } finally {
          process.env.NODE_ENV = originalEnv
        }
      }
    )
  })
})
