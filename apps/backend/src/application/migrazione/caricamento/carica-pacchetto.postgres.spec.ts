/**
 * Pezzo I2, T5/T6: `migrazione:carica` (servizio e CLI) contro Postgres reale COME `wasteflow_app`.
 * Pacchetto sintetico di sole ditte, preparato dallo staging di prova con `preparaPacchetto`.
 */
import { PrismaClient } from '@prisma/client'
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { urlComeRuolo } from '../../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55447/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { eseguiCli } from '../../../cli/migrazione-carica'
import { TenantContext } from '../../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../../infrastructure/persistence/prisma.service'
import { partitaIvaUnica, partitaIvaValida } from '../../../test-support/anagrafiche-di-test'
import { mappaValida } from '../../../test-support/migrazione/mappa-di-prova'
import {
  scriviStagingDitteProva,
  StagingDitteProva,
} from '../../../test-support/migrazione/staging-ditte-di-prova'
import { apriPacchetto, PacchettoAperto } from '../pacchetto/lettore-pacchetto'
import { validaMappa } from '../pacchetto/mappa-import'
import { preparaPacchetto } from '../pacchetto/prepara-pacchetto'
import { scriviPacchetto } from '../pacchetto/scrittore-pacchetto'
import { apriStaging } from '../staging/lettore-staging'
import { CaricaPacchettoService, RuoloNonApplicativoError } from './carica-pacchetto.service'
import { LottiImportService } from './lotti-import.service'

