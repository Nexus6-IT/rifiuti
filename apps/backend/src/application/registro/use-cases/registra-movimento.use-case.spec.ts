import { ConflictException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { RegistraMovimentoUseCase, RICOPIA_ORDINARIA } from './registra-movimento.use-case'
import { PrismaService } from '../../../infrastructure/persistence/prisma.service'
import { LoggerService } from '../../../core/logger/logger.service'
import { RegistraMovimentoCommand } from '../commands/registra-movimento.command'
import { giacenzaDisponibileAl } from '../giacenza-disponibile'
import { annoSolareItaliano } from '../../../core/time/anno-italiano'
import { Prisma } from '@prisma/client'
import { FirGiaRegistratoError } from '../../../core/domain/errors'
import { RegistriService, RegistroNonCoerenteConFirError } from '../registri.service'
import { righeCausaliSistema } from '../causali/catalogo-causali.fixture'
import { hashAnnotazioneV2 } from '../../../domain/waste-movement/waste-movement.entity'

import { abbinaNuovoScarico } from '../../abbinamenti/abbinamenti-scrittura'

jest.mock('../../abbinamenti/abbinamenti-scrittura')
const abbinaMock = abbinaNuovoScarico as jest.MockedFunction<typeof abbinaNuovoScarico>

const REGISTRO = 'registro-uuid-001'
const registroVista = {
  id: REGISTRO,
  unitaLocaleId: null,
  numIscrSito: null,
  denominazione: 'Registro cronologico',
  codice: 'CARICO_SCARICO',
  attivo: true,
  principale: false,
}
/** Finto RegistriService: un solo registro, nessun accesso al database. */
function registriFinto() {
  return {
    preparaRegistri: jest.fn().mockResolvedValue(undefined),
    risolvi: jest.fn().mockResolvedValue(registroVista),
    risolviPerFir: jest.fn().mockResolvedValue(registroVista),
  }
}

jest.mock('../giacenza-disponibile')
const giacenzaMock = giacenzaDisponibileAl as jest.MockedFunction<typeof giacenzaDisponibileAl>

describe('RegistraMovimentoUseCase', () => {
  let useCase: RegistraMovimentoUseCase
  let prisma: any
  let registri: ReturnType<typeof registriFinto>

  const mockLogger = {
    setContext: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }

  const TENANT = 'tenant-uuid-001'
  const USER = 'user-uuid-001'
  const TODAY = new Date('2026-06-29T10:00:00.000Z')

  function buildPrisma(overrides: Partial<typeof prisma> = {}) {
    return {
      registroRifiuti: { findMany: jest.fn().mockResolvedValue([]) },
      wasteMovement: {
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      // Catalogo CER: per default il codice usato nei test ("20 03 01") esiste.
      cERCode: {
        count: jest.fn().mockResolvedValue(1),
      },
      // Catalogo delle causali: le 11 di sistema, nessuna personalizzazione dell'azienda.
      causaleRegistro: { findMany: jest.fn().mockResolvedValue(righeCausaliSistema()) },
      causaleRegistroAzienda: { findMany: jest.fn().mockResolvedValue([]) },
      // FIR collegato: per default esiste e appartiene al tenant.
      fIR: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'fir-id-001',
          status: 'AWAITING_CARRIER',
          firNumber: 'FIR-2026-000007',
          rentriNumeroFir: null,
          rentriStatoFormulario: null,
        }),
      },
      $transaction: jest.fn(),
      ...overrides,
    }
  }

  function buildCommand(): RegistraMovimentoCommand {
    return new RegistraMovimentoCommand(
      TENANT,
      USER,
      'CARICO',
      TODAY,
      TODAY,
      'PRODUZIONE_INTERNA',
      '20 03 01',
      'Rifiuti urbani misti',
      100,
      'KG',
      'Solido',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
  }

  /** SCARICO CONFERIMENTO_TRASPORTATORE sul CER 20 03 01, 100 KG, oggi, senza FIR. */
  function scaricoCmd(
    over: Partial<{ quantity: number; unit: string; movementDate: Date; firId: string }> = {}
  ): RegistraMovimentoCommand {
    return new RegistraMovimentoCommand(
      TENANT,
      USER,
      'SCARICO',
      over.movementDate ?? TODAY,
      TODAY,
      'CONFERIMENTO_TRASPORTATORE',
      '20 03 01',
      undefined,
      over.quantity ?? 100,
      over.unit ?? 'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      over.firId,
      undefined,
      undefined
    )
  }

  const recordScarico = {
    id: 'id-004',
    tenantId: TENANT,
    registroId: REGISTRO,
    progressiveNumber: 6,
    progressiveYear: 2026,
    type: 'SCARICO',
    movementDate: TODAY,
    registrationDate: TODAY,
    causale: 'CONFERIMENTO_TRASPORTATORE',
    cerCode: '20 03 01',
    wasteDescription: null,
    quantity: 100,
    unit: 'KG',
    wastePhysicalState: null,
    wasteHazardClasses: null,
    operationCode: null,
    counterpartName: null,
    counterpartAddress: null,
    firId: null,
    recordedByUserId: USER,
    entryHash: 'a'.repeat(64),
    notes: null,
    createdAt: TODAY,
    updatedAt: TODAY,
  }

  const recordCarico = {
    ...recordScarico,
    id: 'id-005',
    progressiveNumber: 1,
    type: 'CARICO',
    causale: 'PRODUZIONE_INTERNA',
    entryHash: 'b'.repeat(64),
  }

  /** Helper che simula la transazione Prisma con un singolo progressivo disponibile.
   * Aggiunge `$executeRaw` per il mock dell'advisory lock (pg_advisory_xact_lock).
   * Restituisce il `tx` passato alla callback. */
  function _mockTransazione(record: object) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0), // advisory lock no-op nel test
      $queryRaw: jest.fn().mockResolvedValue([{ max_num: null }]),
      registroProgressivoIniziale: { findUnique: jest.fn().mockResolvedValue(null) },
      registroRifiuti: { findMany: jest.fn().mockResolvedValue([]) },
      wasteMovement: {
        create: jest.fn().mockResolvedValue(record),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    }
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => fn(tx))
    return tx
  }

  const g = (complessivo: number, allaData = complessivo, vincoloAl = TODAY) => ({
    saldoComplessivoKg: complessivo,
    disponibileAllaDataKg: allaData,
    vincoloAl,
    unitaNonDiMassaCaricate: [] as string[],
  })

  beforeEach(async () => {
    abbinaMock.mockResolvedValue([])
    giacenzaMock.mockResolvedValue({
      saldoComplessivoKg: 1_000_000,
      disponibileAllaDataKg: 1_000_000,
      vincoloAl: TODAY,
      unitaNonDiMassaCaricate: [],
    })
    prisma = buildPrisma()
    registri = registriFinto()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistraMovimentoUseCase,
        { provide: PrismaService, useValue: prisma },
        { provide: LoggerService, useValue: mockLogger },
        { provide: RegistriService, useValue: registri },
      ],
    }).compile()

    useCase = module.get(RegistraMovimentoUseCase)
  })

  afterEach(() => jest.clearAllMocks())

  // ─── Numero progressivo ──────────────────────────────────────────────────────

  it("assegna progressivo 1 al primo movimento dell'anno", async () => {
    let capturedData: any
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(0),
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: null }]),
        registroProgressivoIniziale: { findUnique: jest.fn().mockResolvedValue(null) },
        wasteMovement: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedData = args.data
            return {
              ...args.data,
              id: 'id-001',
              createdAt: TODAY,
              updatedAt: TODAY,
              quantity: args.data.quantity,
              wasteDescription: null,
              wastePhysicalState: null,
              wasteHazardClasses: null,
              operationCode: null,
              counterpartName: null,
              counterpartAddress: null,
              firId: null,
              recordedByUserId: USER,
              notes: null,
            }
          }),
        },
      }
      return fn(tx)
    })

    const cmd = new RegistraMovimentoCommand(
      TENANT,
      USER,
      'CARICO',
      TODAY,
      TODAY,
      'PRODUZIONE_INTERNA',
      '20 03 01',
      'Rifiuti misti',
      100,
      'KG',
      'Solido',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
    const result = await useCase.execute(cmd)

    expect(result.isSuccess).toBe(true)
    expect(capturedData.progressiveNumber).toBe(1)
    expect(capturedData.progressiveYear).toBe(2026)
  })

  it("assegna progressivo n+1 quando esistono già movimenti nell'anno", async () => {
    let capturedData: any
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(0),
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: 42 }]),
        registroProgressivoIniziale: { findUnique: jest.fn().mockResolvedValue(null) },
        wasteMovement: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedData = args.data
            return { ...args.data, id: 'id-002', createdAt: TODAY, updatedAt: TODAY }
          }),
        },
      }
      return fn(tx)
    })

    const cmd = new RegistraMovimentoCommand(
      TENANT,
      USER,
      'CARICO',
      TODAY,
      TODAY,
      'PRODUZIONE_INTERNA',
      '20 03 01',
      undefined,
      50,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
    const result = await useCase.execute(cmd)

    expect(result.isSuccess).toBe(true)
    expect(capturedData.progressiveNumber).toBe(43)
  })

  // ─── Progressivo iniziale (C-W-02) ───────────────────────────────────────────

  describe('progressivo iniziale', () => {
    async function numeroAssegnato(maxNum: number | null, iniziale: number | null) {
      const tx = _mockTransazione(recordCarico)
      tx.$queryRaw.mockResolvedValue([{ max_num: maxNum }])
      tx.registroProgressivoIniziale.findUnique.mockResolvedValue(
        iniziale === null ? null : { primoProgressivo: iniziale }
      )
      const result = await useCase.execute(buildCommand())
      expect(result.isSuccess).toBe(true)
      return { tx, numero: tx.wasteMovement.create.mock.calls[0][0].data.progressiveNumber }
    }

    it('senza progressivo iniziale la numerazione è quella di oggi', async () => {
      expect((await numeroAssegnato(null, null)).numero).toBe(1)
      const { tx, numero } = await numeroAssegnato(42, null)
      expect(numero).toBe(43)
      expect(tx.registroProgressivoIniziale.findUnique).toHaveBeenCalledWith({
        where: { registroId_anno: { registroId: REGISTRO, anno: 2026 } },
        select: { primoProgressivo: true },
      })
    })

    it("il primo movimento dell'anno prende il progressivo iniziale", async () => {
      expect((await numeroAssegnato(null, 812)).numero).toBe(812)
    })

    it('con movimenti oltre il progressivo iniziale si prosegue dal massimo', async () => {
      expect((await numeroAssegnato(812, 812)).numero).toBe(813)
    })

    it('legge il progressivo iniziale dopo il lock della numerazione', async () => {
      const tx = _mockTransazione(recordCarico)
      const ordine: string[] = []
      tx.$executeRaw.mockImplementation(async () => {
        ordine.push('lock')
        return 0
      })
      tx.registroProgressivoIniziale.findUnique.mockImplementation(async () => {
        ordine.push('iniziale')
        return null
      })
      await useCase.execute(buildCommand())
      expect(ordine).toEqual(['lock', 'iniziale'])
    })
  })

  // ─── Hash vidimazione ────────────────────────────────────────────────────────

  it('persiste un entryHash SHA-256 non vuoto', async () => {
    let capturedData: any
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(0),
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: null }]),
        registroProgressivoIniziale: { findUnique: jest.fn().mockResolvedValue(null) },
        wasteMovement: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedData = args.data
            return { ...args.data, id: 'id-003', createdAt: TODAY, updatedAt: TODAY }
          }),
        },
      }
      return fn(tx)
    })

    const cmd = new RegistraMovimentoCommand(
      TENANT,
      USER,
      'CARICO',
      TODAY,
      TODAY,
      'PRODUZIONE_INTERNA',
      '20 03 01',
      undefined,
      100,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
    await useCase.execute(cmd)

    expect(capturedData.entryHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('salva l hash v2 concatenato all hash dell ultima annotazione e hash_versione 2', async () => {
    let capturedData: any
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(0),
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: 7, entry_hash: 'hash-della-settima' }]),
        registroProgressivoIniziale: { findUnique: jest.fn().mockResolvedValue(null) },
        wasteMovement: {
          create: jest.fn().mockImplementation(async (args: any) => {
            capturedData = args.data
            return { ...args.data, id: 'id-004', createdAt: TODAY, updatedAt: TODAY }
          }),
        },
      }
      return fn(tx)
    })
    await useCase.execute(buildCommand())
    expect(capturedData.progressiveNumber).toBe(8)
    expect(capturedData.hashVersione).toBe(2)
    expect(capturedData.entryHash).toBe(
      hashAnnotazioneV2({
        hashPrecedente: 'hash-della-settima',
        registroId: capturedData.registroId,
        anno: capturedData.progressiveYear,
        numero: 8,
        tipoAnnotazione: 'ORDINARIA',
        type: capturedData.type,
        cerCode: capturedData.cerCode,
        quantita: capturedData.quantity,
        unit: capturedData.unit,
        movementDate: capturedData.movementDate,
        causale: capturedData.causale,
      })
    )
  })

  // ─── Giacenza (dentro la transaction, sotto lock) ───────────────────────────

  it('restituisce errore se lo scarico supera la giacenza disponibile', async () => {
    // Giacenza: 80 kg, scarico richiesto: 100 kg
    giacenzaMock.mockResolvedValue(g(80))
    const tx = _mockTransazione(recordScarico)

    const result = await useCase.execute(scaricoCmd({ quantity: 100 }))

    expect(result.isFailure).toBe(true)
    expect(result.error).toContain('Giacenza insufficiente')
    expect(tx.wasteMovement.create).not.toHaveBeenCalled()
  })

  it('permette lo scarico se la giacenza è sufficiente', async () => {
    giacenzaMock.mockResolvedValue(g(150))
    _mockTransazione(recordScarico)

    const result = await useCase.execute(scaricoCmd({ quantity: 100 }))

    expect(result.isSuccess).toBe(true)
    expect(result.value.type).toBe('SCARICO')
  })

  it('calcola la giacenza dentro la transaction, per tenant, CER e data dello scarico', async () => {
    giacenzaMock.mockResolvedValue(g(50))
    _mockTransazione(recordScarico)
    await useCase.execute(scaricoCmd({ quantity: 10, unit: 'KG', movementDate: TODAY }))
    expect(giacenzaMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      registroId: REGISTRO,
      cerCode: '20 03 01',
      alla: TODAY,
    })
    expect(prisma.wasteMovement.groupBy).not.toHaveBeenCalled()
  })

  it('prende il lock della giacenza dopo quello del progressivo e prima di leggere la giacenza', async () => {
    const ordine: string[] = []
    const tx = _mockTransazione(recordScarico)
    tx.$executeRaw.mockImplementation(async (_s: any, chiave: string) => {
      ordine.push(`lock ${chiave}`)
      return 0
    })
    giacenzaMock.mockImplementation(async () => {
      ordine.push('giacenza')
      return g(1000)
    })
    await useCase.execute(scaricoCmd())
    expect(ordine).toEqual([
      `lock ${REGISTRO}-${annoSolareItaliano(TODAY)}`,
      `lock giacenza|${REGISTRO}|20 03 01`,
      'giacenza',
    ])
  })

  it('il lock della giacenza usa il CER senza asterisco', async () => {
    const chiavi: string[] = []
    const tx = _mockTransazione({ ...recordScarico, cerCode: '20 03 01*' })
    tx.$executeRaw.mockImplementation(async (_s: any, chiave: string) => {
      chiavi.push(chiave)
      return 0
    })
    await useCase.execute(
      new RegistraMovimentoCommand(
        TENANT,
        USER,
        'SCARICO',
        TODAY,
        TODAY,
        'CONFERIMENTO_TRASPORTATORE',
        '200301*',
        undefined,
        10,
        'KG',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined
      )
    )
    expect(chiavi).toContain(`giacenza|${REGISTRO}|20 03 01`)
  })

  it("il messaggio riporta la giacenza nell'unità dello scarico, in formato italiano", async () => {
    giacenzaMock.mockResolvedValue(g(400))
    const tx = _mockTransazione(recordScarico)
    const r = await useCase.execute(scaricoCmd({ quantity: 0.5, unit: 'tonnellate' }))
    expect(r.isFailure).toBe(true)
    expect(r.error).toContain('restano 0,4 t, richiesti 0,5 t')
    expect(r.error).not.toContain('Errore durante la registrazione')
    expect(tx.wasteMovement.create).not.toHaveBeenCalled()
  })

  it("con l'unità vuota il messaggio scrive kg", async () => {
    giacenzaMock.mockResolvedValue(g(1234.5))
    _mockTransazione(recordScarico)
    const r = await useCase.execute(scaricoCmd({ quantity: 2000, unit: '' }))
    expect(r.error).toContain('restano 1.234,5 kg, richiesti 2.000 kg')
  })

  it('con il saldo complessivo già negativo il messaggio lo dice', async () => {
    giacenzaMock.mockResolvedValue(g(-100))
    _mockTransazione(recordScarico)
    const r = await useCase.execute(scaricoCmd({ quantity: 1 }))
    expect(r.error).toContain('il registro risulta già sotto zero di 100 kg')
    expect(r.error).not.toContain('-100')
  })

  it('il messaggio di giacenza insufficiente indica quale carico registrare', async () => {
    giacenzaMock.mockResolvedValue(g(10))
    _mockTransazione(recordScarico)
    const r = await useCase.execute(scaricoCmd({ quantity: 50 }))
    expect(r.error).toContain(
      'inserisci la giacenza iniziale del registro (Registro → Giacenze iniziali)'
    )
    expect(r.error).not.toContain('Altro carico')
    expect(r.error).toContain('se è stato prodotto ora, usa Produzione interna.')
  })

  it('scarico in kg con carichi solo in litri: registrato con avviso', async () => {
    giacenzaMock.mockResolvedValue({ ...g(0), unitaNonDiMassaCaricate: ['LITRI', 'M3'] })
    const tx = _mockTransazione(recordScarico)
    const r = await useCase.execute(scaricoCmd({ quantity: 4800 }))
    expect(r.isSuccess).toBe(true)
    expect(tx.wasteMovement.create).toHaveBeenCalled()
    expect(r.value.avvisi).toEqual([
      'Il CER 20 03 01 ha carichi registrati in LITRI, M3 che non si possono confrontare con i kg: ' +
        'lo scarico è registrato, ma la giacenza va verificata a mano ' +
        '(i carichi in kg o tonnellate coprono 0 kg).',
    ])
    expect(r.value.avvisi[0]).not.toContain('Altro carico')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('non di massa'),
      expect.objectContaining({ cerCode: '20 03 01' })
    )
  })

  it("con carichi in kg insufficienti e carichi in litri l'avviso riporta i kg coperti", async () => {
    giacenzaMock.mockResolvedValue({ ...g(1234.5), unitaNonDiMassaCaricate: ['LITRI'] })
    _mockTransazione(recordScarico)
    const r = await useCase.execute(scaricoCmd({ quantity: 5000 }))
    expect(r.isSuccess).toBe(true)
    expect(r.value.avvisi[0]).toContain('coprono 1.234,5 kg')
  })

  it('uno scarico retrodatato coperto dal saldo complessivo si registra con un avviso', async () => {
    giacenzaMock.mockResolvedValue(g(100, 0))
    const tx = _mockTransazione(recordScarico)
    const r = await useCase.execute(
      scaricoCmd({ quantity: 50, movementDate: new Date('2026-03-05T00:00:00Z') })
    )
    expect(r.isSuccess).toBe(true)
    expect(tx.wasteMovement.create).toHaveBeenCalled()
    expect(r.value.avvisi).toEqual([
      expect.stringContaining(
        'Lo scarico è datato 05/03/2026, ma a quella data il registro ha disponibili 0 kg'
      ),
    ])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Scarico registrato con un ordine di date incoerente',
      expect.objectContaining({ cerCode: '20 03 01' })
    )
  })

  it("l'avviso indica la data del saldo che fa da limite", async () => {
    giacenzaMock.mockResolvedValue(g(100, 0, new Date('2026-03-03T00:00:00Z')))
    _mockTransazione(recordScarico)
    const r = await useCase.execute(
      scaricoCmd({ movementDate: new Date('2026-03-02T00:00:00Z'), quantity: 10 })
    )
    expect(r.value.avvisi[0]).toContain('(il limite viene dal saldo del 03/03/2026)')
  })

  it("l'avviso non cita il limite se il saldo che lo fissa è dello stesso giorno dello scarico", async () => {
    // Scarico alle 23:30 UTC del 2 marzo = 3 marzo italiano; vincoloAl = 3 marzo (mezzanotte UTC).
    // Confrontando gli istanti il limite risulterebbe "dopo"; confrontando i giorni no.
    giacenzaMock.mockResolvedValue(g(100, 0, new Date('2026-03-03T00:00:00Z')))
    _mockTransazione(recordScarico)
    const r = await useCase.execute(
      scaricoCmd({ movementDate: new Date('2026-03-02T23:30:00Z'), quantity: 10 })
    )
    expect(r.value.avvisi).toHaveLength(1)
    expect(r.value.avvisi[0]).not.toContain('il limite viene dal saldo')
  })

  it('senza problemi di date non ci sono avvisi', async () => {
    _mockTransazione(recordScarico)
    expect((await useCase.execute(scaricoCmd())).value.avvisi).toEqual([])
  })

  it.each([[NaN], [undefined], [null]])(
    'se la giacenza non è un numero finito (%p) lo scarico è rifiutato',
    async valore => {
      giacenzaMock.mockResolvedValue({
        saldoComplessivoKg: valore as any,
        disponibileAllaDataKg: 1000,
        vincoloAl: TODAY,
        unitaNonDiMassaCaricate: [],
      })
      const tx = _mockTransazione(recordScarico)
      const r = await useCase.execute(scaricoCmd({ quantity: 1 }))
      expect(r.isFailure).toBe(true)
      expect(r.error).toContain('Impossibile verificare la giacenza')
      expect(tx.wasteMovement.create).not.toHaveBeenCalled()
    }
  )

  it('uno scarico in unità non di massa salta il controllo con un warning', async () => {
    const tx = _mockTransazione(recordScarico)
    const r = await useCase.execute(scaricoCmd({ quantity: 3, unit: 'M3' }))
    expect(r.isSuccess).toBe(true)
    expect(giacenzaMock).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Scarico in unità non di massa: controllo di giacenza saltato',
      expect.objectContaining({ unit: 'M3' })
    )
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1) // solo il lock del progressivo
    expect(tx.wasteMovement.create).toHaveBeenCalled()
  })

  it('un CARICO non legge la giacenza e non prende il lock della giacenza', async () => {
    const tx = _mockTransazione(recordCarico)
    const r = await useCase.execute(buildCommand())
    expect(r.isSuccess).toBe(true)
    expect(giacenzaMock).not.toHaveBeenCalled()
    const chiavi = tx.$executeRaw.mock.calls.map((c: any[]) => c.slice(1).join(' '))
    expect(chiavi).toEqual([`${REGISTRO}-${annoSolareItaliano(TODAY)}`])
    expect(chiavi.some((k: string) => k.startsWith('giacenza|'))).toBe(false)
  })

  it('abbinamenti: uno SCARICO chiama la proposta FIFO nella stessa transaction e ne riporta gli avvisi', async () => {
    giacenzaMock.mockResolvedValue(g(150))
    const tx = _mockTransazione(recordScarico)
    abbinaMock.mockResolvedValueOnce(['avviso di abbinamento'])
    const r = await useCase.execute(scaricoCmd({ quantity: 100 }))
    expect(r.isSuccess).toBe(true)
    expect(abbinaMock).toHaveBeenCalledWith(tx, {
      tenantId: TENANT,
      registroId: REGISTRO,
      scaricoId: recordScarico.id,
      userId: USER,
    })
    expect(r.value.avvisi).toContain('avviso di abbinamento')
  })

  it('abbinamenti: un CARICO non chiama la proposta', async () => {
    _mockTransazione(recordCarico)
    await useCase.execute(buildCommand())
    expect(abbinaMock).not.toHaveBeenCalled()
  })

  it('abbinamenti: un errore della proposta fa fallire la registrazione', async () => {
    giacenzaMock.mockResolvedValue(g(150))
    _mockTransazione(recordScarico)
    abbinaMock.mockRejectedValueOnce(new Error('lettore guasto'))
    const r = await useCase.execute(scaricoCmd({ quantity: 100 }))
    expect(r.isSuccess).toBe(false)
  })

  it('un CARICO restituisce avvisi vuoti', async () => {
    _mockTransazione(recordCarico)
    expect((await useCase.execute(buildCommand())).value.avvisi).toEqual([])
  })

  it('versione della causale propria chiusa nel frattempo: il 409 CAUSALE_MODIFICATA esce intatto, non diventa un Result.fail', async () => {
    prisma.causaleRegistroAzienda.findMany.mockResolvedValue([
      {
        id: 'v-1',
        natura: 'PROPRIA',
        codice: 'AZ_PROVA',
        verso: 'CARICO',
        descrizione: 'Prova',
        ruoloMud: 'ESCLUSO',
        codiceRentri: null,
        operazione: null,
        ordine: 0,
        validaDal: new Date('2026-01-01T00:00:00Z'),
        validaAl: null,
      },
    ])
    const tx = _mockTransazione(recordCarico)
    // La SELECT ... FOR KEY SHARE non trova piu' la versione (o non e' piu' valida).
    tx.$queryRaw.mockImplementation(async (...args: unknown[]) =>
      (args[0] as TemplateStringsArray).join('?').includes('FOR KEY SHARE')
        ? []
        : [{ max_num: null }]
    )
    const cmd = buildCommand()
    const esito = useCase.execute(Object.assign(cmd, { causale: 'AZ_PROVA' }))
    await expect(esito).rejects.toBeInstanceOf(ConflictException)
    await expect(esito).rejects.toMatchObject({
      response: { error: 'CAUSALE_MODIFICATA' },
    })
    expect(tx.wasteMovement.create).not.toHaveBeenCalled()
  })

  // ─── Ritardo registrazione ───────────────────────────────────────────────────

  it('segnala fuoriTermine se la data di registrazione supera i 14 gg dalla data operazione', async () => {
    const movDate = new Date('2026-06-01T00:00:00.000Z')
    const regDate = new Date('2026-06-20T00:00:00.000Z') // 19 gg dopo

    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(0),
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: null }]),
        registroProgressivoIniziale: { findUnique: jest.fn().mockResolvedValue(null) },
        wasteMovement: {
          create: jest.fn().mockResolvedValue({
            id: 'id-005',
            tenantId: TENANT,
            progressiveNumber: 1,
            progressiveYear: 2026,
            type: 'CARICO',
            movementDate: movDate,
            registrationDate: regDate,
            causale: 'PRODUZIONE_INTERNA',
            cerCode: '20 03 01',
            wasteDescription: null,
            quantity: 50,
            unit: 'KG',
            wastePhysicalState: null,
            wasteHazardClasses: null,
            operationCode: null,
            counterpartName: null,
            counterpartAddress: null,
            firId: null,
            recordedByUserId: USER,
            entryHash: 'b'.repeat(64),
            notes: null,
            createdAt: TODAY,
            updatedAt: TODAY,
          }),
        },
      }
      return fn(tx)
    })

    const cmd = new RegistraMovimentoCommand(
      TENANT,
      USER,
      'CARICO',
      movDate,
      regDate,
      'PRODUZIONE_INTERNA',
      '20 03 01',
      undefined,
      50,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
    const result = await useCase.execute(cmd)

    expect(result.isSuccess).toBe(true)
    expect(result.value.fuoriTermine).toBe(true)
    expect(result.value.ritardoGg).toBeGreaterThan(0)
  })

  // ─── Causali ─────────────────────────────────────────────────────────────────

  it('rifiuta una causale di carico non valida', async () => {
    const cmd = new RegistraMovimentoCommand(
      TENANT,
      USER,
      'CARICO',
      TODAY,
      TODAY,
      'CONFERIMENTO_TRASPORTATORE' as any, // causale di scarico su tipo CARICO
      '20 03 01',
      undefined,
      100,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
    const result = await useCase.execute(cmd)
    // Il dominio lancia un'eccezione che la use-case cattura come Result.fail
    expect(result.isFailure).toBe(true)
    expect(result.error).toContain('Causale non valida per CARICO')
  })

  // ─── Codice CER inesistente ──────────────────────────────────────────────────

  it('rifiuta un movimento con codice CER non presente nel catalogo', async () => {
    prisma.cERCode.count.mockResolvedValue(0)

    const cmd = new RegistraMovimentoCommand(
      TENANT,
      USER,
      'CARICO',
      TODAY,
      TODAY,
      'PRODUZIONE_INTERNA',
      '99 99 99',
      undefined,
      100,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
    const result = await useCase.execute(cmd)

    expect(result.isFailure).toBe(true)
    expect(result.error).toContain('Codice CER non valido')
  })

  // ─── FIR collegato inesistente ───────────────────────────────────────────────

  it('rifiuta un movimento con firId inesistente (no FK penzolante)', async () => {
    prisma.fIR.findFirst.mockResolvedValue(null)

    const cmd = new RegistraMovimentoCommand(
      TENANT,
      USER,
      'CARICO',
      TODAY,
      TODAY,
      'PRODUZIONE_INTERNA',
      '20 03 01',
      undefined,
      100,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'fir-inesistente',
      undefined,
      undefined
    )
    const result = await useCase.execute(cmd)

    expect(result.isFailure).toBe(true)
    expect(result.error).toContain('FIR collegato non trovato')
  })

  it.each([
    [
      { status: 'DRAFT' },
      "Il FIR FIR-2026-000007 è ancora in bozza: si registra nel registro solo dopo l'emissione. Se il trasporto è già avvenuto con un altro formulario, registra lo scarico senza collegare questo FIR.",
    ],
    [
      { status: 'AWAITING_PRODUCER' },
      "Il FIR FIR-2026-000007 è ancora in bozza: si registra nel registro solo dopo l'emissione. Se il trasporto è già avvenuto con un altro formulario, registra lo scarico senza collegare questo FIR.",
    ],
    [
      { status: 'CANCELLED', rentriNumeroFir: 'ABC123' },
      'Il FIR ABC123 è annullato: non si può collegare a un movimento del registro.',
    ],
    [
      { status: 'AWAITING_CARRIER', rentriStatoFormulario: 'Annullato' },
      'Il FIR FIR-2026-000007 è annullato: non si può collegare a un movimento del registro.',
    ],
    [
      { status: 'BOH' },
      "Il FIR FIR-2026-000007 ha uno stato non riconosciuto (BOH): non si può collegare a un movimento; contattare l'assistenza.",
    ],
  ])('rifiuta il collegamento a un FIR %o', async (over, messaggio) => {
    prisma.fIR.findFirst.mockResolvedValue({
      id: 'fir-id-001',
      firNumber: 'FIR-2026-000007',
      rentriNumeroFir: null,
      rentriStatoFormulario: null,
      ...over,
    })
    const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
    expect(r.isFailure).toBe(true)
    expect(r.error).toBe(messaggio)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it.each(['AWAITING_CARRIER', 'AWAITING_RECEIVER', 'COMPLETED', 'SYNCED_TO_RENTRI'])(
    'accetta il collegamento a un FIR %s',
    async status => {
      prisma.fIR.findFirst.mockResolvedValue({
        id: 'fir-id-001',
        status,
        firNumber: 'FIR-2026-000007',
        rentriNumeroFir: null,
        rentriStatoFormulario: null,
      })
      _mockTransazione(recordScarico)
      expect((await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))).isSuccess).toBe(true)
    }
  )

  it('accetta il collegamento a un FIR in bozza locale con numero RENTRI (acquisito o agganciato)', async () => {
    prisma.fIR.findFirst.mockResolvedValue({
      id: 'fir-id-001',
      status: 'DRAFT',
      firNumber: null,
      rentriNumeroFir: 'RENTRI-1',
      rentriStatoFormulario: null,
    })
    _mockTransazione(recordScarico)
    expect((await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))).isSuccess).toBe(true)
  })

  // ─── Data nel futuro ─────────────────────────────────────────────────────────

  it("rifiuta un movimento con data dell'operazione nel futuro", async () => {
    const futuro = new Date('2099-01-01T00:00:00.000Z')

    const cmd = new RegistraMovimentoCommand(
      TENANT,
      USER,
      'CARICO',
      futuro,
      futuro,
      'PRODUZIONE_INTERNA',
      '20 03 01',
      undefined,
      100,
      'KG',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
    const result = await useCase.execute(cmd)

    expect(result.isFailure).toBe(true)
    expect(result.error).toContain('non può essere nel futuro')
  })

  // ─── Due movimenti consecutivi ───────────────────────────────────────────────

  it('due movimenti consecutivi → progressivi 1, 2 (advisory lock, nessun errore SQL)', async () => {
    // Simula due chiamate sequenziali: la seconda vede max_num = 1 (inserito dalla prima).
    let chiamate = 0
    prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      chiamate++
      const maxNum = chiamate === 1 ? null : 1
      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(0), // advisory lock
        $queryRaw: jest.fn().mockResolvedValue([{ max_num: maxNum }]),
        registroProgressivoIniziale: { findUnique: jest.fn().mockResolvedValue(null) },
        wasteMovement: {
          create: jest.fn().mockImplementation(async (args: any) => ({
            ...args.data,
            id: `id-consec-${chiamate}`,
            createdAt: TODAY,
            updatedAt: TODAY,
            quantity: args.data.quantity,
            wasteDescription: null,
            wastePhysicalState: null,
            wasteHazardClasses: null,
            operationCode: null,
            counterpartName: null,
            counterpartAddress: null,
            firId: null,
            recordedByUserId: USER,
            notes: null,
          })),
        },
      }
      return fn(tx)
    })

    const cmd = buildCommand()
    const r1 = await useCase.execute(cmd)
    const r2 = await useCase.execute(cmd)

    expect(r1.isSuccess).toBe(true)
    expect(r2.isSuccess).toBe(true)
    expect(r1.value.progressiveNumber).toBe(1)
    expect(r2.value.progressiveNumber).toBe(2)
    // L'advisory lock deve essere stato chiamato per entrambe le transazioni
    expect(chiamate).toBe(2)
  })

  // ─── Ricopia FIR idempotente ─────────────────────────────────────────────────

  it('la stessa ricopia ripetuta restituisce il movimento esistente', async () => {
    const tx = _mockTransazione(recordScarico)
    tx.wasteMovement.findMany.mockResolvedValue([
      {
        ...recordScarico,
        progressiveNumber: 7,
        progressiveYear: 2026,
        firId: 'fir-id-001',
        quantity: 100,
        unit: 'KG',
        movementDate: TODAY,
      },
    ])
    const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
    expect(r.isSuccess).toBe(true)
    expect(r.value).toMatchObject({ progressiveNumber: 7, giaRegistrato: true, avvisi: [] })
    expect(tx.wasteMovement.create).not.toHaveBeenCalled()
    expect(giacenzaMock).not.toHaveBeenCalled()
    // ricopia gia registrata: nessuna riga di abbinamento in piu
    expect(abbinaMock).not.toHaveBeenCalled()
  })

  it('il confronto usa la quantità arrotondata come la salva il database', async () => {
    const tx = _mockTransazione(recordScarico)
    tx.wasteMovement.findMany.mockResolvedValue([
      {
        ...recordScarico,
        progressiveNumber: 7,
        progressiveYear: 2026,
        quantity: new Prisma.Decimal('1.01'),
        unit: 'KG',
        movementDate: TODAY,
      },
    ])
    const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001', quantity: 1.005 }))
    expect(r.value).toMatchObject({ giaRegistrato: true })
  })

  it('una seconda ricopia con quantità diversa è rifiutata', async () => {
    const tx = _mockTransazione(recordScarico)
    tx.wasteMovement.findMany.mockResolvedValue([
      {
        ...recordScarico,
        progressiveNumber: 7,
        progressiveYear: 2026,
        quantity: 100,
        unit: 'KG',
        movementDate: TODAY,
      },
    ])
    const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001', quantity: 90 }))
    expect(r.error).toBe(new FirGiaRegistratoError(7, 2026).message)
    // solo le registrazioni ordinarie contano come ricopia: le correzioni copiano firId
    expect((tx.wasteMovement.findMany.mock.calls[0][0] as any).where).toMatchObject({
      tipoAnnotazione: 'ORDINARIA',
    })
    expect(tx.wasteMovement.create).not.toHaveBeenCalled()
  })

  it('un movimento nuovo ha giaRegistrato false e salva firIdRicopia con la chiave ordinaria', async () => {
    const tx = _mockTransazione(recordScarico)
    const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
    expect(r.value.giaRegistrato).toBe(false)
    expect(tx.wasteMovement.create.mock.calls[0][0].data).toMatchObject({
      firId: 'fir-id-001',
      firIdRicopia: 'fir-id-001',
      ricopiaChiave: '',
    })
  })

  it('la chiave della ricopia ordinaria è la stringa vuota, come il default della colonna', () => {
    expect(RICOPIA_ORDINARIA).toBe('')
  })

  it('cerca le ricopie esistenti per tenant, FIR, tipo e chiave ordinaria', async () => {
    const tx = _mockTransazione(recordScarico)
    await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
    expect(tx.wasteMovement.findMany.mock.calls[0][0]).toMatchObject({
      where: { tenantId: TENANT, firId: 'fir-id-001', type: 'SCARICO', ricopiaChiave: '' },
      orderBy: { createdAt: 'asc' },
    })
  })

  it('il lock del FIR si prende per primo, prima del progressivo e della giacenza', async () => {
    const tx = _mockTransazione(recordScarico)
    await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
    const chiavi = tx.$executeRaw.mock.calls.map((c: unknown[]) => String(c[1]))
    expect(chiavi).toEqual([
      `fir-registro|${TENANT}|fir-id-001`,
      `${REGISTRO}-${annoSolareItaliano(TODAY)}`,
      `giacenza|${REGISTRO}|20 03 01`,
    ])
  })

  it("prende i lock nell'ordine FIR, progressivo, giacenza e non prende registro-init dentro la transazione", async () => {
    const tx = _mockTransazione(recordScarico)
    await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
    const chiavi = tx.$executeRaw.mock.calls.map((c: unknown[]) => String(c[1]))
    expect(chiavi.map((k: string) => k.split('|')[0])).toEqual([
      'fir-registro',
      `${REGISTRO}-${annoSolareItaliano(TODAY)}`,
      'giacenza',
    ])
    expect(chiavi.some((k: string) => k.includes('registro-init'))).toBe(false)
    // La preparazione dei registri (con il suo lock) e' PRIMA della transazione di registrazione.
    expect(registri.preparaRegistri).toHaveBeenCalledWith(TENANT, undefined)
    expect(registri.preparaRegistri.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$transaction.mock.invocationCallOrder[0]
    )
  })

  it('senza FIR risolve il registro con risolvi, con un FIR con risolviPerFir (D10), passando il registroId richiesto', async () => {
    _mockTransazione(recordScarico)
    await useCase.execute({
      ...scaricoCmd(),
      registroId: 'reg-richiesto',
    } as RegistraMovimentoCommand)
    expect(registri.risolvi).toHaveBeenCalledWith(expect.anything(), TENANT, 'reg-richiesto')
    expect(registri.risolviPerFir).not.toHaveBeenCalled()
    await useCase.execute({
      ...scaricoCmd({ firId: 'fir-id-001' }),
      registroId: 'reg-richiesto',
    } as RegistraMovimentoCommand)
    expect(registri.risolviPerFir).toHaveBeenCalledWith(expect.anything(), TENANT, 'reg-richiesto')
  })

  it('un errore di dominio dei registri diventa un fallimento con il suo messaggio', async () => {
    _mockTransazione(recordScarico)
    registri.risolviPerFir.mockRejectedValue(new RegistroNonCoerenteConFirError())
    const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
    expect(r.isFailure).toBe(true)
    expect(r.error).toBe(new RegistroNonCoerenteConFirError().message)
  })

  it('senza FIR non prende il lock del FIR e non cerca ricopie', async () => {
    const tx = _mockTransazione(recordScarico)
    const r = await useCase.execute(scaricoCmd())
    expect(r.value.giaRegistrato).toBe(false)
    expect(tx.wasteMovement.findMany).not.toHaveBeenCalled()
    expect(tx.$executeRaw.mock.calls.map((c: unknown[]) => String(c[1]))).not.toContain(
      expect.stringContaining('fir-registro')
    )
    expect(tx.wasteMovement.create.mock.calls[0][0].data.firIdRicopia).toBeUndefined()
  })

  it('una ricopia già registrata calcola il ritardo dalle date del movimento esistente', async () => {
    const tx = _mockTransazione(recordScarico)
    // Movimento esistente registrato 20 giorni dopo l'operazione: 6 giorni oltre il termine.
    const operazione = new Date('2026-06-01T00:00:00.000Z')
    tx.wasteMovement.findMany.mockResolvedValue([
      {
        ...recordScarico,
        progressiveNumber: 7,
        movementDate: operazione,
        registrationDate: new Date('2026-06-21T00:00:00.000Z'),
      },
    ])
    const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001', movementDate: operazione }))
    expect(r.value).toMatchObject({ giaRegistrato: true, fuoriTermine: true, ritardoGg: 6 })
  })

  it("un doppio sull'indice unico della ricopia diventa il messaggio del FIR già registrato", async () => {
    const tx = _mockTransazione(recordScarico)
    tx.wasteMovement.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['tenant_id', 'fir_id_ricopia', 'type', 'ricopia_chiave'] },
      })
    )
    const findFirst = jest
      .spyOn(prisma.wasteMovement, 'findFirst')
      .mockResolvedValueOnce({ id: 'orig', progressiveNumber: 9, progressiveYear: 2026 })
      .mockResolvedValueOnce(null)
    const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
    expect(r.error).toBe(new FirGiaRegistratoError(9, 2026).message)
    expect((findFirst.mock.calls[0][0] as any).where).toMatchObject({
      tenantId: TENANT,
      firIdRicopia: 'fir-id-001',
      type: 'SCARICO',
      ricopiaChiave: '',
      tipoAnnotazione: 'ORDINARIA',
    })
  })

  it('con più registri il doppio sull indice unico nomina il registro del movimento esistente', async () => {
    const tx = _mockTransazione(recordScarico)
    tx.wasteMovement.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['tenant_id', 'fir_id_ricopia', 'type', 'ricopia_chiave'] },
      })
    )
    jest
      .spyOn(prisma.wasteMovement, 'findFirst')
      .mockResolvedValueOnce({
        id: 'orig',
        progressiveNumber: 9,
        progressiveYear: 2026,
        registroId: 'reg-b',
      })
      .mockResolvedValueOnce(null)
    prisma.registroRifiuti = {
      findMany: jest.fn().mockResolvedValue([
        { id: 'reg-a', descrizione: 'Registro A', unitaLocale: null },
        {
          id: 'reg-b',
          descrizione: 'Registro B',
          unitaLocale: { denominazione: 'Sede di Torino' },
        },
      ]),
    }
    const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))
    expect(r.error).toBe(new FirGiaRegistratoError(9, 2026, 'Sede di Torino').message)
    expect(r.error).toContain('nel registro Sede di Torino')
  })

  it('se la lettura del doppio fallisce, execute risponde con un errore e non lancia', async () => {
    const tx = _mockTransazione(recordScarico)
    tx.wasteMovement.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
        meta: { target: ['tenant_id', 'fir_id_ricopia', 'type', 'ricopia_chiave'] },
      })
    )
    jest.spyOn(prisma.wasteMovement, 'findFirst').mockRejectedValue(new Error('connessione persa'))

    const r = await useCase.execute(scaricoCmd({ firId: 'fir-id-001' }))

    expect(r.isFailure).toBe(true)
    expect(r.error).toMatch(/^Errore durante la registrazione/)
    expect(r.error).not.toContain('connessione persa')
  })
})

