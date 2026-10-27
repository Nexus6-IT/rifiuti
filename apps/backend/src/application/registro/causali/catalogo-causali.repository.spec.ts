import { ConflictException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import {
  caricaCatalogoCausali,
  confermaVersioneAzienda,
  dataColonnaComeGiorno,
  type LettoreCatalogoCausali,
} from './catalogo-causali.repository'
import { righeCausaliSistema } from './catalogo-causali.fixture'

const TENANT = '11111111-1111-4111-8111-111111111111'

describe('dataColonnaComeGiorno', () => {
  it('mezzanotte UTC -> AAAA-MM-GG, senza spostare di un giorno', () => {
    expect(dataColonnaComeGiorno(new Date('2026-01-01T00:00:00.000Z'))).toBe('2026-01-01')
    expect(dataColonnaComeGiorno(new Date('2026-12-31T00:00:00.000Z'))).toBe('2026-12-31')
    // 1 gennaio / 31 ottobre: UTC+1 e UTC+2 non devono influire
    expect(dataColonnaComeGiorno(new Date('2026-10-31T00:00:00.000Z'))).toBe('2026-10-31')
  })

  it('null -> null', () => {
    expect(dataColonnaComeGiorno(null)).toBeNull()
  })
})

describe('caricaCatalogoCausali', () => {
  it('converte le righe e passa il tenant alla query aziendale', async () => {
    const findSistema = jest.fn().mockResolvedValue(righeCausaliSistema())
    const findAzienda = jest.fn().mockResolvedValue([
      {
        id: 'v1',
        natura: 'PROPRIA',
        codice: 'AZ_PROVA',
        verso: 'SCARICO',
        descrizione: 'Prova',
        ruoloMud: 'ESCLUSO',
        codiceRentri: 'I',
        operazione: null,
        ordine: 100,
        validaDal: new Date('2026-03-01T00:00:00.000Z'),
        validaAl: null,
      },
      {
        id: 'd1',
        natura: 'DISATTIVAZIONE',
        codice: 'CESSIONE',
        verso: 'SCARICO',
        descrizione: null,
        ruoloMud: null,
        codiceRentri: null,
        operazione: null,
        ordine: 100,
        validaDal: null,
        validaAl: null,
      },
    ])
    const db: LettoreCatalogoCausali = {
      causaleRegistro: { findMany: findSistema },
      causaleRegistroAzienda: { findMany: findAzienda },
    }

    const catalogo = await caricaCatalogoCausali(db, TENANT)

    expect(findAzienda).toHaveBeenCalledWith({ where: { tenantId: TENANT } })
    expect(catalogo.comportamento('SCARICO', 'AZ_PROVA', '2026-03-01')!.validaDal).toBe(
      '2026-03-01'
    )
    expect(catalogo.comportamento('SCARICO', 'AZ_PROVA', '2026-02-28')).toBeNull()
    expect(catalogo.selezionabile('SCARICO', 'CESSIONE', '2026-06-01')).toEqual({
      ok: false,
      motivo: 'DISATTIVATA',
    })
    expect(catalogo.opzioni('CARICO', '2026-06-01')).toHaveLength(5)
  })
})

describe('confermaVersioneAzienda', () => {
  function txCon(righe: Array<{ valida_dal: Date | null; valida_al: Date | null }>) {
    return { $queryRaw: jest.fn().mockResolvedValue(righe) } as unknown as Prisma.TransactionClient
  }
  const dal = new Date('2026-03-01T00:00:00.000Z')

  it('accetta una versione aperta e valida al giorno', async () => {
    await expect(
      confermaVersioneAzienda(
        txCon([{ valida_dal: dal, valida_al: null }]),
        TENANT,
        'v1',
        '2026-06-01'
      )
    ).resolves.toBeUndefined()
  })

  it('accetta il giorno di valida_al', async () => {
    await expect(
      confermaVersioneAzienda(
        txCon([{ valida_dal: dal, valida_al: new Date('2026-05-31T00:00:00.000Z') }]),
        TENANT,
        'v1',
        '2026-05-31'
      )
    ).resolves.toBeUndefined()
  })

  it.each([
    [
      'chiusa prima del giorno',
      [{ valida_dal: dal, valida_al: new Date('2026-05-31T00:00:00.000Z') }],
      '2026-06-01',
    ],
    ['non ancora iniziata', [{ valida_dal: dal, valida_al: null }], '2026-02-28'],
    ['sparita', [], '2026-06-01'],
  ])('409 CAUSALE_MODIFICATA se %s', async (_nome, righe, giorno) => {
    const errore = await confermaVersioneAzienda(
      txCon(righe as Array<{ valida_dal: Date | null; valida_al: Date | null }>),
      TENANT,
      'v1',
      giorno
    ).catch((e: unknown) => e)
    expect(errore).toBeInstanceOf(ConflictException)
    expect((errore as ConflictException).getResponse()).toMatchObject({
      error: 'CAUSALE_MODIFICATA',
    })
  })
})
