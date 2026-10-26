import { BadRequestException, ConflictException } from '@nestjs/common'
import { ProgressivoInizialeService } from './progressivo-iniziale.service'
import { annoSolareItaliano } from '../../core/time/anno-italiano'

describe('ProgressivoInizialeService', () => {
  const TENANT = '11111111-1111-4111-8111-111111111111'
  const USER = '22222222-2222-4222-8222-222222222222'
  const REGISTRO = '33333333-3333-4333-8333-333333333333'
  const ANNO = annoSolareItaliano(new Date())

  let tx: any
  let prisma: any
  let registri: { preparaRegistri: jest.Mock; risolvi: jest.Mock }
  let service: ProgressivoInizialeService

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      registroProgressivoIniziale: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async (args: any) => ({
          id: 'r1',
          impostatoIl: new Date(),
          ...args.data,
        })),
      },
      wasteMovement: { findFirst: jest.fn().mockResolvedValue(null) },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    prisma = {
      $transaction: jest.fn().mockImplementation(async (fn: (t: any) => Promise<any>) => fn(tx)),
      registroProgressivoIniziale: { findUnique: jest.fn().mockResolvedValue(null) },
      wasteMovement: { findFirst: jest.fn().mockResolvedValue(null) },
    }
    registri = {
      preparaRegistri: jest.fn().mockResolvedValue(undefined),
      risolvi: jest.fn().mockResolvedValue({ id: REGISTRO }),
    }
    service = new ProgressivoInizialeService(prisma, registri as any)
  })

  describe('imposta', () => {
    it('rifiuta un anno passato con 400 e non apre la transaction', async () => {
      const errore = service.imposta(TENANT, ANNO - 1, 812, 'Migrazione da WinWaste', USER)
      await expect(errore).rejects.toBeInstanceOf(BadRequestException)
      await expect(errore).rejects.toThrow(
        "Il progressivo iniziale si imposta solo per l'anno in corso o per il prossimo."
      )
      expect(tx.registroProgressivoIniziale.create).not.toHaveBeenCalled()
    })

    it('rifiuta un anno oltre il prossimo', async () => {
      await expect(
        service.imposta(TENANT, ANNO + 2, 812, 'Migrazione da WinWaste', USER)
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it("accetta l'anno in corso e il prossimo", async () => {
      await expect(service.imposta(TENANT, ANNO, 812, 'Migrazione', USER)).resolves.toEqual({
        anno: ANNO,
        primoProgressivo: 812,
        registroId: REGISTRO,
      })
      await expect(service.imposta(TENANT, ANNO + 1, 5, 'Migrazione', USER)).resolves.toEqual({
        anno: ANNO + 1,
        primoProgressivo: 5,
        registroId: REGISTRO,
      })
    })

    it('prende lo stesso lock della numerazione (<registro>-<anno>) prima di leggere', async () => {
      const ordine: string[] = []
      tx.$executeRaw.mockImplementation(async (...args: any[]) => {
        ordine.push(`lock:${args.slice(1).join(',')}`)
        return 0
      })
      tx.registroProgressivoIniziale.findUnique.mockImplementation(async () => {
        ordine.push('leggi')
        return null
      })
      await service.imposta(TENANT, ANNO, 812, 'Migrazione', USER)

      expect(ordine[0]).toBe(`lock:${REGISTRO}-${ANNO}`)
      expect(ordine[1]).toBe('leggi')
      const [sql] = tx.$executeRaw.mock.calls[0]
      expect(sql.join('?')).toContain('pg_advisory_xact_lock(hashtext(?))')
    })

    it('con un registroId lo passa alla risoluzione, fuori e dentro la transaction', async () => {
      await service.imposta(TENANT, ANNO, 812, 'Migrazione', USER, 'reg-b')
      expect(registri.preparaRegistri).toHaveBeenCalledWith(TENANT, 'reg-b')
      expect(registri.risolvi).toHaveBeenCalledWith(tx, TENANT, 'reg-b')
      expect(registri.preparaRegistri.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[0]
      )
    })

    it('un secondo tentativo è rifiutato con 409', async () => {
      tx.registroProgressivoIniziale.findUnique.mockResolvedValue({ primoProgressivo: 812 })
      const errore = service.imposta(TENANT, ANNO, 900, 'Correzione', USER)
      await expect(errore).rejects.toBeInstanceOf(ConflictException)
      await expect(errore).rejects.toThrow(
        `Il progressivo iniziale del ${ANNO} è già stato impostato (812): non si può modificare.`
      )
      expect(tx.registroProgressivoIniziale.create).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('un anno che ha già movimenti è rifiutato con 409', async () => {
      tx.wasteMovement.findFirst.mockResolvedValue({ id: 'm1' })
      const errore = service.imposta(TENANT, ANNO, 812, 'Migrazione', USER)
      await expect(errore).rejects.toBeInstanceOf(ConflictException)
      await expect(errore).rejects.toThrow(
        `Il registro del ${ANNO} ha già movimenti: il progressivo iniziale si imposta solo prima del primo movimento dell'anno.`
      )
      expect(tx.wasteMovement.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, registroId: REGISTRO, progressiveYear: ANNO },
        })
      )
      expect(tx.registroProgressivoIniziale.create).not.toHaveBeenCalled()
    })

    it("salva la riga e scrive il log dell'attività", async () => {
      await service.imposta(TENANT, ANNO, 812, 'Migrazione da WinWaste', USER)

      expect(tx.registroProgressivoIniziale.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT,
          registroId: REGISTRO,
          anno: ANNO,
          primoProgressivo: 812,
          motivo: 'Migrazione da WinWaste',
          impostatoDa: USER,
        },
      })
      expect(tx.activityLog.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT,
          userId: USER,
          action: 'REGISTRO_PROGRESSIVO_INIZIALE',
          description: `Progressivo iniziale del registro ${ANNO} impostato a 812: Migrazione da WinWaste`,
          metadata: {
            anno: ANNO,
            primoProgressivo: 812,
            motivo: 'Migrazione da WinWaste',
            registroId: REGISTRO,
          },
        },
      })
    })
  })

  describe('leggi', () => {
    it('senza impostazione e senza movimenti', async () => {
      await expect(service.leggi(TENANT, ANNO)).resolves.toEqual({
        anno: ANNO,
        registroId: REGISTRO,
        primoProgressivo: null,
        impostatoIl: null,
        haMovimenti: false,
      })
      expect(prisma.registroProgressivoIniziale.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { registroId_anno: { registroId: REGISTRO, anno: ANNO } },
        })
      )
      expect(prisma.wasteMovement.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: TENANT, registroId: REGISTRO, progressiveYear: ANNO },
        })
      )
    })

    it("con l'impostazione e con movimenti", async () => {
      const il = new Date('2026-10-22T08:00:00Z')
      prisma.registroProgressivoIniziale.findUnique.mockResolvedValue({
        primoProgressivo: 812,
        impostatoIl: il,
      })
      prisma.wasteMovement.findFirst.mockResolvedValue({ id: 'm1' })
      await expect(service.leggi(TENANT, ANNO)).resolves.toEqual({
        anno: ANNO,
        registroId: REGISTRO,
        primoProgressivo: 812,
        impostatoIl: il,
        haMovimenti: true,
      })
    })
  })
})
