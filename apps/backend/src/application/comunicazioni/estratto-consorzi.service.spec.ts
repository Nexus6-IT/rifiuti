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
    // una query per gli anni del periodo + una per il ripiego sui MUD precedenti (nessuno: vuoto)
    expect(findMany).toHaveBeenCalledTimes(2)
    const arg = (findMany.mock.calls[0] as unknown as [{ where: { year: { in: number[] } } }])[0]
    expect(arg.where.year.in).toEqual([2021, 2022, 2023, 2024, 2025])
  })

  describe('ripiego sui pesi del MUD precedente per gli anni senza MUD', () => {
    const peso = (kg: number) => ({
      integrazioni: {
        pesiSpecifici: { '160601|L': { cerCode: '160601', unita: 'L', kgPerUnita: kg } },
      },
    })
    /** Finto `mUDReport.findMany` che rispetta `year: { in }` e `year: { lt }`. */
    const mudFinti = (anni: Record<number, unknown>) =>
      jest.fn(async (arg: { where: { year: { in?: number[]; lt?: number } } }) => {
        const { in: dentro, lt } = arg.where.year
        return Object.entries(anni)
          .map(([y, reportData]) => ({ year: Number(y), reportData }))
          .filter(r => (dentro ? dentro.includes(r.year) : r.year < (lt as number)))
          .sort((a, b) => b.year - a.year)
      })
    const movLitri = (id: string, giorno: string, kg: number | null) => ({
      ...mov(id, 'r1'),
      movementDate: new Date(`${giorno}T10:00:00Z`),
      numero: `1/${giorno.slice(0, 4)}`,
      quantita: 10,
      unita: 'L',
      kg,
    })
    const esegui = async (
      anniMud: Record<number, unknown>,
      movimenti: ReturnType<typeof movLitri>[]
    ) => {
      const findMany = mudFinti(anniMud)
      const prisma = {
        rentriUnitaLocale: { findMany: jest.fn().mockResolvedValue([]) },
        mUDReport: { findMany },
      }
      const classifica = jest.fn(async (_t: string, ms: ReadonlyArray<unknown>) =>
        ms.map(() => ({ marcature: [{ consorzio: 'COBAT', origine: 'REGOLA' }] }))
      )
      let pesiPassati: Record<number, Record<string, { kgPerUnita: number }>> = {}
      ;(leggiMovimentiOrso as jest.Mock).mockReset()
      ;(leggiMovimentiOrso as jest.Mock).mockImplementation(async (_p, par) => {
        pesiPassati = par.pesiSpecificiPerAnno
        return { movimenti }
      })
      const servizio = new EstrattoConsorziService(prisma as never, { classifica } as never)
      const esito = await servizio.estratto('t1', {
        consorzio: 'COBAT',
        da: '2025-11-01',
        a: '2026-02-28',
      })
      return { esito, pesiPassati, findMany }
    }

    it('anno senza MUD: usa i pesi del MUD precedente e avvisa, con nota sulla riga stimata', async () => {
      const { esito, pesiPassati } = await esegui({ 2025: peso(0.9) }, [
        movLitri('a', '2025-12-10', 9),
        movLitri('b', '2026-01-15', 9),
      ])
      expect(pesiPassati[2026]['160601|L'].kgPerUnita).toBe(0.9)
      expect(esito.kgStimati).toEqual([{ anno: 2026, annoMud: 2025, righe: 1 }])
      expect(esito.avvisi).toHaveLength(1)
      expect(esito.avvisi[0]).toContain('2026')
      expect(esito.avvisi[0]).toContain('MUD 2025')
      expect(esito.csv.match(/Stimati con i pesi del MUD 2025/g)).toHaveLength(1)
    })

    it('sceglie il MUD precedente piu vicino, non il piu vecchio', async () => {
      const { esito, pesiPassati } = await esegui({ 2023: peso(0.5), 2024: peso(0.7) }, [
        movLitri('b', '2026-01-15', 7),
      ])
      expect(pesiPassati[2026]['160601|L'].kgPerUnita).toBe(0.7)
      expect(pesiPassati[2025]['160601|L'].kgPerUnita).toBe(0.7)
      expect(esito.kgStimati.map(k => [k.anno, k.annoMud])).toEqual([[2026, 2024]])
    })

    it('salta i MUD precedenti senza pesi specifici', async () => {
      const { pesiPassati } = await esegui({ 2023: peso(0.5), 2024: { integrazioni: {} } }, [])
      expect(pesiPassati[2026]['160601|L'].kgPerUnita).toBe(0.5)
    })

    it('un MUD dell’anno senza pesi (bozza) conta come mancante: ripiega sul precedente con pesi', async () => {
      const { esito, pesiPassati } = await esegui({ 2025: peso(0.9), 2026: { integrazioni: {} } }, [
        movLitri('b', '2026-01-15', 9),
      ])
      expect(pesiPassati[2026]['160601|L'].kgPerUnita).toBe(0.9)
      expect(esito.kgStimati).toEqual([{ anno: 2026, annoMud: 2025, righe: 1 }])
      expect(esito.avvisi[0]).toContain('assente o senza pesi')
    })

    it('un MUD con pesi non ripiega mai: nessun avviso', async () => {
      const { esito, pesiPassati } = await esegui({ 2025: peso(0.9), 2026: peso(2) }, [
        movLitri('b', '2026-01-15', 20),
      ])
      expect(pesiPassati[2026]['160601|L'].kgPerUnita).toBe(2)
      expect(esito.kgStimati).toEqual([])
    })

    it('MUD dell’anno senza pesi e nessun precedente con pesi: pesi vuoti, nessun avviso', async () => {
      const { esito, pesiPassati } = await esegui({ 2026: { integrazioni: {} } }, [
        movLitri('b', '2026-01-15', null),
      ])
      expect(pesiPassati[2026]).toEqual({})
      expect(esito.avvisi).toEqual([])
    })

    it('nessun MUD precedente: pesi vuoti, kg vuoti come prima e nessun avviso', async () => {
      const { esito, pesiPassati } = await esegui({}, [movLitri('b', '2026-01-15', null)])
      expect(pesiPassati[2026]).toEqual({})
      expect(esito.kgStimati).toEqual([])
      expect(esito.avvisi).toEqual([])
      expect(esito.csv).not.toContain('Stimati')
    })

    it('movimenti in kg di un anno senza MUD non sono stimati: nessun avviso', async () => {
      const kg = { ...movLitri('b', '2026-01-15', 10), unita: 'kg' }
      const { esito } = await esegui({ 2025: peso(0.9) }, [kg])
      expect(esito.kgStimati).toEqual([])
      expect(esito.avvisi).toEqual([])
    })
  })
})
