/**
 * `cleanDatabase` svuota ogni tabella di `public` TRANNE quelle in `TABELLE_NON_SVUOTABILI`:
 * `causali_registro` e' il catalogo di sistema, lo scrive solo la migration e i test non possono
 * ricrearlo (l'applicazione non ha i privilegi di scrittura). Prova unitaria sull'elenco: non si
 * esegue `cleanDatabase` su un database vero, che non e' usa e getta.
 */
import { PrismaService, TABELLE_NON_SVUOTABILI } from './prisma.service'

describe('PrismaService.cleanDatabase — tabelle non svuotabili', () => {
  afterEach(() => jest.restoreAllMocks())

  it("l'elenco contiene il registro delle migration e il catalogo delle causali", () => {
    expect([...TABELLE_NON_SVUOTABILI].sort()).toEqual(['_prisma_migrations', 'causali_registro'])
  })

  it('non fa TRUNCATE del catalogo né di _prisma_migrations, ma di tutte le altre', async () => {
    const service = new PrismaService()
    jest
      .spyOn(service as never, '$queryRaw')
      .mockResolvedValue([
        { tablename: '_prisma_migrations' },
        { tablename: 'causali_registro' },
        { tablename: 'causali_registro_azienda' },
        { tablename: 'waste_movements' },
      ] as never)
    const esegui = jest.spyOn(service as never, '$executeRawUnsafe').mockResolvedValue(0 as never)

    await service.cleanDatabase()

    const eseguiti = esegui.mock.calls.map(c => String(c[0]))
    expect(eseguiti).toEqual([
      'TRUNCATE TABLE "public"."causali_registro_azienda" CASCADE;',
      'TRUNCATE TABLE "public"."waste_movements" CASCADE;',
    ])
  })
})
