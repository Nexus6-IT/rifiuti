/**
 * Fase 3 (3.1), Task 9: motore di caricamento a blocchi per tenant, contro Postgres reale COME
 * `wasteflow_app` (RLS ENABLE+FORCE). Il proprietario prepara e controlla; la pulizia cancella solo
 * le aziende create qui, per id esatti (la cascata porta via ditte, movimenti e lotti).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55447/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaValida, partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
import {
  inserisciDitteImportate,
  type RigaDittaImportata,
} from '../../../test-support/migrazione/inserisci-ditte-importate'
import { chiaveDitta } from '../../../domain/migrazione/chiavi-legacy'
import { CaricamentoBloccoFallitoError, LottoGiaInCorsoError } from './errori'
import { inserisciABlocchi } from './inserisci-a-blocchi'
import { LottiImportService } from './lotti-import.service'
import type { InserisciBlocco } from './tipi'

describe('Fase 3 (3.1): motore di caricamento a blocchi — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let lotti: LottiImportService
  const logger: any = {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  const tenantCreati: string[] = []
  let n = 0
  const seme = 7_000_000 + (Date.now() % 900_000)

  const dip = () => ({ prisma: app, lotti, logger })

  async function azienda(): Promise<string> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Import blocchi SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  const avvia = (
    tenantId: string,
    archivio = 'WW00012026',
    ambito: 'ANAGRAFICHE' | 'REGISTRO' = 'ANAGRAFICHE'
  ) =>
    lotti.avvia(tenantId, {
      importSource: 'WINWASTE',
      archivio,
      ambito,
      formatoStaging: 'winwaste-staging/1',
      hashStaging: 'e'.repeat(64),
    })

  /** Righe con P.IVA valide e distinte (prefisso 000 + seme: mai dati reali). */
  function righe(quante: number, daIndice = 0): RigaDittaImportata[] {
    return Array.from({ length: quante }, (_, i) => {
      const piva = partitaIvaValida(seme * 1000 + daIndice + i)
      return {
        legacyKey: chiaveDitta('0001', piva),
        ragioneSociale: `DITTA PROVA ${daIndice + i}`,
        partitaIva: piva,
      }
    })
  }

  const contaDitte = (tenantId: string, lottoId?: string) =>
    owner.ditta.count({ where: { tenantId, ...(lottoId ? { lottoImportId: lottoId } : {}) } })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    lotti = new LottiImportService(app, logger)
  })

  beforeEach(() => jest.clearAllMocks())

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('450 righe in blocchi da 200: 3 transazioni, conteggi giusti, lotto COMPLETATO', async () => {
    const t = await azienda()
    const lotto = await avvia(t)
    const input = righe(450)
    const spia = jest.fn(inserisciDitteImportate)

    const conteggi = await inserisciABlocchi(dip(), t, lotto.id, input, { inserisciBlocco: spia })

    expect(conteggi).toEqual({ lette: 450, inserite: 450, saltate: 0, scartate: 0, blocchi: 3 })
    expect(spia).toHaveBeenCalledTimes(3)
    expect(spia.mock.calls.map(c => c[1].length)).toEqual([200, 200, 50])
    // tre transazioni diverse
    expect(new Set(spia.mock.calls.map(c => c[0])).size).toBe(3)
    expect(spia.mock.calls.map(c => c[2].numeroBlocco)).toEqual([1, 2, 3])
    const letto = await owner.lottoImport.findUniqueOrThrow({ where: { id: lotto.id } })
    expect(letto.stato).toBe('COMPLETATO')
    expect(letto.conteggi).toEqual({
      lette: 450,
      inserite: 450,
      saltate: 0,
      scartate: 0,
      blocchi: 3,
    })
    expect(letto.conclusoIl).not.toBeNull()
    expect(await contaDitte(t, lotto.id)).toBe(450)
  })

  it('seconda esecuzione dello stesso input su un lotto nuovo: idempotente, inserite 0, saltate 450', async () => {
    const t = await azienda()
    const input = righe(450)
    const primo = await avvia(t)
    await inserisciABlocchi(dip(), t, primo.id, input, { inserisciBlocco: inserisciDitteImportate })

    const secondo = await avvia(t)
    const conteggi = await inserisciABlocchi(dip(), t, secondo.id, input, {
      inserisciBlocco: inserisciDitteImportate,
    })

    expect(conteggi).toEqual({ lette: 450, inserite: 0, saltate: 450, scartate: 0, blocchi: 3 })
    expect(await contaDitte(t)).toBe(450)
    expect((await owner.lottoImport.findUniqueOrThrow({ where: { id: secondo.id } })).stato).toBe(
      'COMPLETATO'
    )
  })

  it("P.IVA gia' presente con un'altra chiave nel secondo blocco: primo blocco scritto, secondo annullato, lotto FALLITO col blocco e la classe dell\'errore (mai i valori), terzo non tentato", async () => {
    const t = await azienda()
    const input = righe(450)
    // la P.IVA della riga 250 (blocco 2) esiste gia' con una chiave legacy DIVERSA
    const pivaInConflitto = input[250].partitaIva as string
    await owner.ditta.create({
      data: { tenantId: t, ragioneSociale: 'GIA PRESENTE', partitaIva: pivaInConflitto },
    })
    const lotto = await avvia(t)
    const spia = jest.fn(inserisciDitteImportate)

    const errore = await inserisciABlocchi(dip(), t, lotto.id, input, {
      inserisciBlocco: spia,
    }).catch(e => e)

    expect(errore).toBeInstanceOf(CaricamentoBloccoFallitoError)
    expect(errore.numeroBlocco).toBe(2)
    expect(spia).toHaveBeenCalledTimes(2) // il terzo blocco non e' tentato
    const letto = await owner.lottoImport.findUniqueOrThrow({ where: { id: lotto.id } })
    expect(letto.stato).toBe('FALLITO')
    expect(letto.errore).toContain('Blocco 2')
    expect(letto.errore).toContain('violazione di unicità (codice 23505)')
    // nessun dato personale nel lotto ne' nell'eccezione ne' nei log
    for (const testo of [letto.errore ?? '', errore.message]) {
      expect(testo).not.toContain(pivaInConflitto)
    }
    expect(
      JSON.stringify(logger.warn.mock.calls) + JSON.stringify(logger.info.mock.calls)
    ).not.toContain(pivaInConflitto)
    // blocco 1 scritto (200), blocco 2 annullato per intero
    expect(await contaDitte(t, lotto.id)).toBe(200)
    expect(letto.conteggi).toEqual({
      lette: 200,
      inserite: 200,
      saltate: 0,
      scartate: 0,
      blocchi: 1,
    })
  })

  it("contesto: dentro il blocco app.tenant_id e' il tenant del lotto; fuori da inserisciABlocchi il contesto non c'e' piu'", async () => {
    const t = await azienda()
    const lotto = await avvia(t)
    const visti: Array<{ ctx: string | null; sessione: string | null }> = []
    const sonda: InserisciBlocco<number> = async (tx, blocco) => {
      const [r] = await tx.$queryRaw<
        Array<{ v: string | null }>
      >`SELECT current_setting('app.tenant_id', true) AS v`
      visti.push({ ctx: TenantContext.getStoreTenantId(), sessione: r.v })
      return blocco.length
    }

    await inserisciABlocchi(dip(), t, lotto.id, [1, 2, 3, 4, 5], {
      dimensioneBlocco: 2,
      inserisciBlocco: sonda,
    })

    expect(visti).toHaveLength(3)
    for (const v of visti) expect(v).toEqual({ ctx: t, sessione: t })
    expect(TenantContext.getStoreTenantId()).toBeNull()
    // una query fuori dal motore non porta il tenant del lotto
    const [fuori] = await app.$queryRaw<
      Array<{ v: string | null }>
    >`SELECT current_setting('app.tenant_id', true) AS v`
    expect(fuori.v ?? '').toBe('')
  })

  it("tenant diverso in un blocco: la policy rifiuta la scrittura (lotto FALLITO) e le righe di un'altra azienda non sono visibili", async () => {
    const a = await azienda()
    const b = await azienda()
    await owner.ditta.create({
      data: {
        tenantId: b,
        ragioneSociale: 'DI B',
        partitaIva: partitaIvaValida(seme * 1000 + 999_001),
      },
    })
    const lotto = await avvia(a)
    let vistoDiB = -1
    const spia: InserisciBlocco<RigaDittaImportata> = async (tx, blocco, ctx) => {
      const [r] = await tx.$queryRaw<
        Array<{ c: bigint }>
      >`SELECT count(*) AS c FROM "ditte" WHERE "tenant_id" = ${b}::uuid`
      vistoDiB = Number(r.c)
      return inserisciDitteImportate(tx, blocco, ctx)
    }
    const riga = { ...righe(1, 5000)[0], tenantIdForzato: b }

    const errore = await inserisciABlocchi(dip(), a, lotto.id, [riga], {
      inserisciBlocco: spia,
    }).catch(e => e)

    expect(vistoDiB).toBe(0) // B ha una ditta, ma dal contesto di A non si vede
    expect(errore).toBeInstanceOf(CaricamentoBloccoFallitoError)
    expect((await owner.lottoImport.findUniqueOrThrow({ where: { id: lotto.id } })).stato).toBe(
      'FALLITO'
    )
    expect(await owner.ditta.count({ where: { tenantId: b, importSource: 'WINWASTE' } })).toBe(0)
  })

  it("due avvia concorrenti sullo stesso archivio e ambito: uno solo IN_CORSO, l'altro errore tipato", async () => {
    const t = await azienda()
    const esiti = await Promise.allSettled([avvia(t), avvia(t)])
    expect(esiti.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    const rifiutato = esiti.find(e => e.status === 'rejected') as PromiseRejectedResult
    expect(rifiutato.reason).toBeInstanceOf(LottoGiaInCorsoError)
    expect(await owner.lottoImport.count({ where: { tenantId: t, stato: 'IN_CORSO' } })).toBe(1)
    // un ambito o un archivio diversi non confliggono
    await expect(avvia(t, 'WW00012026', 'REGISTRO')).resolves.toBeDefined()
    await expect(avvia(t, 'WW00012025')).resolves.toBeDefined()
  })

  it("dopo il fallimento un nuovo lotto per lo stesso archivio si puo' avviare (il FALLITO non blocca)", async () => {
    const t = await azienda()
    const lotto = await avvia(t)
    await lotti.fallisci(t, lotto.id, 'prova')
    await expect(avvia(t)).resolves.toBeDefined()
  })

  it('la rete dei movimenti: un movimento importato senza riga di blocco fa fallire il BLOCCO (SET CONSTRAINTS IMMEDIATE), nessuna riga persiste', async () => {
    const t = await azienda()
    const registro = await owner.registroRifiuti.create({ data: { tenantId: t, descrizione: 'R' } })
    const lotto = await avvia(t, 'WW00012026', 'REGISTRO')
    const scriviSenzaRiga: InserisciBlocco<number> = async (tx, blocco, ctx) => {
      for (const p of blocco) {
        await tx.wasteMovement.create({
          data: {
            tenantId: t,
            registroId: registro.id,
            progressiveYear: 2026,
            progressiveNumber: p,
            type: 'CARICO',
            movementDate: new Date('2026-03-01T10:00:00Z'),
            registrationDate: new Date('2026-03-01T10:00:00Z'),
            causale: 'PRODUZIONE_INTERNA',
            cerCode: '15 01 01',
            quantity: 10,
            unit: 'KG',
            importSource: 'WINWASTE',
            legacyKey: `0001|2026|MOVIMENTI|${p}`,
            lottoImportId: ctx.lottoId,
          } as never,
        })
      }
      return blocco.length
    }

    const errore = await inserisciABlocchi(dip(), t, lotto.id, [1, 2, 3], {
      inserisciBlocco: scriviSenzaRiga,
    }).catch(e => e)

    expect(errore).toBeInstanceOf(CaricamentoBloccoFallitoError)
    expect(errore.causa).toContain('riga di blocco all')
    expect((await owner.lottoImport.findUniqueOrThrow({ where: { id: lotto.id } })).stato).toBe(
      'FALLITO'
    )
    expect(await owner.wasteMovement.count({ where: { tenantId: t } })).toBe(0)
  })

  it('dimensione del blocco o vincolo non validi: RangeError prima di toccare il database', async () => {
    const t = await azienda()
    const lotto = await avvia(t)
    await expect(
      inserisciABlocchi(dip(), t, lotto.id, [1], {
        dimensioneBlocco: 0,
        inserisciBlocco: async () => 1,
      })
    ).rejects.toThrow(RangeError)
    await expect(
      inserisciABlocchi(dip(), t, lotto.id, [1], {
        vincoliDifferiti: ['x"; DROP TABLE ditte; --'],
        inserisciBlocco: async () => 1,
      })
    ).rejects.toThrow(RangeError)
    expect((await owner.lottoImport.findUniqueOrThrow({ where: { id: lotto.id } })).stato).toBe(
      'IN_CORSO'
    )
  })

  it('i log del motore hanno solo id tecnici e conteggi', async () => {
    const t = await azienda()
    const lotto = await avvia(t)
    const input = righe(3, 7000)
    await inserisciABlocchi(dip(), t, lotto.id, input, { inserisciBlocco: inserisciDitteImportate })
    const tutto = JSON.stringify([
      ...logger.debug.mock.calls,
      ...logger.info.mock.calls,
      ...logger.warn.mock.calls,
    ])
    for (const r of input) {
      expect(tutto).not.toContain(r.partitaIva as string)
      expect(tutto).not.toContain(r.ragioneSociale)
    }
  })
})
