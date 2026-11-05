import { eDataIso, numeroTesto, riservaNumeri, validaAnno } from './numerazione'
import { NumerazioniService } from './numerazioni.service'

describe('numerazione (funzioni pure e validazioni, senza database)', () => {
  it('numeroTesto accoda il suffisso del registro', () => {
    expect(numeroTesto(15, '/A')).toBe('15/A')
    expect(numeroTesto(15, null)).toBe('15')
    expect(numeroTesto(1, '')).toBe('1')
  })

  it.each([
    ['2026-03-15', true],
    ['2024-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['15/03/2026', false],
    ['2026-3-5', false],
    ['', false],
  ])('eDataIso(%j) = %s', (s, atteso) => {
    expect(eDataIso(s)).toBe(atteso)
  })

  it.each([1999, 2101, 2026.5, Number.NaN])('anno %s: 400', anno => {
    expect(() => validaAnno(anno)).toThrow()
  })

  it('riservaNumeri senza richieste non apre nulla', async () => {
    const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() } as any
    await expect(riservaNumeri(tx, 't', [])).resolves.toEqual([])
    expect(tx.$queryRaw).not.toHaveBeenCalled()
    expect(tx.$executeRaw).not.toHaveBeenCalled()
  })

  it.each([
    { quanti: 0 },
    { quanti: 1.5 },
    { dataDocumento: '2026-02-30' },
    { dataDocumento: '2027-01-02' },
  ])('riservaNumeri con %j: 400 prima di toccare il database', async variante => {
    const tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn() } as any
    const r = {
      registroIvaId: 'r',
      anno: 2026,
      quanti: 1,
      dataDocumento: '2026-03-15',
      ...variante,
    }
    await expect(riservaNumeri(tx, 't', [r])).rejects.toMatchObject({ status: 400 })
    expect(tx.$queryRaw).not.toHaveBeenCalled()
  })
})

describe('NumerazioniService (validazioni)', () => {
  const prisma = { $transaction: jest.fn(), $queryRaw: jest.fn() } as any
  const service = new NumerazioniService(prisma)

  it('elenco con anno fuori intervallo: 400', () => {
    expect(() => service.elenco('t', 1900)).toThrow()
  })

  it.each([
    [-1, null],
    [1.5, null],
    [100_000_000, null],
    [1, '2025-12-31'],
    [1, '2026-02-30'],
  ])('impostaPartenza(%j, %j): 400 senza aprire la transazione', async (numeroPartenza, data) => {
    await expect(
      service.impostaPartenza('t', 'u', 'r', 2026, {
        numeroPartenza,
        dataPartenza: data,
        versione: 0,
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
