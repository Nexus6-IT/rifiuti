import { RitiroDatiNonValidiError } from './errori-ritiri'
import { StampaRitiriService } from './stampa-ritiri.service'

describe('StampaRitiriService — limite della distinta', () => {
  it('se i ritiri del giorno superano la pagina massima fallisce con un messaggio, non tronca in silenzio', async () => {
    const tx = { automezzo: { findFirst: jest.fn() } }
    const prisma = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) }
    const repo = { elenca: jest.fn().mockResolvedValue({ righe: [{}], totale: 2500 }) }
    const modelli = { list: jest.fn().mockResolvedValue([]), getById: jest.fn() }
    const pdf = { generateDistintaPDF: jest.fn() }
    const s = new StampaRitiriService(
      prisma as never,
      repo as never,
      pdf as never,
      modelli as never
    )

    await expect(
      s.distinta('5a5a5a5a-0000-4000-8000-00000000000a', '2026-12-01')
    ).rejects.toBeInstanceOf(RitiroDatiNonValidiError)
    expect(pdf.generateDistintaPDF).not.toHaveBeenCalled()
  })

  it('chiede al repository i soli ritiri PROGRAMMATI: il filtro sta in SQL, non in memoria', async () => {
    const tx = { automezzo: { findFirst: jest.fn() } }
    const prisma = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) }
    const repo = { elenca: jest.fn().mockResolvedValue({ righe: [], totale: 0 }) }
    const modelli = { list: jest.fn().mockResolvedValue([]), getById: jest.fn() }
    const pdf = { generateDistintaPDF: jest.fn().mockResolvedValue(Buffer.from('%PDF')) }
    const s = new StampaRitiriService(
      prisma as never,
      repo as never,
      pdf as never,
      modelli as never
    )

    await s.distinta('5a5a5a5a-0000-4000-8000-00000000000a', '2026-12-01')

    expect(repo.elenca).toHaveBeenCalledWith(
      tx,
      '5a5a5a5a-0000-4000-8000-00000000000a',
      expect.objectContaining({ stato: 'PROGRAMMATO' }),
      1,
      expect.any(Number)
    )
  })
})
