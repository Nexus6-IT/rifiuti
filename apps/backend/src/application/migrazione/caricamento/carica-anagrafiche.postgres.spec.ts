/**
 * Pezzo I4, T3/T4/T5: caricamento di sedi, ruoli e automezzi contro Postgres reale COME
 * `wasteflow_app`. Pacchetto sintetico preparato dallo staging di prova con `preparaPacchetto`:
 * ditte nuove (una privata), una ditta con piu' sedi, una gia' presente e agganciata.
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
import { cancellaAziendeDiProva } from '../../../test-support/cancella-azienda-di-prova'
import { mappaValida } from '../../../test-support/migrazione/mappa-di-prova'
import {
  scriviStagingAnagraficheProva,
  StagingAnagraficheProva,
} from '../../../test-support/migrazione/staging-anagrafiche-di-prova'
import { apriPacchetto, PacchettoAperto } from '../pacchetto/lettore-pacchetto'
import { validaMappa } from '../pacchetto/mappa-import'
import { preparaPacchetto } from '../pacchetto/prepara-pacchetto'
import { scriviPacchetto } from '../pacchetto/scrittore-pacchetto'
import { apriStaging } from '../staging/lettore-staging'
import { CaricaPacchettoService } from './carica-pacchetto.service'
import { LottiImportService } from './lotti-import.service'

describe('Pezzo I4 T3/T4/T5: carica anagrafiche — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
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
  let prova: StagingAnagraficheProva
  let contatore = 0
  const seme = 6_500_000 + (Date.now() % 100_000)

  async function azienda(): Promise<string> {
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: 'Carica anagrafiche SRL',
        country: 'IT',
      },
    })
    tenantCreati.push(t.id)
    return t.id
  }

  /** Pacchetto per `tenantId`; con `agganciata` la ditta della mappa esiste gia' nell'azienda. */
  async function pacchettoPer(
    tenantId: string,
    opzioni: { agganciata?: boolean; sovrascrivi?: Record<string, unknown> } = {}
  ): Promise<{ p: PacchettoAperto; dittaAgganciataId: string | null }> {
    const gia =
      opzioni.agganciata === false
        ? null
        : await owner.ditta.create({
            data: {
              tenantId,
              ragioneSociale: 'GIA PRESENTE',
              partitaIva: prova.piva.agganciata,
            },
          })
    const mappa = validaMappa({
      ...mappaValida(),
      tenantId,
      registri: [],
      unitaLocali: [],
      causali: [],
      agganci: gia ? [{ partitaIva: prova.piva.agganciata, dittaId: gia.id }] : [],
      ...opzioni.sovrascrivi,
    })
    const cartella = join(await mkdtemp(join(radice, 'pk-')), 'WW00012026')
    await preparaPacchetto(await apriStaging(prova.cartella), mappa, cartella)
    return { p: await apriPacchetto(cartella), dittaAgganciataId: gia?.id ?? null }
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
  const argomenti = (t: string, p: PacchettoAperto, ...altri: string[]) => [
    '--tenant',
    t,
    '--pacchetto',
    p.cartella,
    '--ambito',
    'ANAGRAFICHE',
    ...altri,
  ]

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new CaricaPacchettoService(app, new LottiImportService(app, logger), logger)
    radice = await mkdtemp(join(tmpdir(), 'carica-anag-'))
  })
  beforeEach(async () => {
    jest.clearAllMocks()
    contatore++
    prova = await scriviStagingAnagraficheProva(
      await mkdtemp(join(radice, 'st-')),
      seme * 10 + contatore * 11
    )
  })
  afterAll(async () => {
    await cancellaAziendeDiProva(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
    await rm(radice, { recursive: true, force: true })
  })

  it('carica ditte, sedi, ruoli e automezzi; la seconda volta salta tutto; conteggi esatti', async () => {
    const t = await azienda()
    const { p, dittaAgganciataId } = await pacchettoPer(t)
    const righe = Object.fromEntries(p.manifest.file.map(f => [f.fase, f.righe]))
    expect(righe).toEqual({
      ditte: 6,
      sedi: 9,
      produttori: 2,
      trasportatori: 1,
      destinatari: 1,
      automezzi: 3,
    })
    const totale = Object.values(righe).reduce((a, b) => a + b, 0)

    const primo = uscita()
    expect(await eseguiCli(argomenti(t, p), primo.u, servizio)).toBe(0)
    // il produttore sulla ditta agganciata e' nuovo (la ditta non aveva ruoli): entra
    expect(primo.out.join('\n')).toContain(`lette: ${totale}; inserite: ${totale}; saltate: 0`)
    const dove = { tenantId: t, importSource: 'WINWASTE' }
    expect(await owner.ditta.count({ where: dove })).toBe(6)
    expect(await owner.sedeDitta.count({ where: dove })).toBe(9)
    expect(await owner.produttore.count({ where: dove })).toBe(2)
    expect(await owner.trasportatore.count({ where: dove })).toBe(1)
    expect(await owner.destinatario.count({ where: dove })).toBe(1)
    expect(await owner.automezzo.count({ where: dove })).toBe(3)
    // la ditta preesistente non e' stata duplicata ne' toccata
    expect(await owner.ditta.count({ where: { tenantId: t } })).toBe(7)
    expect(
      (await owner.ditta.findUnique({ where: { id: dittaAgganciataId! } }))!.ragioneSociale
    ).toBe('GIA PRESENTE')

    const secondo = uscita()
    expect(await eseguiCli(argomenti(t, p), secondo.u, servizio)).toBe(0)
    expect(secondo.out.join('\n')).toContain(`lette: ${totale}; inserite: 0; saltate: ${totale}`)
    expect(await owner.sedeDitta.count({ where: dove })).toBe(9)
    expect(await owner.automezzo.count({ where: dove })).toBe(3)
    const lotti = await owner.lottoImport.findMany({ where: { tenantId: t } })
    expect(lotti.map(l => l.stato)).toEqual(['COMPLETATO', 'COMPLETATO'])

    // nessun valore dei record nei log, nelle uscite, nel lotto
    const tutto = JSON.stringify([primo, secondo, logger.info.mock.calls, logger.warn.mock.calls])
    for (const v of [
      'PRODUTTORE UNO',
      'VIA ROMA',
      'AB123CD',
      'NA/1234',
      prova.cfPrivato,
      prova.piva.uno,
    ])
      expect(tutto).not.toContain(v)
  })

  it('collegamenti: ruolo -> sede predefinita, automezzo -> trasportatore, ditta agganciata -> id esistente', async () => {
    const t = await azienda()
    const { p, dittaAgganciataId } = await pacchettoPer(t)
    expect(await eseguiCli(argomenti(t, p), uscita().u, servizio)).toBe(0)

    const sede = async (chiave: string) =>
      (await owner.sedeDitta.findFirst({ where: { tenantId: t, legacyKey: chiave } }))!
    const trasp = (await owner.trasportatore.findFirst({
      where: { tenantId: t, legacyKey: '0001|F|000002' },
    }))!
    expect(trasp.sedeId).toBe((await sede('0001|F|000002|SL')).id)
    expect(trasp.numeroIscrizione).toBe('NA/1234')
    expect(trasp.scadenzaIscrizione!.toISOString().slice(0, 10)).toBe('2028-12-31')
    const dest = (await owner.destinatario.findFirst({
      where: { tenantId: t, legacyKey: '0001|F|000003' },
    }))!
    expect(dest.numeroAutorizzazione).toBe('AUT-77')
    expect(dest.scadenzaAutorizzazione).toBeNull()

    const mezzo = (await owner.automezzo.findFirst({
      where: { tenantId: t, legacyKey: '0001|MEZ|000002.0001|0001' },
    }))!
    expect(mezzo).toMatchObject({
      targa: 'AB123CD',
      trasportatoreId: trasp.id,
      taraOrigine: 'DICHIARATA',
      attivo: true,
    })
    expect(Number(mezzo.taraKg)).toBe(7500)
    expect(mezzo.taraAggiornataIl).not.toBeNull()
    const proprio = (await owner.automezzo.findFirst({
      where: { tenantId: t, legacyKey: '0001|MEZ|X90001.0001|0004' },
    }))!
    expect(proprio.trasportatoreId).toBeNull()
    expect(proprio.taraKg).toBeNull()

    // ditta agganciata: sedi e ruolo sull'id esistente, nessuna sede principale in piu'
    const sedeAgg = await sede('0001|C|000006|SL')
    expect(sedeAgg.dittaId).toBe(dittaAgganciataId)
    expect(sedeAgg.principale).toBe(false)
    const prodAgg = (await owner.produttore.findFirst({
      where: { tenantId: t, legacyKey: '0001|C|000006' },
    }))!
    expect(prodAgg.dittaId).toBe(dittaAgganciataId)
    expect(prodAgg.sedeId).toBe(sedeAgg.id)
    // una principale per ditta nuova (indice parziale), come la sede legale
    expect((await sede('0001|C|000001|SL')).principale).toBe(true)
    expect((await sede('0001|C|000001|0001')).principale).toBe(false)
    // la ditta con due sedi legali/seconda
    expect(
      await owner.sedeDitta.count({
        where: { tenantId: t, legacyKey: { startsWith: '0001|F|000003|' } },
      })
    ).toBe(2)
  })

  it('una ditta agganciata che ha gia un ruolo: il ruolo non si duplica, il caricamento non fallisce', async () => {
    const t = await azienda()
    const { p, dittaAgganciataId } = await pacchettoPer(t)
    const sedeEsistente = await owner.sedeDitta.create({
      data: {
        tenantId: t,
        dittaId: dittaAgganciataId!,
        via: 'Via Vecchia',
        civico: '1',
        cap: '00100',
        comune: 'Roma',
        provincia: 'RM',
        principale: true,
      },
    })
    const esistente = await owner.produttore.create({
      data: { tenantId: t, dittaId: dittaAgganciataId!, sedeId: sedeEsistente.id },
    })
    const u = uscita()
    expect(await eseguiCli(argomenti(t, p), u.u, servizio)).toBe(0)
    const produttoriDitta = await owner.produttore.findMany({
      where: { tenantId: t, dittaId: dittaAgganciataId! },
    })
    expect(produttoriDitta.map(x => x.id)).toEqual([esistente.id])
    // la riga saltata e' contata come tale
    expect(u.out.join('\n')).toMatch(/saltate: 1/)
  })

  it('un altra azienda non vede nulla di cio che e stato importato (RLS)', async () => {
    const a = await azienda()
    const b = await azienda()
    const { p } = await pacchettoPer(a)
    expect(await eseguiCli(argomenti(a, p), uscita().u, servizio)).toBe(0)
    const viste = await TenantContext.run({ tenantId: b }, () =>
      app.$transaction(async tx => ({
        sedi: await tx.sedeDitta.count(),
        ruoli: (await tx.produttore.count()) + (await tx.trasportatore.count()),
        mezzi: await tx.automezzo.count(),
      }))
    )
    expect(viste).toEqual({ sedi: 0, ruoli: 0, mezzi: 0 })
  })

  describe('--verifica', () => {
    it('su un pacchetto buono: nessun bloccante, conteggi per fase, tenant con le ditte della mappa', async () => {
      const t = await azienda()
      const { p } = await pacchettoPer(t)
      const u = uscita()
      expect(await eseguiCli(argomenti(t, p, '--verifica'), u.u, servizio)).toBe(0)
      const o = u.out.join('\n')
      for (const f of ['ditte', 'sedi', 'produttori', 'trasportatori', 'destinatari', 'automezzi'])
        expect(o).toContain(`righe.${f}:`)
      expect(o).toContain('verifica: nessun bloccante')
      expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)
    })

    it('T3: un tenant inesistente e un bloccante (nessuna creazione automatica di tenant)', async () => {
      const fantasma = '44444444-4444-4444-8444-444444444444'
      const mappaFantasma = validaMappa({
        ...mappaValida(),
        tenantId: fantasma,
        registri: [],
        unitaLocali: [],
        causali: [],
        agganci: [],
      })
      const cartella = join(await mkdtemp(join(radice, 'pk-')), 'WW00012026')
      await preparaPacchetto(await apriStaging(prova.cartella), mappaFantasma, cartella)
      const pf = await apriPacchetto(cartella)
      const u = uscita()
      expect(await eseguiCli(argomenti(fantasma, pf, '--verifica'), u.u, servizio)).toBe(2)
      expect(u.err.join('\n')).toContain('BLOCCANTE TENANT_INESISTENTE: 1')
      expect(await eseguiCli(argomenti(fantasma, pf), uscita().u, servizio)).toBe(2)
      expect(await owner.tenant.count({ where: { id: fantasma } })).toBe(0)
      expect(await owner.lottoImport.count({ where: { tenantId: fantasma } })).toBe(0)
    })

    it('targa gia presente e non importata, ditta con P.IVA non agganciata: bloccanti, uscita 2, nessun lotto', async () => {
      const t = await azienda()
      await owner.automezzo.create({
        data: { tenantId: t, targa: 'AB123CD', creatoDa: '11111111-1111-4111-8111-111111111111' },
      })
      const { p } = await pacchettoPer(t, { agganciata: false })
      // la P.IVA della ditta «agganciabile» e gia in azienda ma la mappa non la aggancia
      await owner.ditta.create({
        data: { tenantId: t, ragioneSociale: 'OCCUPA', partitaIva: prova.piva.agganciata },
      })
      const u = uscita()
      expect(await eseguiCli(argomenti(t, p, '--verifica'), u.u, servizio)).toBe(2)
      const err = u.err.join('\n')
      expect(err).toContain('BLOCCANTE TARGA_GIA_PRESENTE_NON_IMPORTATA: 1')
      expect(err).toContain('BLOCCANTE PARTITA_IVA_GIA_PRESENTE_NON_AGGANCIATA: 1')
      expect(err).not.toContain('AB123CD')
      expect(await eseguiCli(argomenti(t, p), uscita().u, servizio)).toBe(2)
      expect(await owner.lottoImport.count({ where: { tenantId: t } })).toBe(0)
    })

    it('dopo il caricamento le targhe importate non sono una collisione (idempotenza della verifica)', async () => {
      const t = await azienda()
      const { p } = await pacchettoPer(t)
      expect(await eseguiCli(argomenti(t, p), uscita().u, servizio)).toBe(0)
      const u = uscita()
      expect(await eseguiCli(argomenti(t, p, '--verifica'), u.u, servizio)).toBe(0)
      expect(u.out.join('\n')).toContain('gia_caricate.automezzi: 3')
    })
  })

  it('un riferimento a una ditta che non esiste fa fallire il blocco (lotto FALLITO), senza valori nell errore', async () => {
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
      hashStaging: 'e'.repeat(64),
      mappa,
      fasi: [
        {
          ambito: 'ANAGRAFICHE',
          fase: 'sedi',
          record: [
            {
              legacyKey: '0001|C|000001|SL',
              dittaKey: '0001|FISC|00000000000',
              dittaId: null,
              denominazione: null,
              via: 'VIA SEGRETA',
              civico: '1',
              cap: '80100',
              comune: 'NAPOLI',
              provincia: 'NA',
              telefono: null,
              principale: true,
            },
          ],
        },
      ],
    })
    const pk = await apriPacchetto(cartella)
    const u = uscita()
    expect(await eseguiCli(argomenti(t, pk), u.u, servizio)).toBe(1)
    const l = await owner.lottoImport.findFirst({ where: { tenantId: t } })
    expect(l!.stato).toBe('FALLITO')
    expect(JSON.stringify([u, l!.errore])).not.toContain('SEGRETA')
    expect(await owner.sedeDitta.count({ where: { tenantId: t } })).toBe(0)
  })

  it('un pacchetto di sole ditte (formato I2) si carica ancora', async () => {
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
      hashStaging: 'f'.repeat(64),
      mappa,
      fasi: [
        {
          ambito: 'ANAGRAFICHE',
          fase: 'ditte',
          record: [
            {
              legacyKey: `0001|FISC|${prova.piva.uno}`,
              ragioneSociale: 'SOLO DITTA',
              partitaIva: prova.piva.uno,
              codiceFiscale: null,
            },
          ],
        },
      ],
    })
    const pk = await apriPacchetto(cartella)
    expect(await eseguiCli(argomenti(t, pk), uscita().u, servizio)).toBe(0)
    expect(await owner.ditta.count({ where: { tenantId: t } })).toBe(1)
  })
})
