/**
 * Pezzo I5, T1-T3: caricamento dei FIR contro Postgres reale COME `wasteflow_app`. Pacchetto
 * sintetico preparato dallo staging di prova (FIXTURE SINTETICHE: nessun `.bak`). Prima si carica
 * ANAGRAFICHE, poi FIR (sedi e ditte si risolvono per chiave legacy).
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
import { StagingAnagraficheProva } from '../../../test-support/migrazione/staging-anagrafiche-di-prova'
import {
  CASI_FIR,
  CasoFir,
  scriviStagingFirProva,
} from '../../../test-support/migrazione/staging-fir-di-prova'
import { apriPacchetto, PacchettoAperto } from '../pacchetto/lettore-pacchetto'
import { validaMappa } from '../pacchetto/mappa-import'
import { preparaPacchetto } from '../pacchetto/prepara-pacchetto'
import { apriStaging } from '../staging/lettore-staging'
import { CaricaPacchettoService } from './carica-pacchetto.service'
import { MOTIVO_BLOCCO_FIR_IMPORTATO } from './inserisci-fir'
import { LottiImportService } from './lotti-import.service'

/** Senza il FIR 10 (stesso numero del 1): e' il caso della collisione, provato a parte. */
const CASI_CARICABILI = CASI_FIR.filter(c => c.cod !== 10)
/** FIR cartacei che il pacchetto deve contenere: 1, 2, 3, 12, 13, 15. */
const ATTESI = 6