describe('RegistraMovimentoUseCase: tempo italiano', () => {
  const TENANT = 'tenant-uuid-001'
  const USER = 'user-uuid-001'
  let tzOriginale: string | undefined
  let useCase: RegistraMovimentoUseCase
  let capturedData: any
  let lockArgs: any[]

  beforeAll(() => {
    tzOriginale = process.env.TZ
    process.env.TZ = 'UTC'
  })

  afterAll(() => {
    if (tzOriginale === undefined) delete process.env.TZ
    else process.env.TZ = tzOriginale
  })

  beforeEach(async () => {
    capturedData = undefined
    lockArgs = []
    const prisma: any = {
      wasteMovement: { groupBy: jest.fn().mockResolvedValue([]), create: jest.fn() },
      // Catalogo delle causali: le 11 di sistema, nessuna personalizzazione dell'azienda.
      causaleRegistro: { findMany: jest.fn().mockResolvedValue(righeCausaliSistema()) },
      causaleRegistroAzienda: { findMany: jest.fn().mockResolvedValue([]) },
      cERCode: { count: jest.fn().mockResolvedValue(1) },
      fIR: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'fir-id-001',
          status: 'AWAITING_CARRIER',
          firNumber: 'FIR-2026-000007',
          rentriNumeroFir: null,
          rentriStatoFormulario: null,
        }),
      },
      $transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => {
        const tx = {
          $executeRaw: jest.fn().mockImplementation(async (...args: any[]) => {
            lockArgs.push(args)
            return 0
          }),
          $queryRaw: jest.fn().mockResolvedValue([{ max_num: null }]),
          registroProgressivoIniziale: { findUnique: jest.fn().mockResolvedValue(null) },
          wasteMovement: {
            create: jest.fn().mockImplementation(async (args: any) => {
              capturedData = args.data
              return {
                ...args.data,
                id: 'id-001',
                createdAt: new Date(),
                updatedAt: new Date(),
                wasteDescription: null,
                wastePhysicalState: null,
                wasteHazardClasses: null,
                operationCode: null,
                counterpartName: null,
                counterpartAddress: null,
                firId: null,
                recordedByUserId: USER,
                notes: null,
              }
            }),
          },
        }
        return fn(tx)
      }),
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegistraMovimentoUseCase,
        { provide: PrismaService, useValue: prisma },
        { provide: RegistriService, useValue: registriFinto() },
        {
          provide: LoggerService,
          useValue: { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        },
      ],
    }).compile()
    useCase = module.get(RegistraMovimentoUseCase)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function comando(movementDate: string, registrationDate: string): RegistraMovimentoCommand {
    return new RegistraMovimentoCommand(
      TENANT,
      USER,
      'CARICO',
      new Date(movementDate),
      new Date(registrationDate),
      'PRODUZIONE_INTERNA',
      '20 03 01',
      'Rifiuti urbani misti',
      100,
      'KG',
      'Solido',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    )
  }

  async function esegui(adesso: string, movementDate: string, registrationDate = movementDate) {
    jest.useFakeTimers()
    jest.setSystemTime(new Date(adesso))
    return useCase.execute(comando(movementDate, registrationDate))
  }

  it('attribuisce al 2026 un movimento registrato alle 00:30 del 1° gennaio, anche con il processo in UTC', async () => {
    const r = await esegui('2025-12-31T23:40:00.000Z', '2025-12-31T23:30:00.000Z')
    expect(r.isSuccess).toBe(true)
    expect(capturedData.progressiveYear).toBe(2026)
    expect(JSON.stringify(lockArgs)).toContain(`${REGISTRO}-2026`)
  })

  it('lascia al 2025 un movimento registrato alle 23:59 del 31 dicembre', async () => {
    const r = await esegui('2025-12-31T23:10:00.000Z', '2025-12-31T22:59:59.999Z')
    expect(r.isSuccess).toBe(true)
    expect(capturedData.progressiveYear).toBe(2025)
  })

  it("accetta la data di oggi registrata fra le 00:00 e l'01:00 italiane", async () => {
    const r = await esegui('2026-03-10T23:30:00.000Z', '2026-03-11T00:00:00.000Z')
    expect(r.isSuccess).toBe(true)
  })

  it('accetta la data di oggi alle 00:30 anche in ora legale', async () => {
    const r = await esegui('2026-07-10T22:30:00.000Z', '2026-07-11T00:00:00.000Z')
    expect(r.isSuccess).toBe(true)
  })

  it('rifiuta la data di domani', async () => {
    const r = await esegui('2026-03-10T23:30:00.000Z', '2026-03-12T00:00:00.000Z')
    expect(r.isFailure).toBe(true)
    expect(r.error).toContain('nel futuro: 12/03/2026')
  })
})
