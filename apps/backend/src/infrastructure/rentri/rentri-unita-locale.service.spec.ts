import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { RentriUnitaLocaleService } from './rentri-unita-locale.service'
import { PrismaService } from '../persistence/prisma.service'

const VALID = 'OP1234ABC123456-RM1234'
const VALID_2 = 'OP5678DEF987654-TO5678'

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'ul-1',
    tenantId: 'tenant-1',
    numIscrSito: VALID,
    denominazione: 'Sede principale',
    principale: true,
    attiva: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  }
}

describe('RentriUnitaLocaleService', () => {
  let service: RentriUnitaLocaleService
  let db: {
    rentriUnitaLocale: {
      findMany: jest.Mock
      findFirst: jest.Mock
      count: jest.Mock
      update: jest.Mock
      updateMany: jest.Mock
      create: jest.Mock
      deleteMany: jest.Mock
    }
    $transaction: jest.Mock
  }
  let prisma: { db: typeof db }

  beforeEach(() => {
    db = {
      rentriUnitaLocale: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
      // Default: esegue davvero la callback (transazione interattiva) o
      // l'array di promise (transazione batch), a seconda di come viene
      // chiamato — riflette il comportamento reale di Prisma quanto basta
      // per questi test.
      $transaction: jest.fn(async (arg: unknown) => {
        if (typeof arg === 'function') {
          return arg(db)
        }
        return Promise.all(arg as Promise<unknown>[])
      }),
    }
    prisma = { db }
    service = new RentriUnitaLocaleService(prisma as unknown as PrismaService)
  })

  describe('listForTenant', () => {
    it('elenca le unità locali del tenant ordinando la principale per prima', async () => {
      db.rentriUnitaLocale.findMany.mockResolvedValue([makeRow()])

      const result = await service.listForTenant('tenant-1')

      expect(db.rentriUnitaLocale.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1' },
        orderBy: [{ principale: 'desc' }, { denominazione: 'asc' }],
      })
      expect(result).toEqual([
        expect.objectContaining({ id: 'ul-1', numIscrSito: VALID, principale: true }),
      ])
    })
  })

  describe('findById', () => {
    it('ritorna null se la sede non esiste o appartiene a un altro tenant (404, non 403)', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(null)

      const result = await service.findById('tenant-1', 'ul-di-un-altro-tenant')

      expect(db.rentriUnitaLocale.findFirst).toHaveBeenCalledWith({
        where: { id: 'ul-di-un-altro-tenant', tenantId: 'tenant-1' },
      })
      expect(result).toBeNull()
    })
  })

  describe('create', () => {
    it('rifiuta un numIscrSito fuori pattern', async () => {
      db.rentriUnitaLocale.count.mockResolvedValue(0)

      await expect(
        service.create('tenant-1', { numIscrSito: 'non-valido', denominazione: 'Sede X' })
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(db.rentriUnitaLocale.create).not.toHaveBeenCalled()
    })

    it('rifiuta una denominazione vuota', async () => {
      db.rentriUnitaLocale.count.mockResolvedValue(0)

      await expect(
        service.create('tenant-1', { numIscrSito: VALID, denominazione: '   ' })
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('la prima sede del tenant diventa principale automaticamente, anche se non richiesto', async () => {
      db.rentriUnitaLocale.count.mockResolvedValue(0)
      db.rentriUnitaLocale.create.mockResolvedValue(makeRow({ principale: true }))

      const result = await service.create('tenant-1', {
        numIscrSito: VALID,
        denominazione: 'Sede principale',
      })

      expect(result.principale).toBe(true)
      // Prima sede: nessun'altra da retrocedere, ma la creazione avviene
      // comunque dentro la transazione con principale forzato a true.
      expect(db.rentriUnitaLocale.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ tenantId: 'tenant-1', principale: true }),
      })
    })

    it('la seconda sede NON è principale di default (bisogna chiederlo esplicitamente)', async () => {
      db.rentriUnitaLocale.count.mockResolvedValue(1)
      db.rentriUnitaLocale.create.mockResolvedValue(
        makeRow({ id: 'ul-2', numIscrSito: VALID_2, principale: false })
      )

      const result = await service.create('tenant-1', {
        numIscrSito: VALID_2,
        denominazione: 'Sede secondaria',
      })

      expect(result.principale).toBe(false)
      expect(db.rentriUnitaLocale.updateMany).not.toHaveBeenCalled()
      expect(db.rentriUnitaLocale.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ principale: false }),
      })
    })

    it('creare una sede come principale esplicita retrocede la precedente principale', async () => {
      db.rentriUnitaLocale.count.mockResolvedValue(1)
      db.rentriUnitaLocale.create.mockResolvedValue(
        makeRow({ id: 'ul-2', numIscrSito: VALID_2, principale: true })
      )

      await service.create('tenant-1', {
        numIscrSito: VALID_2,
        denominazione: 'Nuova sede principale',
        principale: true,
      })

      expect(db.rentriUnitaLocale.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', principale: true },
        data: { principale: false },
      })
    })

    it('un numIscrSito duplicato per lo stesso tenant diventa 400 (P2002 mappato)', async () => {
      db.rentriUnitaLocale.count.mockResolvedValue(1)
      const p2002 = new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '5.22.0',
      })
      db.rentriUnitaLocale.create.mockRejectedValue(p2002)

      await expect(
        service.create('tenant-1', { numIscrSito: VALID, denominazione: 'Sede duplicata' })
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('update', () => {
    it('404 se la sede non esiste o appartiene a un altro tenant', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(null)

      await expect(
        service.update('tenant-1', 'non-esiste', { denominazione: 'Nuovo nome' })
      ).rejects.toBeInstanceOf(NotFoundException)
      expect(db.rentriUnitaLocale.update).not.toHaveBeenCalled()
    })

    it('aggiorna denominazione e stato di attività', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(makeRow())
      db.rentriUnitaLocale.update.mockResolvedValue(
        makeRow({ denominazione: 'Nuovo nome', attiva: false })
      )

      const result = await service.update('tenant-1', 'ul-1', {
        denominazione: 'Nuovo nome',
        attiva: false,
      })

      expect(db.rentriUnitaLocale.update).toHaveBeenCalledWith({
        where: { id: 'ul-1' },
        data: { denominazione: 'Nuovo nome', attiva: false },
      })
      expect(result.denominazione).toBe('Nuovo nome')
      expect(result.attiva).toBe(false)
    })
  })

  describe('setPrincipale', () => {
    it('404 se la sede non esiste o appartiene a un altro tenant', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(null)

      await expect(service.setPrincipale('tenant-1', 'non-esiste')).rejects.toBeInstanceOf(
        NotFoundException
      )
    })

    it('è idempotente se la sede è già principale (nessuna scrittura)', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(makeRow({ principale: true }))

      const result = await service.setPrincipale('tenant-1', 'ul-1')

      expect(result.principale).toBe(true)
      expect(db.rentriUnitaLocale.updateMany).not.toHaveBeenCalled()
      expect(db.rentriUnitaLocale.update).not.toHaveBeenCalled()
    })

    it('retrocede la principale attuale e promuove quella scelta', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(makeRow({ id: 'ul-2', principale: false }))
      db.rentriUnitaLocale.update.mockResolvedValue(makeRow({ id: 'ul-2', principale: true }))

      const result = await service.setPrincipale('tenant-1', 'ul-2')

      expect(db.rentriUnitaLocale.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', principale: true },
        data: { principale: false },
      })
      expect(db.rentriUnitaLocale.update).toHaveBeenCalledWith({
        where: { id: 'ul-2' },
        data: { principale: true },
      })
      expect(result.principale).toBe(true)
    })
  })

  describe('upsertFromRentri (R4 Task 3 — popolamento automatico da anagrafiche)', () => {
    const NUM_ISCR_SITO_REALE = 'MI00001234-001' // formato ANAGRAFICHE reale, NON conforme a NUM_ISCR_SITO_PATTERN

    it('accetta un num_iscr_sito che NON rispetta il pattern di formulari.yaml (fonte fidata: l’ente)', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(null)
      db.rentriUnitaLocale.count.mockResolvedValue(0)
      db.rentriUnitaLocale.create.mockResolvedValue(
        makeRow({ numIscrSito: NUM_ISCR_SITO_REALE, principale: true })
      )

      const risultato = await service.upsertFromRentri('tenant-1', [
        { numIscrSito: NUM_ISCR_SITO_REALE, denominazione: 'Sede legale - Milano', attiva: true },
      ])

      expect(risultato).toHaveLength(1)
      expect(db.rentriUnitaLocale.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          numIscrSito: NUM_ISCR_SITO_REALE,
          principale: true,
        }),
      })
    })

    it('crea una nuova riga per un numIscrSito non ancora noto, la prima diventa principale', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(null)
      db.rentriUnitaLocale.count.mockResolvedValue(0)
      db.rentriUnitaLocale.create.mockResolvedValue(makeRow({ principale: true }))

      await service.upsertFromRentri('tenant-1', [
        { numIscrSito: VALID, denominazione: 'Sede principale', attiva: true },
      ])

      expect(db.rentriUnitaLocale.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'tenant-1',
          numIscrSito: VALID,
          denominazione: 'Sede principale',
          principale: true,
          attiva: true,
        },
      })
    })

    it('aggiorna denominazione/attiva di una riga già nota, SENZA toccare il flag principale', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(makeRow({ principale: true }))
      db.rentriUnitaLocale.update.mockResolvedValue(
        makeRow({ denominazione: 'Nuovo nome ente', attiva: false, principale: true })
      )

      const risultato = await service.upsertFromRentri('tenant-1', [
        { numIscrSito: VALID, denominazione: 'Nuovo nome ente', attiva: false },
      ])

      expect(db.rentriUnitaLocale.update).toHaveBeenCalledWith({
        where: { id: 'ul-1' },
        data: { denominazione: 'Nuovo nome ente', attiva: false },
      })
      expect(db.rentriUnitaLocale.create).not.toHaveBeenCalled()
      expect(risultato[0].principale).toBe(true)
    })

    it('non cancella mai righe: un elenco vuoto non tocca le sedi già presenti', async () => {
      const risultato = await service.upsertFromRentri('tenant-1', [])

      expect(risultato).toEqual([])
      expect(db.rentriUnitaLocale.deleteMany).not.toHaveBeenCalled()
      expect(db.rentriUnitaLocale.update).not.toHaveBeenCalled()
      expect(db.rentriUnitaLocale.create).not.toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('404 se la sede non esiste o appartiene a un altro tenant', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(null)

      await expect(service.remove('tenant-1', 'non-esiste')).rejects.toBeInstanceOf(
        NotFoundException
      )
      expect(db.rentriUnitaLocale.deleteMany).not.toHaveBeenCalled()
    })

    it('rifiuta la cancellazione della sede principale se esistono altre sedi', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(makeRow({ principale: true }))
      db.rentriUnitaLocale.count.mockResolvedValue(2)

      await expect(service.remove('tenant-1', 'ul-1')).rejects.toBeInstanceOf(BadRequestException)
      expect(db.rentriUnitaLocale.deleteMany).not.toHaveBeenCalled()
    })

    it('permette la cancellazione della sede principale se è l’unica del tenant', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(makeRow({ principale: true }))
      db.rentriUnitaLocale.count.mockResolvedValue(1)
      db.rentriUnitaLocale.deleteMany.mockResolvedValue({ count: 1 })

      await service.remove('tenant-1', 'ul-1')

      expect(db.rentriUnitaLocale.deleteMany).toHaveBeenCalledWith({
        where: { id: 'ul-1', tenantId: 'tenant-1' },
      })
    })

    it('rimuove una sede non principale senza controlli aggiuntivi', async () => {
      db.rentriUnitaLocale.findFirst.mockResolvedValue(makeRow({ id: 'ul-2', principale: false }))
      db.rentriUnitaLocale.deleteMany.mockResolvedValue({ count: 1 })

      await service.remove('tenant-1', 'ul-2')

      expect(db.rentriUnitaLocale.count).not.toHaveBeenCalled()
      expect(db.rentriUnitaLocale.deleteMany).toHaveBeenCalledWith({
        where: { id: 'ul-2', tenantId: 'tenant-1' },
      })
    })
  })
})