describe('Pezzo I5 T1-T3: carica FIR — Postgres reale, ruolo wasteflow_app', () => {
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
  const seme = 6_700_000 + (Date.now() % 100_000)

  interface Az {
    tenantId: string
    operatoreId: string
    sedePropriaId: string
    dittaAgganciataId: string
  }

  async function azienda(): Promise<Az> {
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Carica FIR SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    contatore++
    const u = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `kc-fir-i5-${seme}-${contatore}`,
        fiscalCode: `FIRI5${seme}${contatore}`.slice(0, 16),
        firstName: 'Operatore',
        lastName: 'Import',
        email: `fir-i5-${seme}-${contatore}@example.test`,
      },
    })
    const propria = await owner.ditta.create({
      data: {
        tenantId: t.id,
        ragioneSociale: 'AZIENDA PROPRIA SRL',
        partitaIva: partitaIvaUnica(),
      },
    })
    const sede = await owner.sedeDitta.create({
      data: {
        tenantId: t.id,
        dittaId: propria.id,
        via: 'Via Propria',
        civico: '7',
        cap: '80100',
        comune: 'Napoli',
        provincia: 'NA',
        principale: true,
      },
    })
    const agg = await owner.ditta.create({
      data: { tenantId: t.id, ragioneSociale: 'GIA PRESENTE', partitaIva: prova.piva.agganciata },
    })
    return {
      tenantId: t.id,
      operatoreId: u.id,
      sedePropriaId: sede.id,
      dittaAgganciataId: agg.id,
    }
  }

  async function pacchettoPer(az: Az, st: StagingAnagraficheProva): Promise<PacchettoAperto> {
    const mappa = validaMappa({
      ...mappaValida(),
      tenantId: az.tenantId,
      registri: [],
      unitaLocali: [{ legacy: 'X1.0001', sedeId: az.sedePropriaId, unitaLocaleId: null }],
      causali: [],
      agganci: [{ partitaIva: st.piva.agganciata, dittaId: az.dittaAgganciataId }],
    })
    const cartella = join(await mkdtemp(join(radice, 'pk-')), 'WW00012026')
    await preparaPacchetto(await apriStaging(st.cartella), mappa, cartella)
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
  const argomenti = (az: Az, p: PacchettoAperto, ambito: string, ...altri: string[]): string[] => [
    '--tenant',
    az.tenantId,
    '--pacchetto',
    p.cartella,
    '--ambito',
    ambito,
    ...altri,
  ]
  const conOperatore = (az: Az) => ['--operatore', az.operatoreId]

  async function caricaTutto(az: Az, p: PacchettoAperto) {
    expect(await eseguiCli(argomenti(az, p, 'ANAGRAFICHE'), uscita().u, servizio)).toBe(0)
    const u = uscita()
    expect(await eseguiCli(argomenti(az, p, 'FIR', ...conOperatore(az)), u.u, servizio)).toBe(0)
    return u
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new CaricaPacchettoService(app, new LottiImportService(app, logger), logger)
    radice = await mkdtemp(join(tmpdir(), 'carica-fir-'))
  })
  beforeEach(() => {
    jest.clearAllMocks()
    contatore++
  })
  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.fIR.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    }
    await cancellaAziendeDiProva(owner, tenantCreati)
    await app.onModuleDestroy()
    await owner.$disconnect()
    await rm(radice, { recursive: true, force: true })
  })

  // `prova` serve ad azienda() per la P.IVA della ditta agganciata: la si prepara prima.
  async function nuova(casi: readonly CasoFir[] = CASI_CARICABILI) {
    prova = await scriviStagingFirProva(
      await mkdtemp(join(radice, 'st0-')),
      seme * 10 + contatore,
      {
        casi,
      }
    )
    const az = await azienda()
    const p = await pacchettoPer(az, prova)
    return { az, p }
  }

  it('carica i FIR cartacei bloccati all invio; la seconda volta salta tutto; i digitali non entrano', async () => {
    const { az, p } = await nuova()
    expect(
      p.manifest.file.filter(f => f.ambito === 'FIR').map(f => `${f.fase}:${f.righe}`)
    ).toEqual([`fir:${ATTESI}`, 'fir-digitali:2'])
    const primo = await caricaTutto(az, p)
    expect(primo.out.join('\n')).toContain(`lette: ${ATTESI}; inserite: ${ATTESI}; saltate: 0`)
    const dove = { tenantId: az.tenantId, importSource: 'WINWASTE' }
    expect(await owner.fIR.count({ where: dove })).toBe(ATTESI)
    // i digitali non sono nel database
    expect(
      await owner.fIR.count({
        where: { tenantId: az.tenantId, firNumber: { in: ['ABCDE1234567', 'FGHIJ7654321'] } },
      })
    ).toBe(0)

    const secondo = uscita()
    expect(await eseguiCli(argomenti(az, p, 'FIR', ...conOperatore(az)), secondo.u, servizio)).toBe(
      0
    )
    expect(secondo.out.join('\n')).toContain(`lette: ${ATTESI}; inserite: 0; saltate: ${ATTESI}`)
    expect(await owner.fIR.count({ where: dove })).toBe(ATTESI)
    const lotti = await owner.lottoImport.findMany({
      where: { tenantId: az.tenantId, ambito: 'FIR' },
    })
    expect(lotti.map(l => l.stato)).toEqual(['COMPLETATO', 'COMPLETATO'])

    // nessun valore dei record nei log e nelle uscite
    const tutto = JSON.stringify([primo, secondo, logger.info.mock.calls, logger.warn.mock.calls])
    for (const v of ['PRODUTTORE UNO', 'VIA ROMA', 'AB123CD', 'IMBALLAGGI', prova.piva.uno])
      expect(tutto).not.toContain(v)
  })

  it('ogni FIR importato nasce bloccato all invio, senza legame RENTRI, con numero e provenienza', async () => {
    const { az, p } = await nuova()
    await caricaTutto(az, p)
    const firs = await owner.fIR.findMany({
      where: { tenantId: az.tenantId, importSource: 'WINWASTE' },
      orderBy: { legacyKey: 'asc' },
    })
    expect(firs).toHaveLength(ATTESI)
    for (const f of firs) {
      expect(f).toMatchObject({
        bloccatoInvio: true,
        motivoBloccoInvio: MOTIVO_BLOCCO_FIR_IMPORTATO,
        rentriNumeroFir: null,
        rentriSyncStatus: 'PENDING',
        producerUserId: az.operatoreId,
        unit: 'kg',
      })
      expect(f.lottoImportId).not.toBeNull()
      expect(f.legacyKey).toMatch(/^0001\|2026\|FORMULARI\|\d+$/)
    }
    // FORMU importato com'e'
    expect(firs.map(f => f.firNumber).sort()).toEqual(
      ['A0001/26', 'A0002/26', 'A0003/26', 'A0012/26', 'A0013/26', 'A0015/26'].sort()
    )
  })

  it('campi: stato dedotto, data, CER, quantita, targa, snapshot di produttore/trasportatore/destinatario', async () => {
    const { az, p } = await nuova()
    await caricaTutto(az, p)
    const per = async (cod: number) =>
      (await owner.fIR.findFirst({
        where: { tenantId: az.tenantId, legacyKey: `0001|2026|FORMULARI|${cod}` },
      }))!
    const f1 = await per(1)
    expect(f1).toMatchObject({
      status: 'AWAITING_RECEIVER',
      cerCode: '15 01 01',
      wasteCategory: 'Non pericoloso',
      wasteDescription: 'IMBALLAGGI MISTI',
      carrierVehiclePlate: 'AB123CD',
      wasteOperationType: 'DISPOSAL',
      producerName: 'PRODUTTORE UNO SRL',
      producerPartitaIva: prova.piva.uno,
      carrierName: 'TRASPORTI DUE SRL',
      receiverName: 'AZIENDA PROPRIA SRL',
      receiverAddress: 'Via Propria 7, 80100 Napoli (NA)',
      receiverSedeId: az.sedePropriaId,
      completedAt: null,
    })
    expect(Number(f1.quantity)).toBe(1200)
    expect(f1.transportDate.toISOString()).toBe('2026-03-05T00:00:00.000Z')
    expect(f1.producerAddress).toBe('VIA UL 3, 80100 NAPOLI (NA)')
    expect(f1.producerId).not.toBeNull()
    expect(f1.carrierId).not.toBeNull()
    expect(f1.receiverId).toBeNull() // sito proprio: nessun ruolo destinatario
    const f2 = await per(2)
    expect(f2.status).toBe('COMPLETED')
    expect(f2.completedAt!.toISOString().slice(0, 10)).toBe('2026-03-06')
    const f13 = await per(13)
    expect(f13).toMatchObject({ cerCode: '13 02 05*', wasteCategory: 'Pericoloso' })
    expect(f13.producerName).toBe('GIA PRESENTE') // ditta agganciata: lo snapshot e' quello esistente
    expect((await per(15)).wasteOperationType).toBe('RECOVERY')
    const f12 = await per(12)
    expect(f12.carrierName).toBe('')
    expect(f12.carrierId).toBeNull()
  })

  it('un altra azienda non vede nessun FIR importato (RLS)', async () => {
    const { az, p } = await nuova()
    await caricaTutto(az, p)
    const altra = await azienda()
    const viste = await TenantContext.run({ tenantId: altra.tenantId }, () =>
      app.$transaction(async tx => tx.fIR.count())
    )
    expect(viste).toBe(0)
  })

  describe('--verifica', () => {
    it('su un pacchetto buono dopo ANAGRAFICHE: nessun bloccante, conteggi, nessun lotto FIR', async () => {
      const { az, p } = await nuova()
      expect(await eseguiCli(argomenti(az, p, 'ANAGRAFICHE'), uscita().u, servizio)).toBe(0)
      const u = uscita()
      expect(
        await eseguiCli(argomenti(az, p, 'FIR', ...conOperatore(az), '--verifica'), u.u, servizio)
      ).toBe(0)
      expect(u.out.join('\n')).toContain(`righe.fir: ${ATTESI}`)
      expect(u.out.join('\n')).toContain('verifica: nessun bloccante')
      expect(
        await owner.lottoImport.count({ where: { tenantId: az.tenantId, ambito: 'FIR' } })
      ).toBe(0)
    })

    it('T2: stesso firNumber nel pacchetto: bloccante, mai rinominato, nessun lotto', async () => {
      const { az, p } = await nuova(CASI_FIR)
      expect(await eseguiCli(argomenti(az, p, 'ANAGRAFICHE'), uscita().u, servizio)).toBe(0)
      const u = uscita()
      expect(
        await eseguiCli(argomenti(az, p, 'FIR', ...conOperatore(az), '--verifica'), u.u, servizio)
      ).toBe(2)
      expect(u.err.join('\n')).toContain('BLOCCANTE FIR_NUMBER_DUPLICATO_NEL_PACCHETTO: 1')
      expect(
        await eseguiCli(argomenti(az, p, 'FIR', ...conOperatore(az)), uscita().u, servizio)
      ).toBe(2)
      expect(await owner.fIR.count({ where: { tenantId: az.tenantId } })).toBe(0)
      expect(
        await owner.lottoImport.count({ where: { tenantId: az.tenantId, ambito: 'FIR' } })
      ).toBe(0)
    })

    it('T2: un FIR dell azienda con lo stesso numero (non importato): bloccante, il FIR esistente non si tocca', async () => {
      const { az, p } = await nuova()
      expect(await eseguiCli(argomenti(az, p, 'ANAGRAFICHE'), uscita().u, servizio)).toBe(0)
      const esistente = await owner.fIR.create({
        data: {
          tenantId: az.tenantId,
          producerUserId: az.operatoreId,
          producerPartitaIva: '00000000000',
          producerName: 'ESISTENTE',
          producerAddress: 'Via 1',
          carrierPartitaIva: '00000000001',
          carrierName: 'T',
          carrierVehiclePlate: 'AA111AA',
          receiverPartitaIva: '00000000002',
          receiverName: 'D',
          receiverAddress: 'Via 2',
          cerCode: '15 01 01',
          wasteDescription: 'x',
          wasteCategory: 'Non pericoloso',
          quantity: 1,
          transportDate: new Date('2026-01-01T00:00:00Z'),
          firNumber: 'A0002/26',
          status: 'DRAFT',
        },
      })
      const u = uscita()
      expect(
        await eseguiCli(argomenti(az, p, 'FIR', ...conOperatore(az), '--verifica'), u.u, servizio)
      ).toBe(2)
      expect(u.err.join('\n')).toContain('BLOCCANTE FIR_NUMBER_GIA_PRESENTE: 1')
      expect(
        await eseguiCli(argomenti(az, p, 'FIR', ...conOperatore(az)), uscita().u, servizio)
      ).toBe(2)
      expect(await owner.fIR.count({ where: { tenantId: az.tenantId } })).toBe(1)
      expect((await owner.fIR.findUnique({ where: { id: esistente.id } }))!.firNumber).toBe(
        'A0002/26'
      )
      expect(
        await owner.lottoImport.count({ where: { tenantId: az.tenantId, ambito: 'FIR' } })
      ).toBe(0)
    })

    it('dopo il caricamento i numeri importati non sono una collisione (la verifica e idempotente)', async () => {
      const { az, p } = await nuova()
      await caricaTutto(az, p)
      const u = uscita()
      expect(
        await eseguiCli(argomenti(az, p, 'FIR', ...conOperatore(az), '--verifica'), u.u, servizio)
      ).toBe(0)
      expect(u.out.join('\n')).toContain(`gia_caricate.fir: ${ATTESI}`)
    })

    it('ANAGRAFICHE non ancora caricate: ditte e sedi non trovate, bloccante', async () => {
      const { az, p } = await nuova()
      const u = uscita()
      expect(
        await eseguiCli(argomenti(az, p, 'FIR', ...conOperatore(az), '--verifica'), u.u, servizio)
      ).toBe(2)
      const err = u.err.join('\n')
      expect(err).toContain('BLOCCANTE RIFERIMENTO_DITTA_NON_CARICATO')
      expect(err).toContain('BLOCCANTE RIFERIMENTO_SEDE_NON_CARICATO')
    })

    it('operatore: senza --operatore o con un utente di un altra azienda e bloccante', async () => {
      const { az, p } = await nuova()
      expect(await eseguiCli(argomenti(az, p, 'ANAGRAFICHE'), uscita().u, servizio)).toBe(0)
      const senza = uscita()
      expect(await eseguiCli(argomenti(az, p, 'FIR', '--verifica'), senza.u, servizio)).toBe(2)
      expect(senza.err.join('\n')).toContain('BLOCCANTE OPERATORE_ASSENTE: 1')
      const altra = await azienda()
      const estraneo = uscita()
      expect(
        await eseguiCli(
          argomenti(az, p, 'FIR', '--operatore', altra.operatoreId, '--verifica'),
          estraneo.u,
          servizio
        )
      ).toBe(2)
      expect(estraneo.err.join('\n')).toContain('BLOCCANTE OPERATORE_INESISTENTE: 1')
      expect(await eseguiCli(argomenti(az, p, 'FIR'), uscita().u, servizio)).toBe(2)
      expect(await owner.fIR.count({ where: { tenantId: az.tenantId } })).toBe(0)
    })
  })

  it('un pacchetto senza FIR: ambito non caricabile (uscita 2), nessun lotto; ANAGRAFICHE si carica', async () => {
    const { az, p } = await nuova([])
    expect(p.manifest.file.some(f => f.ambito === 'FIR')).toBe(false)
    expect(await eseguiCli(argomenti(az, p, 'ANAGRAFICHE'), uscita().u, servizio)).toBe(0)
    expect(
      await eseguiCli(argomenti(az, p, 'FIR', ...conOperatore(az)), uscita().u, servizio)
    ).toBe(2)
    expect(await owner.lottoImport.count({ where: { tenantId: az.tenantId, ambito: 'FIR' } })).toBe(
      0
    )
  })
})
