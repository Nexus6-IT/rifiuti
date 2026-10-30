import { PIVA_VALIDA, partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ContractService } from './contract.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { LoggerService } from '../../core/logger/logger.service'

describe('ContractService', () => {
  let service: ContractService
  let prisma: any

  beforeEach(async () => {
    const mockLogger = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any
    prisma = {
      contract: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      // Registri anagrafici: per difetto le parti ESISTONO, così i test che non
      // parlano di validazione dei riferimenti restano leggibili. I test che la
      // riguardano sovrascrivono il mock caso per caso.
      produttore: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      trasportatore: {
        findFirst: jest.fn().mockResolvedValue({ id: 'c1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      destinatario: {
        findFirst: jest.fn().mockResolvedValue({ id: 'c1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractService,
        { provide: PrismaService, useValue: prisma },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile()
    service = module.get(ContractService)
  })

  describe('changeStatus (workflow)', () => {
    it('ammette DRAFT → PENDING_APPROVAL', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'DRAFT' })
      prisma.contract.update.mockResolvedValue({ id: 'c1', status: 'PENDING_APPROVAL' })

      const res = await service.changeStatus('t1', 'c1', 'PENDING_APPROVAL')
      expect(res.status).toBe('PENDING_APPROVAL')
      expect(prisma.contract.update).toHaveBeenCalled()
    })

    it('rifiuta una transizione non ammessa (DRAFT → ACTIVE)', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'DRAFT' })
      await expect(service.changeStatus('t1', 'c1', 'ACTIVE')).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(prisma.contract.update).not.toHaveBeenCalled()
    })

    it('rifiuta transizioni da stato terminale (TERMINATED)', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'TERMINATED' })
      await expect(service.changeStatus('t1', 'c1', 'ACTIVE')).rejects.toBeInstanceOf(
        BadRequestException
      )
    })

    it('404 se il contratto non esiste', async () => {
      prisma.contract.findFirst.mockResolvedValue(null)
      await expect(service.changeStatus('t1', 'x', 'ACTIVE')).rejects.toBeInstanceOf(
        NotFoundException
      )
    })
  })

  describe('getAutoFillForFir', () => {
    it('restituisce i dati del contratto attivo che copre il CER', async () => {
      prisma.contract.findFirst.mockResolvedValue({
        id: 'c1',
        contractNumber: 'CTR-2026-001',
        counterpartyId: 'tr-1',
        counterpartyType: 'TRANSPORTER',
        pricingModel: 'PAY_BY_WEIGHT',
        basePrice: 120,
        unitOfMeasure: 'ton',
      })

      const fill = await service.getAutoFillForFir('t1', 'prod-1', '150101')

      expect(prisma.contract.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't1',
            producerId: 'prod-1',
            status: 'ACTIVE',
            cerCodes: { has: '150101' },
          }),
        })
      )
      expect(fill).toMatchObject({
        contractId: 'c1',
        counterpartyId: 'tr-1',
        pricingModel: 'PAY_BY_WEIGHT',
        basePrice: 120,
      })
    })

    it('restituisce null se nessun contratto attivo copre il CER', async () => {
      prisma.contract.findFirst.mockResolvedValue(null)
      expect(await service.getAutoFillForFir('t1', 'prod-1', '999999')).toBeNull()
    })
  })

  it('create imposta stato DRAFT', async () => {
    prisma.contract.create.mockImplementation((args: any) => Promise.resolve(args.data))
    const res = await service.create('t1', {
      contractNumber: 'CTR-1',
      producerId: 'p1',
      counterpartyId: 'c1',
      counterpartyType: 'TRANSPORTER',
      contractType: 'WASTE_TRANSPORT',
      cerCodes: ['150101'],
      pricingModel: 'FLAT_RATE',
      startDate: new Date('2026-01-01'),
    })
    expect(res.status).toBe('DRAFT')
    expect(res.tenantId).toBe('t1')
  })

  // ─── Verifica dei riferimenti alle anagrafiche ────────────────────────────
  describe('create — riferimenti alle anagrafiche', () => {
    const input = (over: Partial<any> = {}) => ({
      contractNumber: 'CTR-2026-001',
      producerId: 'p1',
      counterpartyId: 'c1',
      counterpartyType: 'TRANSPORTER' as const,
      contractType: 'WASTE_TRANSPORT' as const,
      cerCodes: ['150101'],
      pricingModel: 'FLAT_RATE',
      startDate: new Date('2026-01-01'),
      ...over,
    })

    it('rifiuta un produttore che non esiste nel registro', async () => {
      prisma.produttore.findFirst.mockResolvedValue(null)
      await expect(service.create('t1', input())).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.contract.create).not.toHaveBeenCalled()
    })

    it('rifiuta una controparte assente dal registro del suo tipo', async () => {
      prisma.trasportatore.findFirst.mockResolvedValue(null)
      await expect(service.create('t1', input())).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.contract.create).not.toHaveBeenCalled()
    })

    it('cerca la controparte nel registro corrispondente al tipo', async () => {
      prisma.contract.create.mockImplementation((a: any) => Promise.resolve(a.data))
      await service.create('t1', input({ counterpartyType: 'DISPOSER' }))

      expect(prisma.destinatario.findFirst).toHaveBeenCalled()
      expect(prisma.trasportatore.findFirst).not.toHaveBeenCalled()
    })

    it('cerca le parti SOLO nel tenant corrente', async () => {
      prisma.contract.create.mockImplementation((a: any) => Promise.resolve(a.data))
      await service.create('t1', input())

      expect(prisma.produttore.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'p1', tenantId: 't1' } })
      )
      expect(prisma.trasportatore.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'c1', tenantId: 't1' } })
      )
    })

    it('non verifica alcun registro per BROKER (non ne esiste uno)', async () => {
      prisma.contract.create.mockImplementation((a: any) => Promise.resolve(a.data))
      await service.create('t1', input({ counterpartyType: 'BROKER' }))

      expect(prisma.trasportatore.findFirst).not.toHaveBeenCalled()
      expect(prisma.destinatario.findFirst).not.toHaveBeenCalled()
      expect(prisma.contract.create).toHaveBeenCalled()
    })
  })

  // ─── Risoluzione delle parti in lettura ──────────────────────────────────
  describe('list — risoluzione delle parti', () => {
    it('aggiunge ragione sociale e P.IVA di produttore e controparte', async () => {
      prisma.contract.findMany.mockResolvedValue([
        { id: 'k1', producerId: 'p1', counterpartyId: 't1r', counterpartyType: 'TRANSPORTER' },
      ])
      prisma.produttore.findMany.mockResolvedValue([
        {
          id: 'p1',
          ditta: { ragioneSociale: 'ACME SPA', partitaIva: PIVA_VALIDA, codiceFiscale: null },
        },
      ])
      prisma.trasportatore.findMany.mockResolvedValue([
        {
          id: 't1r',
          ditta: {
            ragioneSociale: 'ROSSI TRASPORTI SRL',
            partitaIva: partitaIvaValida(7),
            codiceFiscale: null,
          },
        },
      ])

      const [riga] = await service.list('t1')

      expect(riga.producer).toEqual({
        id: 'p1',
        ragioneSociale: 'ACME SPA',
        partitaIVA: PIVA_VALIDA,
        codiceFiscale: null,
      })
      expect(riga.counterparty?.ragioneSociale).toBe('ROSSI TRASPORTI SRL')
    })

    it('dà null — non solleva — se un id non è più in anagrafica', async () => {
      prisma.contract.findMany.mockResolvedValue([
        { id: 'k1', producerId: 'sparito', counterpartyId: 'pure', counterpartyType: 'DISPOSER' },
      ])

      const [riga] = await service.list('t1')

      expect(riga.producer).toBeNull()
      expect(riga.counterparty).toBeNull()
    })

    it('interroga ogni registro una volta sola, non una per contratto', async () => {
      prisma.contract.findMany.mockResolvedValue([
        { id: 'k1', producerId: 'p1', counterpartyId: 'x1', counterpartyType: 'TRANSPORTER' },
        { id: 'k2', producerId: 'p1', counterpartyId: 'x2', counterpartyType: 'TRANSPORTER' },
        { id: 'k3', producerId: 'p2', counterpartyId: 'x3', counterpartyType: 'DISPOSER' },
      ])

      await service.list('t1')

      expect(prisma.produttore.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.trasportatore.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.destinatario.findMany).toHaveBeenCalledTimes(1)
      // Gli id duplicati non vengono richiesti due volte.
      expect(prisma.produttore.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tenantId: 't1', id: { in: ['p1', 'p2'] } } })
      )
    })

    it('non interroga i registri se non ci sono contratti', async () => {
      prisma.contract.findMany.mockResolvedValue([])

      expect(await service.list('t1')).toEqual([])
      expect(prisma.produttore.findMany).not.toHaveBeenCalled()
    })
  })

  // ─── Numerazione progressiva ─────────────────────────────────────────────
  describe('nextContractNumber', () => {
    it("parte da 001 quando non ci sono contratti per l'anno", async () => {
      prisma.contract.findMany.mockResolvedValue([])
      expect(await service.nextContractNumber('t1', new Date('2026-03-04'))).toBe('CTR-2026-001')
    })

    it('usa il massimo esistente, non il conteggio (regge i buchi)', async () => {
      prisma.contract.findMany.mockResolvedValue([
        { contractNumber: 'CTR-2026-001' },
        { contractNumber: 'CTR-2026-007' },
      ])
      expect(await service.nextContractNumber('t1', new Date('2026-03-04'))).toBe('CTR-2026-008')
    })

    it("riparte da 001 al cambio d'anno", async () => {
      prisma.contract.findMany.mockResolvedValue([])
      expect(await service.nextContractNumber('t1', new Date('2027-01-02'))).toBe('CTR-2027-001')
      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ contractNumber: { startsWith: 'CTR-2027-' } }),
        })
      )
    })

    it('ignora i numeri fuori formato inseriti a mano', async () => {
      prisma.contract.findMany.mockResolvedValue([
        { contractNumber: 'CTR-2026-004' },
        { contractNumber: 'CTR-2026-004-bis' },
      ])
      expect(await service.nextContractNumber('t1', new Date('2026-05-05'))).toBe('CTR-2026-005')
    })

    it('supera le tre cifre senza troncare', async () => {
      prisma.contract.findMany.mockResolvedValue([{ contractNumber: 'CTR-2026-999' }])
      expect(await service.nextContractNumber('t1', new Date('2026-05-05'))).toBe('CTR-2026-1000')
    })
  })
})
