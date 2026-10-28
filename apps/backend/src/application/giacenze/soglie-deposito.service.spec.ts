import { Prisma } from '@prisma/client'
import { SOGLIE_PREDEFINITE } from '../../domain/waste-movement/deposito-temporaneo'
import { RegistroNonTrovatoError } from '../registro/registri.service'
import { SoglieDepositoService, SoglieNonValideError } from './soglie-deposito.service'

const T = '11111111-1111-4111-8111-111111111111'
const U = '22222222-2222-4222-8222-222222222222'
const R1 = '33333333-3333-4333-8333-333333333331'
const R2 = '33333333-3333-4333-8333-333333333332'

function riga(registroId: string | null, extra: Record<string, unknown> = {}) {
  return {
    id: `id-${registroId ?? 'azienda'}`,
    tenantId: T,
    registroId,
    criterio: 'TEMPORALE',
    giorniMax: null,
    kgMaxTotale: new Prisma.Decimal('20000.50'),
    kgMaxPericolosi: new Prisma.Decimal('5000'),
    preavvisoGiorni: 10,
    preavvisoPercentuale: 70,
    note: null,
    impostatoDa: U,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-02T00:00:00Z'),
    ...extra,
  }
}

const DATI = {
  criterio: 'QUANTITATIVO' as const,
  giorniMax: 60,
  kgMaxTotale: 25000,
  kgMaxPericolosi: 8000,
  preavvisoGiorni: 10,
  preavvisoPercentuale: 75,
  note: '  1 m3 = 800 kg  ',
}

