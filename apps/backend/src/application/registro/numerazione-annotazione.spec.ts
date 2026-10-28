import {
  bloccaProgressivo,
  inserisciAnnotazione,
  numeraAnnotazione,
} from './numerazione-annotazione'

function tx(ultima: Array<{ max_num: number; entry_hash: string }>, iniziale?: number) {
  return {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue(ultima),
    registroProgressivoIniziale: {
      findUnique: jest.fn().mockResolvedValue(iniziale ? { primoProgressivo: iniziale } : null),
    },
    wasteMovement: { create: jest.fn().mockResolvedValue({ id: 'x' }) },
  }
}

describe('numerazione-annotazione', () => {
  it('registro vuoto: progressivo 1 e hash precedente vuoto', async () => {
    expect(await numeraAnnotazione(tx([]) as never, 'r', 2026)).toEqual({
      progressivo: 1,
      hashPrecedente: '',
    })
  })

  it('successivo all’ultimo, con il suo hash', async () => {
    expect(
      await numeraAnnotazione(tx([{ max_num: 7, entry_hash: 'abc' }]) as never, 'r', 2026)
    ).toEqual({ progressivo: 8, hashPrecedente: 'abc' })
  })

  it('mai sotto il progressivo iniziale', async () => {
    const r = await numeraAnnotazione(tx([{ max_num: 7, entry_hash: '' }], 50) as never, 'r', 2026)
    expect(r.progressivo).toBe(50)
  })

  it('lock del progressivo per registro e anno; insert con la versione dell’hash', async () => {
    const t = tx([])
    await bloccaProgressivo(t as never, 'r', 2026)
    expect(t.$executeRaw).toHaveBeenCalledTimes(1)
    await inserisciAnnotazione(t as never, { tenantId: 't' } as never)
    expect(t.wasteMovement.create).toHaveBeenCalledWith({
      data: { tenantId: 't', hashVersione: 2 },
    })
  })
})
