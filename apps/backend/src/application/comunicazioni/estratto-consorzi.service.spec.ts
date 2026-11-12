import { EstrattoConsorziService } from './estratto-consorzi.service'
import { leggiMovimentiOrso } from './lettore-movimenti-orso'

jest.mock('./lettore-movimenti-orso')
jest.mock('../registro/causali/catalogo-causali.repository', () => ({
  caricaCatalogoCausali: jest.fn().mockResolvedValue({}),
}))

const mov = (id: string, registroId: string) => ({
  id,
  registroId,
  radiceId: id,
  tipo: 'CARICO' as const,
  movementDate: new Date('2026-03-10T10:00:00Z'),
  cer: '160601',
  pericoloso: true,
  descrizione: null,
  quantita: 1,
  unita: 'kg',
  kg: 1,
  causale: 'X',
  numero: '1/2026',
  controparte: null,
  indirizzoControparte: null,
  firNumero: null,
})

describe('EstrattoConsorziService.estratto', () => {
  it('legge le regole una volta sola, anche con piu sedi (classifica unica per tutti gli ambiti)', async () => {
    const prisma = {
      rentriUnitaLocale: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }, { id: 's2' }]) },
      mUDReport: { findFirst: jest.fn().mockResolvedValue(null) },
    }
    const classifica = jest.fn(async (_t: string, ms: ReadonlyArray<unknown>) =>
      ms.map(() => ({ marcature: [{ consorzio: 'COBAT', origine: 'REGOLA' }] }))
    )
    ;(leggiMovimentiOrso as jest.Mock).mockImplementation(async (_p, par) => ({
      movimenti: [mov(`m-${par.unitaLocaleId}`, `r-${par.unitaLocaleId}`)],
    }))
    const servizio = new EstrattoConsorziService(prisma as never, { classifica } as never)

    const esito = await servizio.estratto('t1', {
      consorzio: 'COBAT',
      da: '2026-03-01',
      a: '2026-03-31',
    })

    expect(esito.righe).toBe(3)
    expect(classifica).toHaveBeenCalledTimes(1)
  })
  it('usa i pesi specifici del MUD di ciascun anno del periodo, una lettura per anno', async () => {
    const findFirst = jest.fn(async (args: { where: { year: number } }) => ({
      reportData: {
        integrazioni: {
          pesiSpecifici: {
            '160601|kg': {
              cerCode: '160601',
              unita: 'kg',
              kgPerUnita: args.where.year === 2025 ? 1.1 : 2.2,
            },
          },
        },
      },
    }))
    const prisma = {
      rentriUnitaLocale: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }]) },
      mUDReport: { findFirst },
    }
    const classifica = jest.fn(async (_t: string, ms: ReadonlyArray<unknown>) =>
      ms.map(() => ({ marcature: [{ consorzio: 'COBAT', origine: 'REGOLA' }] }))
    )
    const chiamate: Array<{ pesi: unknown; da: Date; a: Date }> = []
    ;(leggiMovimentiOrso as jest.Mock).mockReset()
    ;(leggiMovimentiOrso as jest.Mock).mockImplementation(async (_p, par) => {
      chiamate.push({ pesi: par.pesiSpecifici, da: par.da, a: par.a })
      return { movimenti: [] }
    })
    const servizio = new EstrattoConsorziService(prisma as never, { classifica } as never)

    await servizio.estratto('t1', { consorzio: 'COBAT', da: '2025-11-01', a: '2026-02-28' })

    expect(findFirst).toHaveBeenCalledTimes(2)
    const anni = findFirst.mock.calls.map(c => c[0].where.year).sort()
    expect(anni).toEqual([2025, 2026])
    // 2 ambiti (sede s1 + registri senza sede) x 2 anni
    expect(chiamate).toHaveLength(4)
    const c25 = chiamate.find(
      c => (c.pesi as Record<string, { kgPerUnita: number }>)['160601|kg']?.kgPerUnita === 1.1
    )
    const c26 = chiamate.find(
      c => (c.pesi as Record<string, { kgPerUnita: number }>)['160601|kg']?.kgPerUnita === 2.2
    )
    expect(c25).toBeDefined()
    expect(c26).toBeDefined()
    // i due sotto-intervalli si toccano al capodanno di Roma e coprono il periodo intero
    expect(c25!.a.getTime()).toBe(c26!.da.getTime())
    expect(c25!.da.toISOString()).toBe('2025-10-31T23:00:00.000Z')
  })
})
