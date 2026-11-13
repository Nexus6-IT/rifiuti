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
      mUDReport: { findMany: jest.fn().mockResolvedValue([]) },
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
  it('legge i MUD di tutti gli anni in una query e il lettore una volta per ambito, con i pesi per anno', async () => {
    const findMany = jest.fn(async () =>
      [2025, 2026].map(year => ({
        year,
        reportData: {
          integrazioni: {
            pesiSpecifici: {
              '160601|kg': {
                cerCode: '160601',
                unita: 'kg',
                kgPerUnita: year === 2025 ? 1.1 : 2.2,
              },
            },
          },
        },
      }))
    )
    const prisma = {
      rentriUnitaLocale: { findMany: jest.fn().mockResolvedValue([{ id: 's1' }]) },
      mUDReport: { findMany },
    }
    const classifica = jest.fn(async (_t: string, ms: ReadonlyArray<unknown>) =>
      ms.map(() => ({ marcature: [{ consorzio: 'COBAT', origine: 'REGOLA' }] }))
    )
    const chiamate: Array<{ perAnno: Record<number, unknown>; da: Date; a: Date }> = []
    ;(leggiMovimentiOrso as jest.Mock).mockReset()
    ;(leggiMovimentiOrso as jest.Mock).mockImplementation(async (_p, par) => {
      chiamate.push({ perAnno: par.pesiSpecificiPerAnno, da: par.da, a: par.a })
      return { movimenti: [] }
    })
    const servizio = new EstrattoConsorziService(prisma as never, { classifica } as never)

    await servizio.estratto('t1', { consorzio: 'COBAT', da: '2025-11-01', a: '2026-02-28' })

    expect(findMany).toHaveBeenCalledTimes(1)
    // 2 ambiti (sede s1 + registri senza sede), una lettura ciascuno sull'intero periodo
    expect(chiamate).toHaveLength(2)
    const pesi = chiamate[0].perAnno as Record<number, Record<string, { kgPerUnita: number }>>
    expect(pesi[2025]['160601|kg'].kgPerUnita).toBe(1.1)
    expect(pesi[2026]['160601|kg'].kgPerUnita).toBe(2.2)
    expect(chiamate[0].da.toISOString()).toBe('2025-10-31T23:00:00.000Z')
    expect(chiamate[0].a.toISOString()).toBe('2026-02-28T23:00:00.000Z')
  })
  it('un anno senza MUD non ha pesi (nessuna conversione), gli altri si', async () => {
    const findMany = jest.fn(async () => [])
    const prisma = {
      rentriUnitaLocale: { findMany: jest.fn().mockResolvedValue([]) },
      mUDReport: { findMany },
    }
    ;(leggiMovimentiOrso as jest.Mock).mockReset()
    ;(leggiMovimentiOrso as jest.Mock).mockResolvedValue({ movimenti: [] })
    const servizio = new EstrattoConsorziService(
      prisma as never,
      { classifica: jest.fn().mockResolvedValue([]) } as never
    )
    await servizio.estratto('t1', { consorzio: 'COBAT', da: '2021-01-01', a: '2025-12-31' })
    expect(findMany).toHaveBeenCalledTimes(1)
    const arg = (findMany.mock.calls[0] as unknown as [{ where: { year: { in: number[] } } }])[0]
    expect(arg.where.year.in).toEqual([2021, 2022, 2023, 2024, 2025])
  })
})