describe('Pezzo I2 T5/T6: carica pacchetto — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let lotti: LottiImportService
  let servizio: CaricaPacchettoService
  const logger: any = {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  const tenantCreati: string[] = []
  let radice: string
  let prova: StagingDitteProva
  const seme = 4_500_000 + (Date.now() % 100_000)

  async function azienda(): Promise<string> {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Carica pacchetto SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  /** Prepara un pacchetto in una cartella nuova; la ditta agganciabile e' creata nell'azienda. */
  async function pacchettoPer(
    tenantId: string,
    sovrascrivi: Record<string, unknown> = {}
  ): Promise<PacchettoAperto> {
    const gia = await owner.ditta.create({
      data: { tenantId, ragioneSociale: 'GIA PRESENTE', partitaIva: prova.pivaAgganciata },
    })
    const mappa = validaMappa({
      ...mappaValida(),
      tenantId,
      registri: [],
      unitaLocali: [],
      causali: [],
      agganci: [{ partitaIva: prova.pivaAgganciata, dittaId: gia.id }],
      ...sovrascrivi,
    })
    const dest = await mkdtemp(join(radice, 'pk-'))
    const cartella = join(dest, 'WW00012026')
    await preparaPacchetto(await apriStaging(prova.cartella), mappa, cartella)
    return await apriPacchetto(cartella)
  }

  const uscita = () => {
    const out: string[] = []
    const err: string[] = []
    return {
      out,
      err,
      u: { scrivi: (m: string) => out.push(m), errore: (m: string) => err.push(m) },
    }
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    lotti = new LottiImportService(app, logger)
    servizio = new CaricaPacchettoService(app, lotti, logger)
    radice = await mkdtemp(join(tmpdir(), 'carica-pk-'))
  })
  beforeEach(async () => {
    jest.clearAllMocks()
    prova = await scriviStagingDitteProva(
      await mkdtemp(join(radice, 'st-')),
      seme * 10 + tenantCreati.length * 7
    )
  })
  afterAll(async () => {
    await cancellaAziendeDiProva(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
    await rm(radice, { recursive: true, force: true })
  })

  it('si carica due volte: la seconda salta tutto; solo le ditte nuove entrano; i log non hanno valori', async () => {
    const t = await azienda()
    const p = await pacchettoPer(t)
    const primo = uscita()
    expect(
      await eseguiCli(
        ['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'],
        primo.u,
        servizio
      )
    ).toBe(0)
    expect(primo.out.join('\n')).toContain('lette: 2; inserite: 2; saltate: 0')
    // 1 ditta preesistente (aggancio) + 2 importate
    expect(await owner.ditta.count({ where: { tenantId: t } })).toBe(3)
    expect(await owner.ditta.count({ where: { tenantId: t, importSource: 'WINWASTE' } })).toBe(2)

    const secondo = uscita()
    expect(
      await eseguiCli(
        ['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'],
        secondo.u,
        servizio
      )
    ).toBe(0)
    expect(secondo.out.join('\n')).toContain('lette: 2; inserite: 0; saltate: 2')
    expect(await owner.ditta.count({ where: { tenantId: t } })).toBe(3)
    const lottiAzienda = await owner.lottoImport.findMany({
      where: { tenantId: t },
      orderBy: { avviatoIl: 'asc' },
    })
    expect(lottiAzienda.map(l => l.stato)).toEqual(['COMPLETATO', 'COMPLETATO'])
    expect(lottiAzienda[0].hashStaging).toBe(p.hashManifest)

    const tutto = JSON.stringify([
      primo,
      secondo,
      logger.info.mock.calls,
      logger.warn.mock.calls,
      logger.debug.mock.calls,
    ])
    for (const v of [prova.pivaUno, prova.cfPrivato, 'DITTA PROVA UNO', 'PRIVATO DI PROVA'])
      expect(tutto).not.toContain(v)
  })

  it('un altra azienda non vede le ditte importate (RLS)', async () => {
    const a = await azienda()
    const b = await azienda()
    const p = await pacchettoPer(a)
    expect(
      await eseguiCli(
        ['--tenant', a, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'],
        uscita().u,
        servizio
      )
    ).toBe(0)
    expect(await owner.ditta.count({ where: { tenantId: b, importSource: 'WINWASTE' } })).toBe(0)
    const viste = await TenantContext.run({ tenantId: b }, () =>
      app.$transaction(tx => tx.ditta.count())
    )
    expect(viste).toBe(0)
  })

  describe('--verifica: solo letture', () => {
    it('su un pacchetto buono non scrive nulla (nessun lotto, nessuna ditta, contatori fermi) ed esce 0', async () => {
      const t = await azienda()
      const p = await pacchettoPer(t)
      // Prova: tutte le istruzioni che la verifica manda al database. La prima e' il passaggio a
      // sola lettura, tutte le altre sono SELECT, nessun metodo di scrittura dei modelli Prisma.
      // (Il WAL globale non si puo' usare: le altre suite girano in parallelo sullo stesso database.)
      const istruzioni: string[] = []
      const originale = app.$transaction.bind(app) as (...a: unknown[]) => Promise<unknown>
      const spia = jest.spyOn(app, '$transaction').mockImplementation(((
        fn: (tx: unknown) => Promise<unknown>,
        ...resto: unknown[]
      ) =>
        originale(
          (tx: unknown) =>
            fn(
              new Proxy(tx as object, {
                get(bersaglio, nome, ricevitore) {
                  const v = Reflect.get(bersaglio, nome, ricevitore)
                  if (nome === '$executeRaw' || nome === '$queryRaw') {
                    return (q: TemplateStringsArray, ...val: unknown[]) => {
                      istruzioni.push(q.join('?').replace(/\s+/g, ' ').trim())
                      return (v as (...a: unknown[]) => unknown).call(bersaglio, q, ...val)
                    }
                  }
                  if (typeof nome === 'string' && nome !== 'then' && typeof v === 'object') {
                    istruzioni.push(`MODELLO:${nome}`)
                  }
                  return typeof v === 'function' ? v.bind(bersaglio) : v
                },
              })
            ),
          ...resto
        )) as never)
      const contiPrima = [
        await owner.ditta.count({ where: { tenantId: t } }),
        await owner.lottoImport.count({ where: { tenantId: t } }),
      ]
      // M-10: nessuna scrittura raw fuori dalla transazione.
      const fuori = [jest.spyOn(app, '$executeRaw'), jest.spyOn(app, '$executeRawUnsafe')]
      const u = uscita()
      try {
        expect(
          await eseguiCli(
            ['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE', '--verifica'],
            u.u,
            servizio
          )
        ).toBe(0)
      } finally {
        spia.mockRestore()
      }
      for (const f of fuori) expect(f).not.toHaveBeenCalled()
      fuori.forEach(f => f.mockRestore())
      expect(u.out.join('\n')).toContain('righe.ditte: 2')
      expect(u.out.join('\n')).toContain('verifica: nessun bloccante')
      expect(istruzioni[0]).toContain('SET LOCAL transaction_read_only = on')
      expect(istruzioni.length).toBeGreaterThan(3)
      for (const i of istruzioni.slice(1)) expect(i).toMatch(/^\s*SELECT /i)
      expect([
        await owner.ditta.count({ where: { tenantId: t } }),
        await owner.lottoImport.count({ where: { tenantId: t } }),
      ]).toEqual(contiPrima)
    })

    it('la transazione della verifica e read-only: il database rifiuta una scrittura (SQLSTATE 25006)', async () => {
      const t = await azienda()
      await expect(
        TenantContext.run({ tenantId: t }, () =>
          app.$transaction(async tx => {
            await tx.$executeRaw`SET LOCAL transaction_read_only = on`
            await tx.$executeRaw`INSERT INTO "ditte" ("tenant_id", "ragione_sociale", "updated_at") VALUES (${t}::uuid, 'X', now())`
          })
        )
      ).rejects.toMatchObject({ meta: { code: '25006' } })
    })

    it('elenca i bloccanti senza valori ed esce 2: registro, sede, causale inesistenti, causale non confermata, P.IVA occupata', async () => {
      const t = await azienda()
      await owner.ditta.create({
        data: { tenantId: t, ragioneSociale: 'OCCUPA', partitaIva: prova.pivaUno },
      })
      const p = await pacchettoPer(t, {
        registri: [{ legacy: 'REG1', registroId: '99999999-9999-4999-8999-999999999999' }],
        unitaLocali: [
          { legacy: 'X1.1', sedeId: '99999999-9999-4999-8999-999999999998', unitaLocaleId: null },
        ],
        causali: [
          { oper: '10', causale: 'NON_ESISTE', verso: 'CARICO', confermata: true },
          { oper: '11', causale: 'PRODUZIONE_INTERNA', verso: 'CARICO', confermata: false },
        ],
      })
      const u = uscita()
      expect(
        await eseguiCli(
          ['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE', '--verifica'],
          u.u,
          servizio
        )
      ).toBe(2)
      const err = u.err.join('\n')
      for (const c of [
        'REGISTRO_INESISTENTE',
        'SEDE_INESISTENTE',
        'CAUSALE_INESISTENTE',
        'CAUSALE_NON_CONFERMATA',
        'PARTITA_IVA_GIA_PRESENTE_NON_AGGANCIATA',
      ]) {
        expect(err).toContain(`BLOCCANTE ${c}: 1`)
      }
      expect(err).not.toContain(prova.pivaUno)
      expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)
    })

    it('un record non valido e un bloccante (RECORD_NON_VALIDO), non un crash', async () => {
      const t = await azienda()
      const mappa = validaMappa({
        ...mappaValida(),
        tenantId: t,
        registri: [],
        unitaLocali: [],
        causali: [],
        agganci: [],
      })
      const dest = await mkdtemp(join(radice, 'pk-'))
      const cartella = join(dest, 'WW00012026')
      await scriviPacchetto({
        cartella,
        archivio: 'WW00012026',
        hashStaging: 'd'.repeat(64),
        mappa,
        fasi: [
          {
            ambito: 'ANAGRAFICHE',
            fase: 'ditte',
            record: [
              {
                legacyKey: 'sbagliata',
                ragioneSociale: 'Segreta SRL',
                partitaIva: null,
                codiceFiscale: null,
              },
            ],
          },
        ],
      })
      const u = uscita()
      expect(
        await eseguiCli(
          ['--tenant', t, '--pacchetto', cartella, '--ambito', 'ANAGRAFICHE', '--verifica'],
          u.u,
          servizio
        )
      ).toBe(2)
      expect(u.err.join('\n')).toContain('BLOCCANTE RECORD_NON_VALIDO')
      expect(u.err.join('\n')).not.toContain('Segreta')
    })
  })

  it('carica: un record non valido (pacchetto non fidato) ferma tutto con uscita 2 e senza aprire un lotto', async () => {
    const t = await azienda()
    const mappa = validaMappa({
      ...mappaValida(),
      tenantId: t,
      registri: [],
      unitaLocali: [],
      causali: [],
      agganci: [],
    })
    const cartella = join(await mkdtemp(join(radice, 'pk-')), 'WW00012026')
    await scriviPacchetto({
      cartella,
      archivio: 'WW00012026',
      hashStaging: 'd'.repeat(64),
      mappa,
      fasi: [
        {
          ambito: 'ANAGRAFICHE',
          fase: 'ditte',
          record: [
            {
              legacyKey: '0001|FISC|00000000000',
              ragioneSociale: '   ',
              partitaIva: null,
              codiceFiscale: null,
            },
          ],
        },
      ],
    })
    const u = uscita()
    expect(
      await eseguiCli(
        ['--tenant', t, '--pacchetto', cartella, '--ambito', 'ANAGRAFICHE'],
        u.u,
        servizio
      )
    ).toBe(2)
    expect(u.err.join('\n')).toContain('RIGA_NON_VALIDA')
    expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)
  })

  it('P.IVA gia presente e non agganciata: il carico si ferma PRIMA del lotto (uscita 2); se compare dopo la verifica (corsa) il lotto va FALLITO, uscita 1, nessun valore nei messaggi', async () => {
    const t = await azienda()
    await owner.ditta.create({
      data: { tenantId: t, ragioneSociale: 'OCCUPA', partitaIva: prova.pivaUno },
    })
    const p = await pacchettoPer(t)
    const args = ['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE']
    const prima = uscita()
    expect(await eseguiCli(args, prima.u, servizio)).toBe(2)
    expect(prima.err.join('\n')).toContain('BLOCCANTE PARTITA_IVA_GIA_PRESENTE_NON_AGGANCIATA')
    expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)

    // Corsa: la verifica non vede la collisione (compare dopo), il blocco fallisce davvero.
    jest.spyOn(servizio, 'verifica').mockResolvedValueOnce({ bloccanti: [], informazioni: {} })
    const u = uscita()
    expect(await eseguiCli(args, u.u, servizio)).toBe(1)
    expect(u.err.join('\n')).toContain('FALLITO')
    expect(u.err.join('\n')).not.toContain(prova.pivaUno)
    const l = await owner.lottoImport.findFirst({ where: { tenantId: t } })
    expect(l!.stato).toBe('FALLITO')
    expect(l!.errore ?? '').not.toContain(prova.pivaUno)
  })

  it("I-1: mappa di un'azienda caricata con --tenant di un'altra: uscita 2, nessun lotto, nessuna ditta", async () => {
    const a = await azienda()
    const b = await azienda()
    const p = await pacchettoPer(a)
    for (const extra of [[], ['--verifica']]) {
      const u = uscita()
      expect(
        await eseguiCli(
          ['--tenant', b, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE', ...extra],
          u.u,
          servizio
        )
      ).toBe(2)
      expect(u.err.join('\n')).toContain('TENANT_DIVERSO')
    }
    expect(await owner.lottoImport.count({ where: { tenantId: b } })).toBe(0)
    expect(await owner.ditta.count({ where: { tenantId: b } })).toBe(0)
  })

  it('I-1: carica con bloccanti della mappa (registro inesistente): uscita 2 PRIMA di aprire il lotto', async () => {
    const t = await azienda()
    const p = await pacchettoPer(t, {
      registri: [{ legacy: 'REG1', registroId: '99999999-9999-4999-8999-999999999999' }],
    })
    const u = uscita()
    expect(
      await eseguiCli(
        ['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'],
        u.u,
        servizio
      )
    ).toBe(2)
    expect(u.err.join('\n')).toContain('BLOCCANTE REGISTRO_INESISTENTE')
    expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)
    expect(await owner.ditta.count({ where: { tenantId: t, importSource: 'WINWASTE' } })).toBe(0)
  })

  it('I-2: due ditte del pacchetto con lo stesso CF: --verifica e carica le fermano prima del lotto', async () => {
    const t = await azienda()
    const mappa = validaMappa({
      ...mappaValida(),
      tenantId: t,
      registri: [],
      unitaLocali: [],
      causali: [],
      agganci: [],
    })
    const cartella = join(await mkdtemp(join(radice, 'pk-')), 'WW00012026')
    const piva2 = partitaIvaValida(seme * 1000 + 777)
    const cf = 'ZZZZZZ00A00Z000Z'
    await scriviPacchetto({
      cartella,
      archivio: 'WW00012026',
      hashStaging: 'd'.repeat(64),
      mappa,
      fasi: [
        {
          ambito: 'ANAGRAFICHE',
          fase: 'ditte',
          record: [
            {
              legacyKey: `0001|FISC|${prova.pivaUno}`,
              ragioneSociale: 'A',
              partitaIva: prova.pivaUno,
              codiceFiscale: cf,
            },
            {
              legacyKey: `0001|FISC|${piva2}`,
              ragioneSociale: 'B',
              partitaIva: piva2,
              codiceFiscale: cf,
            },
          ],
        },
      ],
    })
    for (const extra of [['--verifica'], []]) {
      const u = uscita()
      expect(
        await eseguiCli(
          ['--tenant', t, '--pacchetto', cartella, '--ambito', 'ANAGRAFICHE', ...extra],
          u.u,
          servizio
        )
      ).toBe(2)
      expect(u.err.join('\n')).toContain('BLOCCANTE DUPLICATO_NEL_PACCHETTO')
    }
    expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)
  })

  it('M-7: un carattere di controllo nella ragione sociale e un record non valido, non un blocco fallito', async () => {
    const t = await azienda()
    const mappa = validaMappa({
      ...mappaValida(),
      tenantId: t,
      registri: [],
      unitaLocali: [],
      causali: [],
      agganci: [],
    })
    const cartella = join(await mkdtemp(join(radice, 'pk-')), 'WW00012026')
    await scriviPacchetto({
      cartella,
      archivio: 'WW00012026',
      hashStaging: 'd'.repeat(64),
      mappa,
      fasi: [
        {
          ambito: 'ANAGRAFICHE',
          fase: 'ditte',
          record: [
            {
              legacyKey: `0001|FISC|${prova.pivaUno}`,
              ragioneSociale: 'A\u0000B',
              partitaIva: prova.pivaUno,
              codiceFiscale: null,
            },
          ],
        },
      ],
    })
    const u = uscita()
    expect(
      await eseguiCli(
        ['--tenant', t, '--pacchetto', cartella, '--ambito', 'ANAGRAFICHE'],
        u.u,
        servizio
      )
    ).toBe(2)
    expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)
  })

  it('uso errato 64; pacchetto manomesso 2; ambito senza fasi 2', async () => {
    const t = await azienda()
    const p = await pacchettoPer(t)
    expect(
      await eseguiCli(
        ['--tenant', 'non-uuid', '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'],
        uscita().u,
        servizio
      )
    ).toBe(64)
    expect(await eseguiCli(['--tenant', t, '--pacchetto', p.cartella], uscita().u, servizio)).toBe(
      64
    )
    expect(
      await eseguiCli(
        [
          '--tenant',
          t,
          '--pacchetto',
          p.cartella,
          '--ambito',
          'ANAGRAFICHE',
          '--dimensione-blocco',
          '0',
        ],
        uscita().u,
        servizio
      )
    ).toBe(64)
    expect(
      await eseguiCli(
        ['--tenant', t, '--pacchetto', join(radice, 'inesistente'), '--ambito', 'ANAGRAFICHE'],
        uscita().u,
        servizio
      )
    ).toBe(2)
    expect(
      await eseguiCli(
        ['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'FIR'],
        uscita().u,
        servizio
      )
    ).toBe(2)
  })

  it('rifiuta di girare con un ruolo che aggira la RLS (proprietario), accetta il ruolo applicativo', async () => {
    await expect(servizio.verificaRuoloApplicativo()).resolves.toBeUndefined()
    const comeProprietario = new CaricaPacchettoService(
      owner as unknown as PrismaService,
      lotti,
      logger
    )
    await expect(comeProprietario.verificaRuoloApplicativo()).rejects.toBeInstanceOf(
      RuoloNonApplicativoError
    )
    const t = await azienda()
    const p = await pacchettoPer(t)
    const u = uscita()
    expect(
      await eseguiCli(
        ['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'],
        u.u,
        comeProprietario
      )
    ).toBe(1)
    expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)
  })
})
