/**
 * `cleanDatabase` svuota ogni tabella di `public` TRANNE quelle in `TABELLE_NON_SVUOTABILI`:
 * `causali_registro` e' il catalogo di sistema, lo scrive solo la migration e i test non possono
 * ricrearlo (l'applicazione non ha i privilegi di scrittura). Prova unitaria sull'elenco: non si
 * esegue `cleanDatabase` su un database vero, che non e' usa e getta.
 */
import {
  PrismaService,
  TABELLE_NON_SVUOTABILI,
  TABELLE_PESE_IN_SOLA_SCRITTURA,
} from './prisma.service'

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
    const eseguiti = () => esegui.mock.calls.map(c => String(c[0]))

    await service.cleanDatabase()

    const [prima, ...truncate] = eseguiti()
    expect(prima).toMatch(/^DELETE FROM "public"\."tenants"/)
    expect(truncate).toEqual([
      'TRUNCATE TABLE "public"."causali_registro_azienda" CASCADE;',
      'TRUNCATE TABLE "public"."waste_movements" CASCADE;',
    ])
  })

  it("le tabelle delle pese sono protette dal TRUNCATE: l'elenco e' dichiarato e la query esclude quelle che le raggiungono", async () => {
    expect([...TABELLE_PESE_IN_SOLA_SCRITTURA].sort()).toEqual([
      'allegati_pesa',
      'pesate',
      'rettifiche_peso',
    ])
    const service = new PrismaService()
    const query = jest.spyOn(service as never, '$queryRaw').mockResolvedValue([] as never)
    jest.spyOn(service as never, '$executeRawUnsafe').mockResolvedValue(0 as never)
    await service.cleanDatabase()
    const [testo, ...parametri] = query.mock.calls[0] as unknown as [string[], ...unknown[]]
    expect(testo.join('?')).toContain('WITH RECURSIVE raggiunte')
    expect(parametri[0]).toEqual([...TABELLE_PESE_IN_SOLA_SCRITTURA])
  })

  it('le aziende si cancellano prima dei TRUNCATE, a giri finche non resta nessuna foglia', async () => {
    const service = new PrismaService()
    jest.spyOn(service as never, '$queryRaw').mockResolvedValue([{ tablename: 'users' }] as never)
    const esegui = jest
      .spyOn(service as never, '$executeRawUnsafe')
      .mockResolvedValueOnce(2 as never)
      .mockResolvedValueOnce(1 as never)
      .mockResolvedValue(0 as never)
    await service.cleanDatabase()
    const sql = esegui.mock.calls.map(c => String(c[0]))
    expect(sql.filter(x => x.startsWith('DELETE FROM'))).toHaveLength(3)
    expect(sql[sql.length - 1]).toBe('TRUNCATE TABLE "public"."users" CASCADE;')
  })
})
