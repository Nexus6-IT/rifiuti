import { of } from 'rxjs'
import * as Sentry from '@sentry/node'
import { ReferenceDataSeederService } from './reference-data-seeder.service'
import { parseCsv } from './csv.util'
import { ReferenceDataConfig } from './reference-data.config'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

describe('csv.util', () => {
  it('parsa righe con separatore ; e gestisce le virgolette', () => {
    const rows = parseCsv('a;b;c\n"x;y";z;w', ';')
    expect(rows[0]).toEqual(['a', 'b', 'c'])
    expect(rows[1]).toEqual(['x;y', 'z', 'w'])
  })
})

describe('ReferenceDataSeederService', () => {
  let http: any
  let prisma: any
  let logger: any
  let config: ReferenceDataConfig

  const baseSource = { separator: ';', hasHeader: true, localFile: null as string | null }

  beforeEach(() => {
    jest.clearAllMocks()
    http = { get: jest.fn() }
    prisma = {
      atecoCode: { upsert: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
      istatNazione: {
        upsert: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      istatProvincia: {
        upsert: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      istatComune: {
        upsert: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      cERCode: { upsert: jest.fn().mockResolvedValue({}), count: jest.fn().mockResolvedValue(0) },
    }
    logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    config = {
      ateco: { url: null, ...baseSource },
      nazioni: { url: null, ...baseSource },
      province: { url: null, ...baseSource },
      comuni: { url: null, ...baseSource },
      cer: { url: null, ...baseSource, separator: ',' },
      seedOnBootIfEmpty: false,
    }
  })

  function make() {
    return new ReferenceDataSeederService(http, prisma, config, logger)
  }

  it('seedComuni: scarica, salta header e fa upsert per ogni riga', async () => {
    config.comuni.url = 'https://example/comuni.csv'
    http.get.mockReturnValue(
      of({
        data: 'codice;nome;sigla;catastale;cap\n058091;Roma;RM;H501;00100\n015146;Milano;MI;F205;20100\n',
      })
    )

    const n = await make().seedComuni()

    expect(n).toBe(2)
    expect(prisma.istatComune.upsert).toHaveBeenCalledTimes(2)
    const firstArg = prisma.istatComune.upsert.mock.calls[0][0]
    expect(firstArg.where).toEqual({ code: '058091' })
    expect(firstArg.create).toMatchObject({
      code: '058091',
      name: 'Roma',
      provinciaSigla: 'RM',
      codiceCatastale: 'H501',
      cap: '00100',
    })
  })

  it('salta il dataset se la sorgente non è configurata (nessun errore)', async () => {
    const n = await make().seedComuni()
    expect(n).toBe(0)
    expect(http.get).not.toHaveBeenCalled()
    expect(prisma.istatComune.upsert).not.toHaveBeenCalled()
  })

  it('il reseed CSV non sovrascrive fonte/presenteInRentri di una riga già allineata da RENTRI', async () => {
    const store = new Map<string, any>()
    store.set('15 01 01', {
      code: '15 01 01',
      description: 'vecchia',
      isPericoloso: false,
      category: '15',
      subcategory: '01',
      fonte: 'rentri',
      presenteInRentri: false,
      rimossoDaRentriAl: new Date('2026-01-01'),
    })

    prisma.cERCode.upsert = jest.fn(async ({ where, create, update }: any) => {
      const esistente = store.get(where.code)
      const risultato = esistente ? { ...esistente, ...update } : { ...create }
      store.set(where.code, risultato)
      return risultato
    })

    config.cer.url = 'https://example/cer.csv'
    http.get.mockReturnValue(
      of({
        data: 'code,description,isPericoloso,category,subcategory\n15 01 01,Imballaggi in carta e cartone (CSV),false,15,01\n',
      })
    )

    await make().seedCer()

    const riga = store.get('15 01 01')
    expect(riga.fonte).toBe('rentri') // non sovrascritto dal reseed CSV
    expect(riga.presenteInRentri).toBe(false) // non sovrascritto dal reseed CSV
    expect(riga.description).toBe('Imballaggi in carta e cartone (CSV)') // la descrizione la aggiorna comunque (comportamento invariato)
  })

  it('seedIfEmpty popola solo i dataset vuoti', async () => {
    prisma.atecoCode.count.mockResolvedValue(5) // ateco già popolato → skip
    config.ateco.url = 'https://example/ateco.csv'
    config.nazioni.url = 'https://example/naz.csv'
    http.get.mockReturnValue(of({ data: 'h\n001;Italia;ITA\n' }))

    await make().seedIfEmpty()

    expect(prisma.atecoCode.upsert).not.toHaveBeenCalled() // ateco saltato
    expect(prisma.istatNazione.upsert).toHaveBeenCalled() // nazioni popolato
  })

  it('scheduledRefresh segnala a Bugsink un errore del refresh', async () => {
    const service = make()
    jest.spyOn(service, 'reseedAll').mockRejectedValue(new Error('rete'))
    await expect(service.scheduledRefresh()).resolves.toBeUndefined()
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { job: 'scheduledRefresh' },
    })
  })

  it('un dataset che fallisce dentro safe() arriva a Bugsink con il nome del dataset', async () => {
    config.comuni.url = 'https://example/comuni.csv'
    http.get.mockImplementation(() => {
      throw new Error('rete')
    })
    await make().reseedAll('comuni')
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { job: 'seedDatiDiRiferimento', dataset: 'comuni' },
    })
  })
})
