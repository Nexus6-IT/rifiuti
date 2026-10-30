import { EvidenzeDbService } from './evidenze-db.service'

describe('EvidenzeDbService', () => {
  it('evidenze: letture dal client di sistema', async () => {
    const data = new Date('2026-10-01T00:00:00Z')
    const sistema: any = {
      rENTRISyncLog: { findFirst: jest.fn().mockResolvedValue({ createdAt: data }) },
      rentriCodificaSemplice: {
        aggregate: jest.fn().mockResolvedValue({ _max: { updatedAt: data } }),
      },
      cERCode: { aggregate: jest.fn().mockResolvedValue({ _max: { updatedAt: data } }) },
      notification: { aggregate: jest.fn().mockResolvedValue({ _max: { createdAt: data } }) },
      fIR: { aggregate: jest.fn().mockResolvedValue({ _max: { createdAt: data } }) },
      activityLog: { aggregate: jest.fn().mockResolvedValue({ _max: { createdAt: data } }) },
      backupSchedule: { findFirst: jest.fn().mockResolvedValue(null) },
      backupHistory: { findFirst: jest.fn() },
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 't1' }]) },
      rentriCredential: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    }
    // Unico client iniettato: se il service ne chiedesse un altro, non compilerebbe.
    const service = new EvidenzeDbService(sistema)

    for (const chiave of [
      'riconciliazione-rentri',
      'codifiche-rentri',
      'dati-riferimento',
      'notifiche',
    ] as const) {
      expect(await service.ultimoEffetto(chiave)).toEqual(data)
    }
    expect(await service.freschezza()).toHaveLength(4)
    await service.credenziali()
    expect(sistema.rentriCredential.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: { in: ['t1'] } } })
    )
    await service.verificaConnessione()
    expect(sistema.$queryRaw).toHaveBeenCalled()
  })

  describe('verificaCatalogoCausali', () => {
    it('riporta il numero di causali se il catalogo ha righe', async () => {
      const sistema = { causaleRegistro: { count: jest.fn().mockResolvedValue(11) } }
      const service = new EvidenzeDbService(sistema as never)
      await expect(service.verificaCatalogoCausali()).resolves.toBe(
        '11 causali di sistema presenti'
      )
    })

    it('solleva se il catalogo e\x27 vuoto, cosi\x27 la voce di stato diventa error', async () => {
      const sistema = { causaleRegistro: { count: jest.fn().mockResolvedValue(0) } }
      const service = new EvidenzeDbService(sistema as never)
      await expect(service.verificaCatalogoCausali()).rejects.toThrow('causali_registro')
    })
  })
})