function crea() {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    sogliaDepositoTemporaneo: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }: any) => riga(data.registroId, data)),
      update: jest.fn().mockImplementation(async ({ data }: any) => riga('x', data)),
      delete: jest.fn().mockResolvedValue(undefined),
    },
    activityLog: { create: jest.fn().mockResolvedValue({}) },
    registroRifiuti: { findFirst: jest.fn().mockResolvedValue({ id: R1 }) },
  }
  const prisma: any = {
    sogliaDepositoTemporaneo: { findMany: jest.fn().mockResolvedValue([]) },
    registroRifiuti: {
      findFirst: jest.fn().mockResolvedValue({ id: R1 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn().mockImplementation(async (fn: any) => fn(tx)),
  }
  return { prisma, tx, service: new SoglieDepositoService(prisma) }
}

describe('SoglieDepositoService', () => {
  describe('soglieApplicate', () => {
    it('senza righe: predefinite', async () => {
      const { service } = crea()
      const m = await service.soglieApplicate(T, [R1])
      expect(m.get(R1)).toEqual({ ...SOGLIE_PREDEFINITE, origine: 'PREDEFINITA' })
    })

    it('precedenza registro, azienda, predefinite; Decimal in Number, giorniMax null resta null', async () => {
      const { service, prisma } = crea()
      prisma.sogliaDepositoTemporaneo.findMany.mockResolvedValue([
        riga(null),
        riga(R1, { giorniMax: 45 }),
      ])
      const m = await service.soglieApplicate(T, [R1, R2])
      expect(m.get(R1)).toMatchObject({ origine: 'REGISTRO', giorniMax: 45, kgMaxTotale: 20000.5 })
      expect(m.get(R2)).toMatchObject({ origine: 'AZIENDA', giorniMax: null, kgMaxTotale: 20000.5 })
      expect(typeof m.get(R2)!.kgMaxPericolosi).toBe('number')
    })

    it('riga intera: il registro con soli giorni diversi non eredita nulla dall azienda', async () => {
      const { service, prisma } = crea()
      prisma.sogliaDepositoTemporaneo.findMany.mockResolvedValue([
        riga(null, { kgMaxTotale: new Prisma.Decimal('1000'), preavvisoPercentuale: 50 }),
        riga(R1, { giorniMax: 30 }),
      ])
      const s = (await service.soglieApplicate(T, [R1])).get(R1)!
      expect(s.origine).toBe('REGISTRO')
      expect(s.kgMaxTotale).toBe(20000.5)
      expect(s.preavvisoPercentuale).toBe(70)
    })

    it('cinque registri: una sola findMany', async () => {
      const { service, prisma } = crea()
      const ids = [R1, R2, 'a', 'b', 'c']
      const m = await service.soglieApplicate(T, ids)
      expect(m.size).toBe(5)
      expect(prisma.sogliaDepositoTemporaneo.findMany).toHaveBeenCalledTimes(1)
    })
  })

  describe('leggiConfigurazione', () => {
    it('una findMany delle soglie e una dei registri, con note e aggiornatoIl', async () => {
      const { service, prisma } = crea()
      prisma.sogliaDepositoTemporaneo.findMany.mockResolvedValue([
        riga(null, { note: 'n' }),
        riga(R1),
      ])
      prisma.registroRifiuti.findMany.mockResolvedValue([
        { id: R1, descrizione: 'Sede A', attivo: true },
        { id: R2, descrizione: 'Sede B', attivo: false },
      ])
      const c = await service.leggiConfigurazione(T)
      expect(prisma.sogliaDepositoTemporaneo.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.registroRifiuti.findMany).toHaveBeenCalledTimes(1)
      expect(c.predefinite).toEqual(SOGLIE_PREDEFINITE)
      expect(c.azienda).toMatchObject({ note: 'n', kgMaxTotale: 20000.5 })
      expect(c.registri[0].soglie).not.toBeNull()
      expect(c.registri[1]).toMatchObject({ registroId: R2, attivo: false, soglie: null })
    })
  })

  describe('imposta', () => {
    it('respinge con i messaggi di validaSoglie senza scrivere', async () => {
      const { service, prisma, tx } = crea()
      const p = service.imposta(T, U, null, { ...DATI, kgMaxTotale: 0 })
      await expect(p).rejects.toBeInstanceOf(SoglieNonValideError)
      await p.catch(e => expect((e as SoglieNonValideError).messaggi.length).toBeGreaterThan(0))
      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(tx.sogliaDepositoTemporaneo.create).not.toHaveBeenCalled()
    })

    it('registro di un altra azienda: RegistroNonTrovatoError dentro la transazione, dopo il lock, nessuna scrittura', async () => {
      const { service, prisma, tx } = crea()
      tx.registroRifiuti.findFirst.mockResolvedValue(null)
      await expect(service.imposta(T, U, R1, DATI)).rejects.toBeInstanceOf(RegistroNonTrovatoError)
      expect(tx.registroRifiuti.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: R1, tenantId: T } })
      )
      expect(prisma.registroRifiuti.findFirst).not.toHaveBeenCalled()
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      // il lock precede la verifica del registro
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.registroRifiuti.findFirst.mock.invocationCallOrder[0]
      )
      expect(tx.sogliaDepositoTemporaneo.create).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('registroId stringa vuota: non e trattato come azienda, il registro viene verificato', async () => {
      const { service, tx } = crea()
      tx.registroRifiuti.findFirst.mockResolvedValue(null)
      await expect(service.imposta(T, U, '', DATI)).rejects.toBeInstanceOf(RegistroNonTrovatoError)
      expect(tx.sogliaDepositoTemporaneo.create).not.toHaveBeenCalled()
    })

    it('nota oltre 500 caratteri: SoglieNonValideError, nessuna transazione', async () => {
      const { service, prisma } = crea()
      const p = service.imposta(T, U, null, { ...DATI, note: 'x'.repeat(501) })
      await expect(p).rejects.toBeInstanceOf(SoglieNonValideError)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('nota di 500 caratteri: accettata', async () => {
      const { service } = crea()
      await expect(
        service.imposta(T, U, null, { ...DATI, note: 'x'.repeat(500) })
      ).resolves.toBeDefined()
    })

    it('crea con lock e audit nella stessa transazione (prima null, dopo i valori)', async () => {
      const { service, tx } = crea()
      const out = await service.imposta(T, U, null, DATI)
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
      expect(tx.sogliaDepositoTemporaneo.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: T,
          registroId: null,
          impostatoDa: U,
          note: '1 m3 = 800 kg',
        }),
      })
      expect(tx.activityLog.create).toHaveBeenCalledTimes(1)
      const audit = tx.activityLog.create.mock.calls[0][0].data
      expect(audit).toMatchObject({ tenantId: T, userId: U, action: 'DEPOSITO_SOGLIE_IMPOSTATE' })
      expect(audit.metadata.prima).toBeNull()
      expect(audit.metadata.dopo).toMatchObject({ criterio: 'QUANTITATIVO', kgMaxTotale: 25000 })
      expect(out.criterio).toBe('QUANTITATIVO')
    })

    it('aggiorna la riga esistente e registra prima e dopo', async () => {
      const { service, tx } = crea()
      tx.sogliaDepositoTemporaneo.findFirst.mockResolvedValue(riga(R1))
      await service.imposta(T, U, R1, DATI)
      expect(tx.sogliaDepositoTemporaneo.create).not.toHaveBeenCalled()
      expect(tx.sogliaDepositoTemporaneo.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: `id-${R1}` } })
      )
      const meta = tx.activityLog.create.mock.calls[0][0].data.metadata
      expect(meta.registroId).toBe(R1)
      expect(meta.prima).toMatchObject({ kgMaxTotale: 20000.5, criterio: 'TEMPORALE' })
      expect(meta.dopo).toMatchObject({ kgMaxTotale: 25000 })
    })
  })

  describe('elimina', () => {
    it('registro di un altra azienda: RegistroNonTrovatoError dentro la transazione, dopo il lock', async () => {
      const { service, prisma, tx } = crea()
      tx.registroRifiuti.findFirst.mockResolvedValue(null)
      await expect(service.elimina(T, U, R1)).rejects.toBeInstanceOf(RegistroNonTrovatoError)
      expect(prisma.registroRifiuti.findFirst).not.toHaveBeenCalled()
      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.registroRifiuti.findFirst.mock.invocationCallOrder[0]
      )
      expect(tx.sogliaDepositoTemporaneo.delete).not.toHaveBeenCalled()
    })

    it('registro dell azienda senza riga: nessuna scrittura ne audit, nessun errore', async () => {
      const { service, tx } = crea()
      await expect(service.elimina(T, U, R1)).resolves.toBeUndefined()
      expect(tx.sogliaDepositoTemporaneo.delete).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('azienda senza riga: nessuna scrittura', async () => {
      const { service, tx } = crea()
      await service.elimina(T, U, null)
      expect(tx.registroRifiuti.findFirst).not.toHaveBeenCalled()
      expect(tx.activityLog.create).not.toHaveBeenCalled()
    })

    it('con la riga: cancella e scrive l audit DEPOSITO_SOGLIE_RIMOSSE', async () => {
      const { service, tx } = crea()
      tx.sogliaDepositoTemporaneo.findFirst.mockResolvedValue(riga(R1))
      await service.elimina(T, U, R1)
      expect(tx.sogliaDepositoTemporaneo.delete).toHaveBeenCalledWith({ where: { id: `id-${R1}` } })
      expect(tx.activityLog.create.mock.calls[0][0].data).toMatchObject({
        action: 'DEPOSITO_SOGLIE_RIMOSSE',
      })
    })
  })
})
