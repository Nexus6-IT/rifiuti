/**
 * Pezzo I2, T5/T6: `migrazione:carica` (servizio e CLI) contro Postgres reale COME `wasteflow_app`.
 * Pacchetto sintetico di sole ditte, preparato dallo staging di prova con `preparaPacchetto`.
 */
import { PrismaClient } from '@prisma/client'
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
import { partitaIvaUnica } from '../../../test-support/anagrafiche-di-test'
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
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Carica pacchetto SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  /** Prepara un pacchetto in una cartella nuova; la ditta agganciabile e' creata nell'azienda. */
  async function pacchettoPer(tenantId: string, sovrascrivi: Record<string, unknown> = {}): Promise<PacchettoAperto> {
    const gia = await owner.ditta.create({
      data: { tenantId, ragioneSociale: 'GIA PRESENTE', partitaIva: prova.pivaAgganciata },
    })
    const mappa = validaMappa({
      ...mappaValida(),
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
    return { out, err, u: { scrivi: (m: string) => out.push(m), errore: (m: string) => err.push(m) } }
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
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
    await rm(radice, { recursive: true, force: true })
  })

  it('si carica due volte: la seconda salta tutto; solo le ditte nuove entrano; i log non hanno valori', async () => {
    const t = await azienda()
    const p = await pacchettoPer(t)
    const primo = uscita()
    expect(await eseguiCli(['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'], primo.u, servizio)).toBe(0)
    expect(primo.out.join('\n')).toContain('lette: 2; inserite: 2; saltate: 0')
    // 1 ditta preesistente (aggancio) + 2 importate
    expect(await owner.ditta.count({ where: { tenantId: t } })).toBe(3)
    expect(await owner.ditta.count({ where: { tenantId: t, importSource: 'WINWASTE' } })).toBe(2)

    const secondo = uscita()
    expect(await eseguiCli(['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'], secondo.u, servizio)).toBe(0)
    expect(secondo.out.join('\n')).toContain('lette: 2; inserite: 0; saltate: 2')
    expect(await owner.ditta.count({ where: { tenantId: t } })).toBe(3)
    const lottiAzienda = await owner.lottoImport.findMany({ where: { tenantId: t }, orderBy: { avviatoIl: 'asc' } })
    expect(lottiAzienda.map(l => l.stato)).toEqual(['COMPLETATO', 'COMPLETATO'])
    expect(lottiAzienda[0].hashStaging).toBe(p.hashManifest)

    const tutto = JSON.stringify([primo, secondo, logger.info.mock.calls, logger.warn.mock.calls, logger.debug.mock.calls])
    for (const v of [prova.pivaUno, prova.cfPrivato, 'DITTA PROVA UNO', 'PRIVATO DI PROVA']) expect(tutto).not.toContain(v)
  })

  it('un altra azienda non vede le ditte importate (RLS)', async () => {
    const a = await azienda()
    const b = await azienda()
    const p = await pacchettoPer(a)
    expect(await eseguiCli(['--tenant', a, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'], uscita().u, servizio)).toBe(0)
    expect(await owner.ditta.count({ where: { tenantId: b, importSource: 'WINWASTE' } })).toBe(0)
    const viste = await TenantContext.run({ tenantId: b }, () => app.$transaction(tx => tx.ditta.count()))
    expect(viste).toBe(0)
  })

  describe('--verifica: solo letture', () => {
    it('su un pacchetto buono non scrive nulla (nessun lotto, nessuna ditta, contatori fermi) ed esce 0', async () => {
      const t = await azienda()
      const p = await pacchettoPer(t)
      // Prova diretta: un lettore non produce WAL. Si misura il WAL scritto attorno alla verifica; un
      // checkpoint o l'autovacuum di passaggio puo' sporcare una misura, una scrittura vera le sporca
      // TUTTE: basta una misura a zero.
      const lsn = async () =>
        (await owner.$queryRaw<Array<{ v: string }>>`SELECT pg_current_wal_insert_lsn()::text AS v`)[0].v
      const diff = async (da: string, a: string) =>
        Number(
          (await owner.$queryRaw<Array<{ d: string }>>`SELECT pg_wal_lsn_diff(${a}::pg_lsn, ${da}::pg_lsn)::text AS d`)[0].d
        )
      const righeTabelle = async () => [await owner.ditta.count(), await owner.lottoImport.count()]
      const misure: number[] = []
      for (let i = 0; i < 3; i++) {
        const contiPrima = await righeTabelle()
        const da = await lsn()
        const u = uscita()
        expect(await eseguiCli(['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE', '--verifica'], u.u, servizio)).toBe(0)
        const a = await lsn()
        expect(u.out.join('\n')).toContain('righe.ditte: 2')
        expect(u.out.join('\n')).toContain('verifica: nessun bloccante')
        expect(await righeTabelle()).toEqual(contiPrima)
        misure.push(await diff(da, a))
        if (misure[i] === 0) break
      }
      expect(misure).toContain(0)
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
      await owner.ditta.create({ data: { tenantId: t, ragioneSociale: 'OCCUPA', partitaIva: prova.pivaUno } })
      const p = await pacchettoPer(t, {
        registri: [{ legacy: 'REG1', registroId: '99999999-9999-4999-8999-999999999999' }],
        unitaLocali: [{ legacy: 'X1.1', sedeId: '99999999-9999-4999-8999-999999999998', unitaLocaleId: null }],
        causali: [
          { oper: '10', causale: 'NON_ESISTE', verso: 'CARICO', confermata: true },
          { oper: '11', causale: 'PRODUZIONE_INTERNA', verso: 'CARICO', confermata: false },
        ],
      })
      const u = uscita()
      expect(await eseguiCli(['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE', '--verifica'], u.u, servizio)).toBe(2)
      const err = u.err.join('\n')
      for (const c of ['REGISTRO_INESISTENTE', 'SEDE_INESISTENTE', 'CAUSALE_INESISTENTE', 'CAUSALE_NON_CONFERMATA', 'PARTITA_IVA_GIA_PRESENTE_NON_AGGANCIATA']) {
        expect(err).toContain(`BLOCCANTE ${c}: 1`)
      }
      expect(err).not.toContain(prova.pivaUno)
      expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)
    })

    it('un record non valido e un bloccante (RECORD_NON_VALIDO), non un crash', async () => {
      const t = await azienda()
      const mappa = validaMappa({ ...mappaValida(), registri: [], unitaLocali: [], causali: [], agganci: [] })
      const dest = await mkdtemp(join(radice, 'pk-'))
      const cartella = join(dest, 'WW00012026')
      await scriviPacchetto({
        cartella,
        archivio: 'WW00012026',
        hashStaging: 'd'.repeat(64),
        mappa,
        fasi: [{ ambito: 'ANAGRAFICHE', fase: 'ditte', record: [{ legacyKey: 'sbagliata', ragioneSociale: 'Segreta SRL', partitaIva: null, codiceFiscale: null }] }],
      })
      const u = uscita()
      expect(await eseguiCli(['--tenant', t, '--pacchetto', cartella, '--ambito', 'ANAGRAFICHE', '--verifica'], u.u, servizio)).toBe(2)
      expect(u.err.join('\n')).toContain('BLOCCANTE RECORD_NON_VALIDO')
      expect(u.err.join('\n')).not.toContain('Segreta')
    })
  })

  it('carica: un record non valido (pacchetto non fidato) ferma tutto con uscita 2 e senza aprire un lotto', async () => {
    const t = await azienda()
    const mappa = validaMappa({ ...mappaValida(), registri: [], unitaLocali: [], causali: [], agganci: [] })
    const cartella = join(await mkdtemp(join(radice, 'pk-')), 'WW00012026')
    await scriviPacchetto({
      cartella,
      archivio: 'WW00012026',
      hashStaging: 'd'.repeat(64),
      mappa,
      fasi: [{ ambito: 'ANAGRAFICHE', fase: 'ditte', record: [{ legacyKey: '0001|FISC|00000000000', ragioneSociale: '   ', partitaIva: null, codiceFiscale: null }] }],
    })
    const u = uscita()
    expect(await eseguiCli(['--tenant', t, '--pacchetto', cartella, '--ambito', 'ANAGRAFICHE'], u.u, servizio)).toBe(2)
    expect(u.err.join('\n')).toContain('RIGA_NON_VALIDA')
    expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)
  })

  it('carica con P.IVA gia presente e non agganciata: lotto FALLITO, uscita 1, nessun valore nei messaggi', async () => {
    const t = await azienda()
    await owner.ditta.create({ data: { tenantId: t, ragioneSociale: 'OCCUPA', partitaIva: prova.pivaUno } })
    const p = await pacchettoPer(t)
    const u = uscita()
    expect(await eseguiCli(['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'], u.u, servizio)).toBe(1)
    expect(u.err.join('\n')).toContain('FALLITO')
    expect(u.err.join('\n')).not.toContain(prova.pivaUno)
    const l = await owner.lottoImport.findFirst({ where: { tenantId: t } })
    expect(l!.stato).toBe('FALLITO')
    expect(l!.errore ?? '').not.toContain(prova.pivaUno)
  })

  it('uso errato 64; pacchetto manomesso 2; ambito senza fasi 2', async () => {
    const t = await azienda()
    const p = await pacchettoPer(t)
    expect(await eseguiCli(['--tenant', 'non-uuid', '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'], uscita().u, servizio)).toBe(64)
    expect(await eseguiCli(['--tenant', t, '--pacchetto', p.cartella], uscita().u, servizio)).toBe(64)
    expect(await eseguiCli(['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE', '--dimensione-blocco', '0'], uscita().u, servizio)).toBe(64)
    expect(await eseguiCli(['--tenant', t, '--pacchetto', join(radice, 'inesistente'), '--ambito', 'ANAGRAFICHE'], uscita().u, servizio)).toBe(2)
    expect(await eseguiCli(['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'FIR'], uscita().u, servizio)).toBe(2)
  })

  it('rifiuta di girare con un ruolo che aggira la RLS (proprietario), accetta il ruolo applicativo', async () => {
    await expect(servizio.verificaRuoloApplicativo()).resolves.toBeUndefined()
    const comeProprietario = new CaricaPacchettoService(owner as unknown as PrismaService, lotti, logger)
    await expect(comeProprietario.verificaRuoloApplicativo()).rejects.toBeInstanceOf(RuoloNonApplicativoError)
    const t = await azienda()
    const p = await pacchettoPer(t)
    const u = uscita()
    expect(await eseguiCli(['--tenant', t, '--pacchetto', p.cartella, '--ambito', 'ANAGRAFICHE'], u.u, comeProprietario)).toBe(1)
    expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)
  })
})
