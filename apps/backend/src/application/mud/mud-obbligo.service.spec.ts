import { BadRequestException, NotFoundException } from '@nestjs/common'
import { FILTRO_AZIENDE_TENUTE_AL_MUD, MudObbligoService } from './mud-obbligo.service'

describe('MudObbligoService', () => {
  const IL = new Date('2026-03-02T09:00:00Z')
  let prisma: any
  let tx: any
  let service: MudObbligoService

  const riga = (p: Partial<any> = {}) => ({
    mudNonDovuto: false,
    mudNonDovutoMotivo: null,
    mudNonDovutoIl: null,
    mudNonDovutoDa: null,
    ...p,
  })

  beforeEach(() => {
    tx = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue(riga()),
        update: jest.fn().mockImplementation(async ({ data }: any) => riga(data)),
      },
      activityLog: { create: jest.fn().mockResolvedValue({}) },
    }
    prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue(riga()) },
      $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
    }
    service = new MudObbligoService(prisma)
  })

  describe('leggi', () => {
    it("legge il flag dell'azienda indicata", async () => {
      prisma.tenant.findUnique.mockResolvedValue(
        riga({
          mudNonDovuto: true,
          mudNonDovutoMotivo: 'Meno di 10 dipendenti, rifiuti non pericolosi',
          mudNonDovutoIl: IL,
          mudNonDovutoDa: 'u1',
        })
      )

      const r = await service.leggi('t1')

      expect(prisma.tenant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1' } })
      )
      expect(r).toEqual({
        mudNonDovuto: true,
        motivo: 'Meno di 10 dipendenti, rifiuti non pericolosi',
        impostatoIl: IL,
        impostatoDa: 'u1',
      })
    })

    it('azienda inesistente: 404', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null)

      await expect(service.leggi('t1')).rejects.toBeInstanceOf(NotFoundException)
    })
  })

  describe('imposta', () => {
    it.each([null, '', '   ', 'abc', 'x'.repeat(501)])(
      'con il flag attivo il motivo è obbligatorio (5-500 caratteri): %p',
      async motivo => {
        const errore = await service.imposta('t1', 'u1', true, motivo).catch(e => e)

        expect(errore).toBeInstanceOf(BadRequestException)
        expect(errore.message).toBe("Indicare il motivo per cui l'azienda non è tenuta al MUD.")
        expect(tx.tenant.update).not.toHaveBeenCalled()
        expect(tx.activityLog.create).not.toHaveBeenCalled()
      }
    )

    it("segna l'azienda come non tenuta, con motivo, data e utente, e lo scrive nel log con prima e dopo", async () => {
      jest.useFakeTimers().setSystemTime(IL)
      try {
        const r = await service.imposta('t1', 'u1', true, '  Meno di 10 dipendenti  ')

        expect(tx.tenant.update).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 't1' },
            data: {
              mudNonDovuto: true,
              mudNonDovutoMotivo: 'Meno di 10 dipendenti',
              mudNonDovutoIl: IL,
              mudNonDovutoDa: 'u1',
            },
          })
        )
        expect(tx.activityLog.create).toHaveBeenCalledWith({
          data: {
            tenantId: 't1',
            userId: 'u1',
            action: 'MUD_OBBLIGO_MODIFICATO',
            description: 'Azienda segnata come non tenuta al MUD: Meno di 10 dipendenti',
            metadata: {
              prima: { mudNonDovuto: false, motivo: null },
              dopo: { mudNonDovuto: true, motivo: 'Meno di 10 dipendenti' },
            },
          },
        })
        expect(r).toEqual({
          mudNonDovuto: true,
          motivo: 'Meno di 10 dipendenti',
          impostatoIl: IL,
          impostatoDa: 'u1',
        })
      } finally {
        jest.useRealTimers()
      }
    })

    it('con false azzera motivo, data e utente (il motivo inviato si ignora)', async () => {
      tx.tenant.findUnique.mockResolvedValue(
        riga({
          mudNonDovuto: true,
          mudNonDovutoMotivo: 'Meno di 10 dipendenti',
          mudNonDovutoIl: IL,
          mudNonDovutoDa: 'u0',
        })
      )

      const r = await service.imposta('t1', 'u1', false, 'qualunque cosa')

      expect(tx.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't1' },
          data: {
            mudNonDovuto: false,
            mudNonDovutoMotivo: null,
            mudNonDovutoIl: null,
            mudNonDovutoDa: null,
          },
        })
      )
      expect(tx.activityLog.create).toHaveBeenCalledWith({
        data: {
          tenantId: 't1',
          userId: 'u1',
          action: 'MUD_OBBLIGO_MODIFICATO',
          description: 'Azienda di nuovo tenuta al MUD',
          metadata: {
            prima: { mudNonDovuto: true, motivo: 'Meno di 10 dipendenti' },
            dopo: { mudNonDovuto: false, motivo: null },
          },
        },
      })
      expect(r).toEqual({ mudNonDovuto: false, motivo: null, impostatoIl: null, impostatoDa: null })
    })

    it('aggiornamento e log stanno nella stessa transaction', async () => {
      await service.imposta('t1', 'u1', true, 'Meno di 10 dipendenti')

      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(tx.tenant.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 't1' } })
      )
    })

    it('azienda inesistente: 404 e nessuna scrittura', async () => {
      tx.tenant.findUnique.mockResolvedValue(null)

      await expect(service.imposta('t1', 'u1', false, null)).rejects.toBeInstanceOf(
        NotFoundException
      )
      expect(tx.tenant.update).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })
  })

  it('il filtro delle aziende tenute al MUD esclude quelle col flag', () => {
    expect(FILTRO_AZIENDE_TENUTE_AL_MUD).toEqual({ mudNonDovuto: false })
  })
})
