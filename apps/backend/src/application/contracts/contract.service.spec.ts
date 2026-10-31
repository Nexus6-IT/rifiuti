import { PIVA_VALIDA, partitaIvaValida } from '../../test-support/anagrafiche-di-test'
import { Test, TestingModule } from '@nestjs/testing'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
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
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
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
      prisma.contract.findFirst
        .mockResolvedValueOnce({ id: 'c1', status: 'DRAFT', versione: 1 })
        .mockResolvedValueOnce({ id: 'c1', status: 'PENDING_APPROVAL', versione: 2 })

      const res = await service.changeStatus('t1', 'c1', 'PENDING_APPROVAL')
      expect(res.status).toBe('PENDING_APPROVAL')
      expect(prisma.contract.updateMany).toHaveBeenCalled()
    })

    it('rifiuta una transizione non ammessa (DRAFT → ACTIVE)', async () => {
      prisma.contract.findFirst.mockResolvedValue({ id: 'c1', status: 'DRAFT' })
      await expect(service.changeStatus('t1', 'c1', 'ACTIVE')).rejects.toBeInstanceOf(
        BadRequestException
      )
      expect(prisma.contract.updateMany).not.toHaveBeenCalled()
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
        {
          id: 'k1',
          status: 'DRAFT',
          producerId: 'p1',
          counterpartyId: 't1r',
          counterpartyType: 'TRANSPORTER',
        },
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
        {
          id: 'k1',
          status: 'DRAFT',
          producerId: 'sparito',
          counterpartyId: 'pure',
          counterpartyType: 'DISPOSER',
        },
      ])

      const [riga] = await service.list('t1')

      expect(riga.producer).toBeNull()
      expect(riga.counterparty).toBeNull()
    })

    it('interroga ogni registro una volta sola, non una per contratto', async () => {
      prisma.contract.findMany.mockResolvedValue([
        {
          id: 'k1',
          status: 'DRAFT',
          producerId: 'p1',
          counterpartyId: 'x1',
          counterpartyType: 'TRANSPORTER',
        },
        {
          id: 'k2',
          status: 'DRAFT',
          producerId: 'p1',
          counterpartyId: 'x2',
          counterpartyType: 'TRANSPORTER',
        },
        {
          id: 'k3',
          status: 'DRAFT',
          producerId: 'p2',
          counterpartyId: 'x3',
          counterpartyType: 'DISPOSER',
        },
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

  // ─── Fase 4 pezzo 0: modifica, cancellazione logica, filtri ──────────────
  const contratto = (over: Record<string, unknown> = {}) => ({
    id: 'k1',
    tenantId: 't1',
    contractNumber: 'CTR-2026-001',
    producerId: 'p1',
    counterpartyId: 'c1',
    counterpartyType: 'TRANSPORTER',
    contractType: 'WASTE_TRANSPORT',
    description: null,
    cerCodes: ['150101'],
    pricingModel: 'FLAT_RATE',
    basePrice: { toNumber: () => 100 },
    unitOfMeasure: 'kg',
    pricingConfig: null,
    startDate: new Date('2026-01-01T00:00:00Z'),
    endDate: null,
    durationMonths: null,
    autoRenew: false,
    renewalNoticeDays: 60,
    paymentTerms: 'net_30',
    billingFrequency: 'monthly',
    status: 'DRAFT',
    versione: 3,
    eliminatoIl: null,
    eliminatoDa: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  })
  const rifiuta = async (p: Promise<unknown>) => {
    try {
      await p
    } catch (e: any) {
      return e
    }
    throw new Error('atteso un errore')
  }

  describe('letture e filtri', () => {
    it('findOrFail cerca con eliminatoIl null', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      await service.getById('t1', 'k1')
      expect(prisma.contract.findFirst).toHaveBeenCalledWith({
        where: { id: 'k1', tenantId: 't1', eliminatoIl: null },
      })
    })
    it('list filtra eliminatoIl null e aggiunge modificabili ed eliminabile', async () => {
      prisma.contract.findMany.mockResolvedValue([contratto(), contratto({ status: 'ACTIVE' })])
      const [a, b] = await service.list('t1')
      expect(prisma.contract.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ tenantId: 't1', eliminatoIl: null }),
        })
      )
      expect(a.modificabili).toHaveLength(17)
      expect(a.eliminabile).toBe(true)
      expect(b.modificabili).not.toContain('producerId')
      expect(b.eliminabile).toBe(false)
    })
    it('list non espone eliminatoIl ed eliminatoDa', async () => {
      prisma.contract.findMany.mockResolvedValue([contratto()])
      const [riga] = await service.list('t1')
      expect('eliminatoIl' in riga).toBe(false)
      expect('eliminatoDa' in riga).toBe(false)
    })
    it('getAutoFillForFir esclude gli eliminati', async () => {
      prisma.contract.findFirst.mockResolvedValue(null)
      await service.getAutoFillForFir('t1', 'p1', '150101')
      expect(prisma.contract.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ eliminatoIl: null }) })
      )
    })
    it('nextContractNumber conta anche gli eliminati', async () => {
      prisma.contract.findMany.mockResolvedValue([])
      await service.nextContractNumber('t1', new Date('2026-03-04'))
      const where = prisma.contract.findMany.mock.calls[0][0].where
      expect('eliminatoIl' in where).toBe(false)
    })
  })

  describe('create — validazione e numero duplicato', () => {
    const input = (over: Record<string, unknown> = {}) => ({
      contractNumber: 'CTR-1',
      producerId: 'p1',
      counterpartyId: 'c1',
      counterpartyType: 'TRANSPORTER' as const,
      contractType: 'WASTE_TRANSPORT' as const,
      cerCodes: ['150101'],
      pricingModel: 'FLAT_RATE',
      startDate: new Date('2026-06-01'),
      ...over,
    })
    it("rifiuta fine prima dell'inizio con 400 CONTRATTO_NON_VALIDO senza scrivere", async () => {
      const e = await rifiuta(service.create('t1', input({ endDate: new Date('2026-01-01') })))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse()).toMatchObject({ error: 'CONTRATTO_NON_VALIDO' })
      expect(prisma.contract.create).not.toHaveBeenCalled()
    })
    it('P2002 risponde 409 CONTRATTO_NUMERO_DUPLICATO', async () => {
      prisma.contract.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' })
      )
      const e = await rifiuta(service.create('t1', input()))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toEqual({
        message: 'Esiste già un contratto con questo numero.',
        error: 'CONTRATTO_NUMERO_DUPLICATO',
      })
    })
  })

  describe('update', () => {
    it('contratto assente: 404', async () => {
      prisma.contract.findFirst.mockResolvedValue(null)
      await expect(service.update('t1', 'u1', 'k1', { versione: 1 })).rejects.toBeInstanceOf(
        NotFoundException
      )
    })
    it('TERMINATED: non modificabile prima del controllo di versione', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto({ status: 'TERMINATED' }))
      const e = await rifiuta(service.update('t1', 'u1', 'k1', { versione: 99 }))
      expect(e.getResponse()).toEqual({
        message: 'Un contratto cessato non si modifica.',
        error: 'CONTRATTO_NON_MODIFICABILE',
      })
    })
    it('versione diversa: 409 senza updateMany', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      const e = await rifiuta(service.update('t1', 'u1', 'k1', { versione: 2, basePrice: 5 }))
      expect(e.getResponse()).toMatchObject({ error: 'CONTRATTO_MODIFICATO_NEL_FRATTEMPO' })
      expect(prisma.contract.updateMany).not.toHaveBeenCalled()
    })
    it('nessuna modifica: nessuna scrittura né audit, restituisce la vista', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      const r = await service.update('t1', 'u1', 'k1', {
        versione: 3,
        contractNumber: ' CTR-2026-001 ',
      })
      expect(prisma.contract.updateMany).not.toHaveBeenCalled()
      expect(prisma.activityLog.create).not.toHaveBeenCalled()
      expect(r.id).toBe('k1')
      expect(r.modificabili).toHaveLength(17)
    })
    it('campo non ammesso in ACTIVE: 409 con le etichette', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto({ status: 'ACTIVE' }))
      const e = await rifiuta(service.update('t1', 'u1', 'k1', { versione: 3, producerId: 'p2' }))
      expect(e).toBeInstanceOf(ConflictException)
      expect(e.getResponse()).toEqual({
        message: 'In un contratto attivo o sospeso non si possono cambiare: Produttore.',
        error: 'CONTRATTO_NON_MODIFICABILE',
      })
    })
    it('dati non validi: 400 con message array', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      const e = await rifiuta(service.update('t1', 'u1', 'k1', { versione: 3, cerCodes: [] }))
      expect(e).toBeInstanceOf(BadRequestException)
      expect(e.getResponse()).toEqual({
        message: ['Indica almeno un codice CER.'],
        error: 'CONTRATTO_NON_VALIDO',
      })
    })
    it('controparte cambiata: parti verificate sui valori nuovi', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      await service.update('t1', 'u1', 'k1', {
        versione: 3,
        counterpartyType: 'DISPOSER',
        counterpartyId: 'd9',
      })
      expect(prisma.destinatario.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'd9', tenantId: 't1' } })
      )
    })
    it('scrive solo i campi cambiati, con versione increment e condizione completa', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      await service.update('t1', 'u1', 'k1', { versione: 3, basePrice: 150, description: 'Nota' })
      const arg = prisma.contract.updateMany.mock.calls[0][0]
      expect(arg.where).toEqual({ id: 'k1', tenantId: 't1', versione: 3, eliminatoIl: null })
      expect(arg.data).toMatchObject({
        basePrice: 150,
        description: 'Nota',
        versione: { increment: 1 },
      })
      expect(arg.data.updatedAt).toBeInstanceOf(Date)
      expect(Object.keys(arg.data).sort()).toEqual(
        ['basePrice', 'description', 'updatedAt', 'versione'].sort()
      )
    })
    it('updateMany count 0: 409 MODIFICATO_NEL_FRATTEMPO', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      prisma.contract.updateMany.mockResolvedValue({ count: 0 })
      const e = await rifiuta(service.update('t1', 'u1', 'k1', { versione: 3, basePrice: 1 }))
      expect(e.getResponse()).toMatchObject({ error: 'CONTRATTO_MODIFICATO_NEL_FRATTEMPO' })
      expect(prisma.activityLog.create).not.toHaveBeenCalled()
    })
    it('audit CONTRATTO_MODIFICATO con prima e dopo dei soli cambiati, nella transazione', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      await service.update('t1', 'u1', 'k1', {
        versione: 3,
        basePrice: 150,
        endDate: new Date('2026-12-31T00:00:00Z'),
      })
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: {
          tenantId: 't1',
          userId: 'u1',
          action: 'CONTRATTO_MODIFICATO',
          description: 'Contratto CTR-2026-001 modificato',
          metadata: {
            contrattoId: 'k1',
            campi: ['basePrice', 'endDate'],
            prima: { basePrice: 100, endDate: null },
            dopo: { basePrice: 150, endDate: '2026-12-31T00:00:00.000Z' },
          },
        },
      })
    })
    it('P2002: 409 CONTRATTO_NUMERO_DUPLICATO', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      prisma.contract.updateMany.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' })
      )
      const e = await rifiuta(
        service.update('t1', 'u1', 'k1', { versione: 3, contractNumber: 'X-2' })
      )
      expect(e.getResponse()).toMatchObject({ error: 'CONTRATTO_NUMERO_DUPLICATO' })
    })
  })

  describe('elimina', () => {
    it('ACTIVE: 409 CONTRATTO_NON_ELIMINABILE', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto({ status: 'ACTIVE' }))
      const e = await rifiuta(service.elimina('t1', 'u1', 'k1', 3))
      expect(e.getResponse()).toMatchObject({ error: 'CONTRATTO_NON_ELIMINABILE' })
      expect(prisma.contract.updateMany).not.toHaveBeenCalled()
    })
    it('versione diversa: 409', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      const e = await rifiuta(service.elimina('t1', 'u1', 'k1', 1))
      expect(e.getResponse()).toMatchObject({ error: 'CONTRATTO_MODIFICATO_NEL_FRATTEMPO' })
    })
    it('DRAFT: updateMany con eliminatoIl, eliminatoDa e stati eliminabili', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      await service.elimina('t1', 'u1', 'k1', 3)
      const arg = prisma.contract.updateMany.mock.calls[0][0]
      expect(arg.where).toEqual({
        id: 'k1',
        tenantId: 't1',
        versione: 3,
        eliminatoIl: null,
        status: { in: ['DRAFT', 'PENDING_APPROVAL'] },
      })
      expect(arg.data).toMatchObject({ eliminatoDa: 'u1', versione: { increment: 1 } })
      expect(arg.data.eliminatoIl).toBeInstanceOf(Date)
    })
    it('count 0: 409', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      prisma.contract.updateMany.mockResolvedValue({ count: 0 })
      const e = await rifiuta(service.elimina('t1', 'u1', 'k1', 3))
      expect(e.getResponse()).toMatchObject({ error: 'CONTRATTO_MODIFICATO_NEL_FRATTEMPO' })
    })
    it('audit CONTRATTO_ELIMINATO con numero e stato', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto({ status: 'PENDING_APPROVAL' }))
      await service.elimina('t1', 'u1', 'k1', 3)
      expect(prisma.activityLog.create).toHaveBeenCalledWith({
        data: {
          tenantId: 't1',
          userId: 'u1',
          action: 'CONTRATTO_ELIMINATO',
          description: 'Contratto CTR-2026-001 eliminato',
          metadata: { contrattoId: 'k1', numero: 'CTR-2026-001', stato: 'PENDING_APPROVAL' },
        },
      })
    })
  })

  describe('changeStatus condizionato', () => {
    it('scrive con updateMany sulla versione letta e la incrementa', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      await service.changeStatus('t1', 'k1', 'PENDING_APPROVAL')
      const arg = prisma.contract.updateMany.mock.calls[0][0]
      expect(arg.where).toEqual({ id: 'k1', tenantId: 't1', versione: 3, eliminatoIl: null })
      expect(arg.data).toMatchObject({ status: 'PENDING_APPROVAL', versione: { increment: 1 } })
    })
    it('restituisce la stessa vista di list e getById', async () => {
      prisma.contract.findFirst
        .mockResolvedValueOnce(contratto())
        .mockResolvedValueOnce(contratto({ status: 'PENDING_APPROVAL', versione: 4 }))
      const r = await service.changeStatus('t1', 'k1', 'PENDING_APPROVAL')
      expect(r.status).toBe('PENDING_APPROVAL')
      expect(r.modificabili).toEqual([])
      expect(r.eliminabile).toBe(true)
      expect('eliminatoIl' in r).toBe(false)
      expect('eliminatoDa' in r).toBe(false)
    })
    it('count 0: 409 MODIFICATO_NEL_FRATTEMPO', async () => {
      prisma.contract.findFirst.mockResolvedValue(contratto())
      prisma.contract.updateMany.mockResolvedValue({ count: 0 })
      const e = await rifiuta(service.changeStatus('t1', 'k1', 'PENDING_APPROVAL'))
      expect(e.getResponse()).toMatchObject({ error: 'CONTRATTO_MODIFICATO_NEL_FRATTEMPO' })
    })
  })
})
