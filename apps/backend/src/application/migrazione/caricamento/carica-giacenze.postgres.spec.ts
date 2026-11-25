/**
 * Pezzo I6, T2-T4: giacenze iniziali al taglio contro Postgres reale COME `wasteflow_app`. Pacchetto
 * sintetico preparato dallo staging di prova (FIXTURE SINTETICHE: nessun `.bak`). Prove: caricamento e
 * provenienza, idempotenza, una giacenza manuale gia' presente fa fallire il blocco (mai sovrascritta),
 * bloccanti di `--verifica`, e T4: lo scarico successivo vede la giacenza importata e il MUD non la conta
 * come prodotta o ricevuta.
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
import { scriviStagingGiacenzeProva } from '../../../test-support/migrazione/staging-giacenze-di-prova'
import { RegistraMovimentoCommand } from '../../registro/commands/registra-movimento.command'
import { RegistriService } from '../../registro/registri.service'
import { RegistraMovimentoUseCase } from '../../registro/use-cases/registra-movimento.use-case'
import { MudAggregazioneService } from '../../mud/aggregazione/mud-aggregazione.service'
import { limitiAnnoMud } from '../../mud/aggregazione/mud-regole'
import { apriPacchetto, PacchettoAperto } from '../pacchetto/lettore-pacchetto'
import { validaMappa } from '../pacchetto/mappa-import'
import { preparaPacchetto } from '../pacchetto/prepara-pacchetto'
import { validaRecordGiacenza } from '../pacchetto/record-giacenze'
import { apriStaging } from '../staging/lettore-staging'
import { caricaAmbito, FaseCaricamentoFallitaError } from './carica-ambito'
import { CaricaPacchettoService } from './carica-pacchetto.service'
import { inserisciGiacenze, NOTA_GIACENZA_IMPORTATA } from './inserisci-giacenze'
import { LottiImportService } from './lotti-import.service'

const CER_CATALOGO = ['15 01 01', '20 03 01', '13 02 05*', '15 01 02']

describe('Pezzo I6 T2-T4: giacenze iniziali al taglio — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: CaricaPacchettoService
  let lotti: LottiImportService
  const logger: any = {
    setContext: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }
  const tenantCreati: string[] = []
  const cerCreati: string[] = []
  let radice: string
  let contatore = 0
  const seme = 6_950_000 + (Date.now() % 40_000)

  interface Az {
    tenantId: string
    operatoreId: string
    registroA: string
    registroB: string
  }

  async function azienda(): Promise<Az> {
    contatore++
    const t = await owner.tenant.create({
      data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Giacenze I6 SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    const u = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `kc-giac-i6-${seme}-${contatore}`,
        fiscalCode: `GIAI6${seme}${contatore}`.slice(0, 16),
        firstName: 'Operatore',
        lastName: 'Import',
        email: `giac-i6-${seme}-${contatore}@example.test`,
      },
    })
    const a = await owner.registroRifiuti.create({
      data: { tenantId: t.id, descrizione: 'Registro A' },
    })
    const b = await owner.registroRifiuti.create({
      data: { tenantId: t.id, descrizione: 'Registro B', codice: 'ALTRO_REGISTRO' },
    })
    return { tenantId: t.id, operatoreId: u.id, registroA: a.id, registroB: b.id }
  }

  async function pacchettoPer(
    az: Az,
    opzioni: Parameters<typeof scriviStagingGiacenzeProva>[2] = {}
  ): Promise<PacchettoAperto> {
    const st = await scriviStagingGiacenzeProva(
      await mkdtemp(join(radice, 'st-')),
      seme * 10 + contatore,
      opzioni
    )
    const mappa = validaMappa({
      ...mappaValida(),
      tenantId: az.tenantId,
      registri: [
        { legacy: 'REG1', registroId: az.registroA },
        { legacy: '001', registroId: az.registroA },
        { legacy: '002', registroId: az.registroB },
      ],
      unitaLocali: [],
      causali: [],
      agganci: [],
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
  const argomenti = (az: Az, p: PacchettoAperto, ...altri: string[]): string[] => [
    '--tenant',
    az.tenantId,
    '--pacchetto',
    p.cartella,
    '--ambito',
    'GIACENZE',
    ...altri,
  ]
  const conOperatore = (az: Az) => ['--operatore', az.operatoreId]
  const righeDi = (az: Az) =>
    owner.giacenzaIniziale.findMany({
      where: { tenantId: az.tenantId },
      orderBy: [{ registroId: 'asc' }, { cerCode: 'asc' }],
    })
  const per = async (az: Az, registroId: string, cerCode: string) =>
    (await owner.giacenzaIniziale.findFirst({
      where: { tenantId: az.tenantId, registroId, cerCode },
    }))!

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    lotti = new LottiImportService(app, logger)
    servizio = new CaricaPacchettoService(app, lotti, logger)
    radice = await mkdtemp(join(tmpdir(), 'carica-giac-'))
    for (const code of CER_CATALOGO) {
      if ((await owner.cERCode.count({ where: { code } })) === 0) cerCreati.push(code)
      await owner.cERCode.upsert({
        where: { code },
        create: { code, description: 'CER di test', category: '99', subcategory: '' },
        update: {},
      })
    }
  })
  beforeEach(() => jest.clearAllMocks())
  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.giacenzaIniziale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    }
    await cancellaAziendeDiProva(owner, tenantCreati)
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
    await rm(radice, { recursive: true, force: true })
  })

  it('carica le giacenze con provenienza, origini e data di taglio; la seconda volta salta tutto', async () => {
    const az = await azienda()
    const p = await pacchettoPer(az)
    expect(
      p.manifest.file.filter(f => f.ambito === 'GIACENZE').map(f => `${f.fase}:${f.righe}`)
    ).toEqual(['giacenze:4'])
    const primo = uscita()
    expect(await eseguiCli(argomenti(az, p, ...conOperatore(az)), primo.u, servizio)).toBe(0)
    expect(primo.out.join('\n')).toContain('lette: 4; inserite: 4; saltate: 0')

    const righe = await righeDi(az)
    expect(righe).toHaveLength(4)
    for (const r of righe) {
      expect(r).toMatchObject({
        provenienza: 'IMPORTAZIONE',
        importSource: 'WINWASTE',
        unita: 'KG',
        impostatoDa: az.operatoreId,
        note: NOTA_GIACENZA_IMPORTATA,
      })
      expect(r.lottoImportId).not.toBeNull()
      expect(r.dataRiferimento.toISOString().slice(0, 10)).toBe('2026-06-30')
      expect(r.legacyKey).toMatch(/^0001\|2026\|GIACENZE\|[0-9a-f-]{36}\|\d{6}\|-$/)
    }
    const a1 = await per(az, az.registroA, '15 01 01')
    expect(Number(a1.quantita)).toBe(720)
    expect(a1.origini).toEqual([{ anno: 2026, protocollo: 12, quantita: 600 }])
    expect(Number((await per(az, az.registroA, '13 02 05*')).quantita)).toBe(100)
    expect(Number((await per(az, az.registroA, '20 03 01')).quantita)).toBe(300)
    expect(Number((await per(az, az.registroB, '15 01 02')).quantita)).toBe(80)

    const secondo = uscita()
    expect(await eseguiCli(argomenti(az, p, ...conOperatore(az)), secondo.u, servizio)).toBe(0)
    expect(secondo.out.join('\n')).toContain('lette: 4; inserite: 0; saltate: 4')
    expect(await righeDi(az)).toHaveLength(4)
    const lotto = await owner.lottoImport.findMany({
      where: { tenantId: az.tenantId, ambito: 'GIACENZE' },
    })
    expect(lotto.map(l => l.stato)).toEqual(['COMPLETATO', 'COMPLETATO'])

    // nessun valore dei record nei log e nelle uscite
    const tutto = JSON.stringify([primo, secondo, logger.info.mock.calls, logger.warn.mock.calls])
    for (const v of ['720', '600', '13 02 05']) expect(tutto).not.toContain(v)
  })

  it('--verifica e di sola lettura e senza operatore e un bloccante', async () => {
    const az = await azienda()
    const p = await pacchettoPer(az)
    const u = uscita()
    expect(await eseguiCli(argomenti(az, p, '--verifica'), u.u, servizio)).toBe(2)
    expect(u.err.join('\n')).toContain('BLOCCANTE OPERATORE_ASSENTE')
    const v = uscita()
    expect(
      await eseguiCli(argomenti(az, p, '--verifica', ...conOperatore(az)), v.u, servizio)
    ).toBe(0)
    expect(v.out.join('\n')).toContain('righe.giacenze: 4')
    expect(await righeDi(az)).toHaveLength(0)
    expect(await owner.lottoImport.count({ where: { tenantId: az.tenantId } })).toBe(0)
  })

  it('una giacenza MANUALE sulla stessa famiglia e bloccante in --verifica e non si sovrascrive', async () => {
    const az = await azienda()
    const p = await pacchettoPer(az)
    // manuale in T (tonnellate): kg e t sono la stessa famiglia
    const manuale = await owner.giacenzaIniziale.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroA,
        cerCode: '15 01 01',
        quantita: 3,
        unita: 'T',
        dataRiferimento: new Date('2026-01-01T00:00:00Z'),
        impostatoDa: az.operatoreId,
      },
    })
    const u = uscita()
    expect(await eseguiCli(argomenti(az, p, ...conOperatore(az)), u.u, servizio)).toBe(2)
    expect(u.err.join('\n')).toContain('BLOCCANTE GIACENZA_GIA_PRESENTE_NON_IMPORTATA: 1')
    expect(await righeDi(az)).toHaveLength(1)
    expect(await owner.lottoImport.count({ where: { tenantId: az.tenantId } })).toBe(0)

    // Anche saltando la verifica (motore a blocchi diretto) il blocco FALLISCE: nessuna riga scritta,
    // la manuale resta com'e', il lotto e' FALLITO e la causa non porta valori.
    const pacchetto = p
    const righe: unknown[] = []
    for await (const { record } of pacchetto.leggi('GIACENZE', 'giacenze')) {
      righe.push(validaRecordGiacenza(record, pacchetto.mappa))
    }
    await expect(
      caricaAmbito(
        { prisma: app, lotti, logger },
        az.tenantId,
        {
          importSource: 'WINWASTE',
          archivio: 'WW00012026',
          ambito: 'GIACENZE',
          formatoStaging: 'wasteflow-pacchetto/1',
          hashStaging: pacchetto.hashManifest,
          avviatoDa: az.operatoreId,
        },
        [
          {
            nome: 'giacenze',
            righe: async () => righe,
            opzioni: { inserisciBlocco: inserisciGiacenze },
          },
        ]
      )
    ).rejects.toBeInstanceOf(FaseCaricamentoFallitaError)
    const dopo = await righeDi(az)
    expect(dopo).toHaveLength(1)
    expect(dopo[0]).toMatchObject({ id: manuale.id, unita: 'T', provenienza: 'MANUALE' })
    expect(Number(dopo[0].quantita)).toBe(3)
    const lotto = await owner.lottoImport.findFirstOrThrow({ where: { tenantId: az.tenantId } })
    expect(lotto.stato).toBe('FALLITO')
    expect(lotto.errore).toContain('giacenza iniziale non importata')
  })

  it('una giacenza manuale su un altra famiglia non blocca', async () => {
    const az = await azienda()
    const p = await pacchettoPer(az)
    await owner.giacenzaIniziale.create({
      data: {
        tenantId: az.tenantId,
        registroId: az.registroB,
        cerCode: '15 01 01',
        quantita: 9,
        unita: 'KG',
        dataRiferimento: new Date('2026-01-01T00:00:00Z'),
        impostatoDa: az.operatoreId,
      },
    })
    expect(await eseguiCli(argomenti(az, p, ...conOperatore(az)), uscita().u, servizio)).toBe(0)
    expect(await righeDi(az)).toHaveLength(5)
  })

  it('CER fuori catalogo: bloccante in --verifica', async () => {
    const az = await azienda()
    const p = await pacchettoPer(az)
    await owner.cERCode.deleteMany({ where: { code: '15 01 02' } })
    try {
      const u = uscita()
      expect(await eseguiCli(argomenti(az, p, ...conOperatore(az)), u.u, servizio)).toBe(2)
      expect(u.err.join('\n')).toContain('BLOCCANTE CER_NON_IN_CATALOGO: 1')
    } finally {
      await owner.cERCode.upsert({
        where: { code: '15 01 02' },
        create: { code: '15 01 02', description: 'CER di test', category: '99', subcategory: '' },
        update: {},
      })
    }
  })

  it('un registro della mappa inesistente nell azienda e un bloccante', async () => {
    const az = await azienda()
    const altra = await azienda()
    const p = await pacchettoPer({ ...az, registroA: altra.registroA })
    const u = uscita()
    // il pacchetto e preparato col registro di un'altra azienda: la verifica lo rifiuta
    expect(await eseguiCli(argomenti(az, p, ...conOperatore(az)), u.u, servizio)).toBe(2)
    expect(u.err.join('\n')).toMatch(/BLOCCANTE (REGISTRO_INESISTENTE|TENANT_DIVERSO)/)
  })

  describe('T4: scarico successivo e MUD', () => {
    const registratore = () =>
      new RegistraMovimentoUseCase(app, logger, new RegistriService(app, logger))
    const scarico = (az: Az, registroId: string, kg: number, cer: string) => {
      const adesso = new Date()
      return TenantContext.run({ tenantId: az.tenantId }, async () =>
        registratore().execute(
          new RegistraMovimentoCommand(
            az.tenantId,
            undefined as unknown as string,
            'SCARICO',
            adesso,
            adesso,
            'CONFERIMENTO_TRASPORTATORE',
            cer,
            undefined,
            kg,
            'KG',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            registroId
          )
        )
      )
    }

    it('lo scarico successivo in WasteFlow vede la giacenza importata (giacenza-disponibile)', async () => {
      const az = await azienda()
      const p = await pacchettoPer(az)
      expect(await eseguiCli(argomenti(az, p, ...conOperatore(az)), uscita().u, servizio)).toBe(0)
      // 20 03 01: 300 kg importati. Senza la giacenza importata questo scarico sarebbe rifiutato.
      const riuscito = async (az2: Az, registroId: string, kg: number, cer: string) =>
        (await scarico(az2, registroId, kg, cer)).isSuccess
      expect(await riuscito(az, az.registroA, 300, '20 03 01')).toBe(true)
      // ...consumata la giacenza, uno scarico in piu' e rifiutato dal controllo di giacenza.
      const oltre = await scarico(az, az.registroA, 1, '20 03 01')
      expect(oltre.isFailure).toBe(true)
      expect(String(oltre.error)).toContain('Giacenza insufficiente')
      // un altro registro non vede la giacenza del registro A
      expect(await riuscito(az, az.registroB, 1, '20 03 01')).toBe(false)
      // 15 01 01: 720 kg disponibili, 721 no
      expect(await riuscito(az, az.registroA, 721, '15 01 01')).toBe(false)
      expect(await riuscito(az, az.registroA, 720, '15 01 01')).toBe(true)
    })

    it('il MUD dell anno non conta la giacenza importata come prodotta o ricevuta', async () => {
      const az = await azienda()
      const p = await pacchettoPer(az)
      expect(await eseguiCli(argomenti(az, p, ...conOperatore(az)), uscita().u, servizio)).toBe(0)
      const mud = new MudAggregazioneService(app as never, {} as never, logger)
      // Controllo positivo: la giacenza importata e' una GIACENZA al 31/12 (saldo), non un movimento.
      const saldi = await TenantContext.run({ tenantId: az.tenantId }, async () =>
        (mud as any).sommaSaldiPerCer(
          await (mud as any).saldiAl31DicembrePerRegistro(
            az.tenantId,
            limitiAnnoMud(2026).fine,
            2026
          )
        )
      )
      expect(saldi).toEqual([
        { cerCode6: '13 02 05*', kg: 100 },
        { cerCode6: '15 01 01', kg: 720 },
        { cerCode6: '15 01 02', kg: 80 },
        { cerCode6: '20 03 01', kg: 300 },
      ])
      for (const versioneCalcolo of [1, 2] as const) {
        const esito = await TenantContext.run({ tenantId: az.tenantId }, async () =>
          mud.aggrega(az.tenantId, 2026, { versioneCalcolo })
        )
        // nessun movimento: nessun conteggio e nessuna riga prodotta, recuperata o smaltita
        expect(esito.movimentiPerCer).toEqual({})
        for (const r of esito.righe) {
          expect(r.prodottoKg).toBe(0)
          expect(r.recuperoKg).toBe(0)
          expect(r.smaltimentoKg).toBe(0)
          expect(r.rt ?? []).toEqual([])
        }
      }
    })
  })
})
