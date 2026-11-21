/**
 * Pezzo I5 T4: i test di non-trasmissione del blocco 1 (b), (c), (d) rieseguiti sui FIR CARICATI DAL
 * PACCHETTO (FIXTURE SINTETICHE), non su FIR costruiti a mano. Il caricamento gira COME
 * `wasteflow_app` (`migrazione:carica`); il proprietario serve solo a forzare lo stato di sincronizzazione
 * (PENDING/SYNCING stallato) e a creare il FIR normale di confronto. Il client RENTRI e la coda sono
 * finti: non parte nessuna richiesta reale.
 * (a) riguarda i movimenti del registro e sta in `registro/non-trasmissione-importati.postgres.spec.ts`.
 */
import { PrismaClient } from '@prisma/client'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55447/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { RENTRISyncController } from '../../api/rentri/rentri-sync.controller'
import { MembershipService } from '../../api/me/membership.service'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { TenantSwitchInterceptor } from '../../core/interceptors/tenant-switch.interceptor'
import { LoggerService } from '../../core/logger/logger.service'
import { FirBloccatoAllInvioError } from '../../domain/fir/guardia-invio-rentri'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { RENTRISyncLogRepository } from '../../infrastructure/persistence/rentri-sync-log.repository'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { RENTRISyncQueue } from '../../infrastructure/queue/rentri-sync.queue'
import { partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { cancellaAziendeDiProva } from '../../test-support/cancella-azienda-di-prova'
import { mappaValida } from '../../test-support/migrazione/mappa-di-prova'
import { scriviStagingFirProva } from '../../test-support/migrazione/staging-fir-di-prova'
import { CaricaPacchettoService } from '../migrazione/caricamento/carica-pacchetto.service'
import { LottiImportService } from '../migrazione/caricamento/lotti-import.service'
import { apriPacchetto, PacchettoAperto } from '../migrazione/pacchetto/lettore-pacchetto'
import { validaMappa } from '../migrazione/pacchetto/mappa-import'
import { preparaPacchetto } from '../migrazione/pacchetto/prepara-pacchetto'
import { apriStaging } from '../migrazione/staging/lettore-staging'
import { eseguiCli } from '../../cli/migrazione-carica'
import { TenantContext } from '../../core/context/tenant-context'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { ArchivioRiacquisizionePrisma } from '../migrazione/riacquisizione/archivio-riacquisizione.prisma'
import { RiacquisisciFirService } from '../migrazione/riacquisizione/riacquisisci-fir.service'
import { AcquisisciFormularioRENTRIUseCase } from './acquisisci-formulario-rentri.use-case'
import { ConfermaLegameRENTRIUseCase } from './conferma-legame-rentri.use-case'
import { GetSyncStatusUseCase } from './get-sync-status.use-case'
import { RiapriTrasmissioneRentriUseCase } from './riapri-trasmissione-rentri.use-case'
import { SyncFIRToRENTRIUseCase } from './sync-fir-to-rentri.use-case'
import { TrasmettiFIRSecondoModalitaUseCase } from './trasmetti-fir-secondo-modalita.use-case'
import { TriggerBatchSyncUseCase } from './trigger-batch-sync.use-case'

jest.mock('../../core/monitoring/segnala-errore-job', () => ({ segnalaErroreJob: jest.fn() }))

const SOGLIA = new Date('2026-10-23T09:50:00.000Z')
const VECCHIO = new Date('2026-10-20T10:00:00.000Z')
const TETTO = new Date('2026-10-01T00:00:00.000Z')
const MOTIVO_HTTP = "FIR importato: l'invio a RENTRI è bloccato fino alla riconciliazione"

const logger = (): any => ({
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
})

describe('Pezzo I5 T4: non-trasmissione dei FIR caricati dal pacchetto — Postgres reale', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: CaricaPacchettoService
  let repo: FIRPrismaRepository
  let radice: string
  const tenantCreati: string[] = []
  let n = 0
  const seme = 6_900_000 + (Date.now() % 90_000)

  interface Az {
    tenantId: string
    userId: string
    importati: string[]
    pacchetto: PacchettoAperto
  }

  /** Azienda + pacchetto sintetico caricato (ANAGRAFICHE poi FIR) col ruolo applicativo. */
  async function azienda(modalita: 'AUTOMATICA' | 'IBRIDA'): Promise<Az> {
    n++
    const t = await owner.tenant.create({
      data: {
        partitaIva: partitaIvaUnica(),
        ragioneSociale: `Non trasmissione ${modalita}`,
        country: 'IT',
        rentriModalitaLegame: modalita,
        subscriptionStatus: 'ACTIVE',
      },
    })
    tenantCreati.push(t.id)
    const user = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `kc-nt-i5-${seme}-${n}`,
        fiscalCode: `NTI5${seme}${n}`.slice(0, 16),
        firstName: 'Prova',
        lastName: 'Pacchetto',
        email: `nt-i5-${seme}-${n}@example.test`,
      },
    })
    const prova = await scriviStagingFirProva(await mkdtemp(join(radice, 'st-')), seme * 10 + n, {
      casi: [
        { cod: 1, formu: 'A0001/26' },
        { cod: 2, formu: 'A0002/26', c7: 'R', datf: '06-03-2026' },
        { cod: 3, formu: 'A0003/26', c7: '9' },
        { cod: 4, formu: 'ABCDE1234567', c6: 'DIGITALE' },
      ],
    })
    const propria = await owner.ditta.create({
      data: { tenantId: t.id, ragioneSociale: 'PROPRIA SRL', partitaIva: partitaIvaUnica() },
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
    const ul = await owner.rentriUnitaLocale.create({
      data: { tenantId: t.id, numIscrSito: 'OP1234ABC123456-RM1234', denominazione: 'Sede prova' },
    })
    const mappa = validaMappa({
      ...mappaValida(),
      tenantId: t.id,
      registri: [],
      unitaLocali: [{ legacy: 'X1.0001', sedeId: sede.id, unitaLocaleId: ul.id }],
      causali: [],
      agganci: [{ partitaIva: prova.piva.agganciata, dittaId: agg.id }],
    })
    const cartella = join(await mkdtemp(join(radice, 'pk-')), 'WW00012026')
    await preparaPacchetto(await apriStaging(prova.cartella), mappa, cartella)
    const pk = await apriPacchetto(cartella)
    const nulla = { scrivi: () => undefined, errore: () => undefined }
    const base = ['--tenant', t.id, '--pacchetto', pk.cartella]
    expect(await eseguiCli([...base, '--ambito', 'ANAGRAFICHE'], nulla, servizio)).toBe(0)
    expect(
      await eseguiCli([...base, '--ambito', 'FIR', '--operatore', user.id], nulla, servizio)
    ).toBe(0)
    const firs = await owner.fIR.findMany({
      where: { tenantId: t.id, importSource: 'WINWASTE' },
      select: { id: true, bloccatoInvio: true },
    })
    expect(firs).toHaveLength(3)
    expect(firs.every(f => f.bloccatoInvio)).toBe(true)
    return { tenantId: t.id, userId: user.id, importati: firs.map(f => f.id), pacchetto: pk }
  }

  /** FIR normale di confronto, stessa forma, SENZA provenienza (creato dal proprietario). */
  async function firNormale(az: Az, sync: 'PENDING' | 'SYNCING', avviatoAt: Date | null = null) {
    n++
    const r = await owner.fIR.create({
      data: {
        tenantId: az.tenantId,
        producerUserId: az.userId,
        producerPartitaIva: '00000000000',
        producerName: 'Produttore',
        producerAddress: 'Via Roma 1',
        carrierPartitaIva: '00000000001',
        carrierName: 'Trasportatore',
        carrierVehiclePlate: 'AB123CD',
        receiverPartitaIva: '00000000002',
        receiverName: 'Destinatario',
        receiverAddress: 'Via Roma 2',
        cerCode: '15 01 01',
        wasteDescription: 'Imballaggi',
        wasteCategory: 'Non pericoloso',
        quantity: 5,
        transportDate: new Date('2026-03-05T08:00:00Z'),
        provenienza: 'SPECIALE',
        firNumber: `FIR/NORM/${seme}/${n}`,
        status: 'AWAITING_CARRIER',
        rentriSyncStatus: sync,
        rentriSyncAvviatoAt: avviatoAt,
      } as never,
    })
    await owner.$executeRaw`UPDATE firs SET updated_at = (${VECCHIO.toISOString()}::timestamptz AT TIME ZONE 'UTC') WHERE id = ${r.id}::uuid`
    return r.id
  }

  /** Forza lo stato di sincronizzazione di un FIR importato (il proprietario: un job non puo'). */
  async function forzaSync(id: string, sync: 'PENDING' | 'SYNCING', avviatoAt: Date | null) {
    await owner.fIR.update({
      where: { id },
      data: { rentriSyncStatus: sync, rentriSyncAvviatoAt: avviatoAt },
    })
    await owner.$executeRaw`UPDATE firs SET updated_at = (${VECCHIO.toISOString()}::timestamptz AT TIME ZONE 'UTC') WHERE id = ${id}::uuid`
  }

  beforeAll(async () => {
    await owner.$connect()
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    servizio = new CaricaPacchettoService(app, new LottiImportService(app, logger()), logger())
    repo = new FIRPrismaRepository(Object.assign(owner, { db: owner }) as any, owner as any)
    radice = await mkdtemp(join(tmpdir(), 'nt-fir-pk-'))
  })
  afterAll(async () => {
    if (tenantCreati.length > 0) {
      await owner.fIR.deleteMany({ where: { tenantId: { in: tenantCreati } } })
      await cancellaAziendeDiProva(owner, tenantCreati)
    }
    await app.onModuleDestroy()
    await owner.$disconnect()
    await rm(radice, { recursive: true, force: true })
  })

  it.each(['AUTOMATICA', 'IBRIDA'] as const)(
    "(b) %s: il job di ripresa non elenca ne' il PENDING ne' il SYNCING stallato dei FIR del pacchetto; il normale si",
    async modalita => {
      const az = await azienda(modalita)
      const [pending, syncing, syncingSenzaData] = az.importati
      await forzaSync(pending, 'PENDING', null)
      await forzaSync(syncing, 'SYNCING', new Date('2026-10-23T09:00:00.000Z'))
      await forzaSync(syncingSenzaData, 'SYNCING', null)
      const normalePending = await firNormale(az, 'PENDING')
      const normaleSyncing = await firNormale(az, 'SYNCING', new Date('2026-10-23T09:00:00.000Z'))

      const elenco = await repo.elencaTrasmissioniRentriSospese(SOGLIA, 1000, TETTO, [az.tenantId])
      const ids = elenco.map(e => e.firId)
      expect(ids).toEqual(expect.arrayContaining([normalePending, normaleSyncing]))
      for (const importato of az.importati) expect(ids).not.toContain(importato)
    }
  )

  describe('(c) invio manuale (POST /rentri/sync/fir/:id) di un FIR del pacchetto', () => {
    let http: INestApplication
    let coda: { addSyncJob: jest.Mock }
    let az: Az

    beforeAll(async () => {
      az = await azienda('IBRIDA')
      coda = { addSyncJob: jest.fn().mockResolvedValue('job-1') }
      const prismaFinto: any = {
        tenant: {
          findFirst: jest.fn(),
          findUnique: jest.fn().mockResolvedValue({ parentTenantId: null }),
        },
        consultantTenantAssociation: { findFirst: jest.fn().mockResolvedValue(null) },
      }
      const log = logger()
      const utente = { id: az.userId, email: 'u@azienda.it', tenantId: az.tenantId, role: 'ADMIN' }
      const moduleRef = await Test.createTestingModule({
        controllers: [RENTRISyncController],
        providers: [
          { provide: TriggerBatchSyncUseCase, useValue: {} },
          { provide: GetSyncStatusUseCase, useValue: {} },
          { provide: ConfermaLegameRENTRIUseCase, useValue: {} },
          { provide: RENTRISyncQueue, useValue: coda },
          { provide: RENTRISyncLogRepository, useValue: {} },
          { provide: FIRPrismaRepository, useValue: repo },
          { provide: RiapriTrasmissioneRentriUseCase, useValue: { execute: jest.fn() } },
          { provide: LoggerService, useValue: log },
          { provide: RuoloEffettivoService, useValue: new RuoloEffettivoService(prismaFinto) },
          {
            provide: MembershipService,
            useValue: new MembershipService(prismaFinto, prismaFinto, {
              generateTokenPair: jest.fn(),
            } as any),
          },
          { provide: APP_INTERCEPTOR, useClass: TenantSwitchInterceptor },
          { provide: APP_FILTER, useValue: new HttpExceptionFilter(log) },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            context.switchToHttp().getRequest().user = utente
            return true
          },
        })
        .overrideGuard(RolesGuard)
        .useValue({ canActivate: () => true })
        .compile()
      http = moduleRef.createNestApplication()
      http.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
      )
      await http.init()
    })
    afterAll(async () => http?.close())
    beforeEach(() => coda.addSyncJob.mockClear())

    it.each(['PENDING', 'SYNCING'] as const)(
      '(c) FIR del pacchetto in %s (anche forzato dal proprietario): 409 con il messaggio di D4, nessun job in coda',
      async stato => {
        const id = az.importati[0]
        await forzaSync(id, stato, stato === 'SYNCING' ? new Date(Date.now() - 3_600_000) : null)
        const r = await request(http.getHttpServer()).post(`/rentri/sync/fir/${id}`).send({})
        expect(r.status).toBe(409)
        expect(r.body.message).toBe(MOTIVO_HTTP)
        expect(r.body.error).toBe('FIR_BLOCCATO_ALL_INVIO')
        expect(coda.addSyncJob).not.toHaveBeenCalled()
        const conferma = await request(http.getHttpServer())
          .post(`/rentri/sync/fir/${id}`)
          .send({ confermaNuovaTrasmissione: true })
        expect(conferma.status).toBe(409)
        expect(coda.addSyncJob).not.toHaveBeenCalled()
      }
    )

    it('prova di controllo: il FIR normale equivalente si accoda (202)', async () => {
      const id = await firNormale(az, 'PENDING')
      const r = await request(http.getHttpServer()).post(`/rentri/sync/fir/${id}`).send({})
      expect(r.status).toBe(202)
      expect(coda.addSyncJob).toHaveBeenCalledTimes(1)
    })
  })

  describe('(d) coda, trigger batch, invio automatico e client RENTRI', () => {
    it.each(['AUTOMATICA', 'IBRIDA'] as const)(
      '(d) %s: TrasmettiFIRSecondoModalita su un FIR del pacchetto: nessun addSyncJob',
      async modalita => {
        const az = await azienda(modalita)
        const coda = { addSyncJob: jest.fn().mockResolvedValue('job-1') }
        const useCase = new TrasmettiFIRSecondoModalitaUseCase(
          {
            getForTenant: jest
              .fn()
              .mockResolvedValue({ modalitaLegame: modalita, certificatoConfigurato: true }),
          } as any,
          coda as any,
          repo as any,
          logger(),
          { moduliAttivi: jest.fn().mockResolvedValue(['fir', 'rentri']) } as any
        )
        for (const firId of az.importati) {
          const esito = await useCase.eseguiSeAutomatica({ firId, tenantId: az.tenantId })
          expect(esito).toEqual({ avviata: false, motivo: 'BLOCCATO_ALL_INVIO' })
        }
        expect(coda.addSyncJob).not.toHaveBeenCalled()
      }
    )

    it('(d) TriggerBatchSync con 2 FIR del pacchetto e 1 normale: uno accodato, due saltati con motivo', async () => {
      const az = await azienda('AUTOMATICA')
      const normale = await firNormale(az, 'PENDING')
      const coda = { addBatchJob: jest.fn().mockResolvedValue('batch-1') }
      const useCase = new TriggerBatchSyncUseCase(repo as any, coda as any, logger())
      const ids = [az.importati[0], normale, az.importati[1]]
      const esito = await useCase.execute({ firIds: ids, tenantId: az.tenantId })
      expect(esito.queuedCount).toBe(1)
      expect(esito.skippedCount).toBe(2)
      expect(coda.addBatchJob.mock.calls[0][0].firIds).toEqual([normale])
    })

    it('(d) SyncFIRToRENTRIUseCase su un FIR del pacchetto in SYNCING: FirBloccatoAllInvioError, il client RENTRI non riceve nessuna chiamata', async () => {
      const az = await azienda('AUTOMATICA')
      const id = az.importati[0]
      await forzaSync(id, 'SYNCING', new Date(Date.now() - 3_600_000))
      const registrate: string[] = []
      const client = new Proxy(
        {},
        {
          get: (_t, nome: string) => async () => {
            registrate.push(nome)
          },
        }
      )
      const useCase = new SyncFIRToRENTRIUseCase(
        repo as any,
        client as any,
        { createPending: jest.fn(), save: jest.fn() } as any,
        { publish: jest.fn() } as any,
        logger(),
        { costruisci: jest.fn() } as any
      )
      await expect(useCase.execute(id, az.tenantId)).rejects.toBeInstanceOf(
        FirBloccatoAllInvioError
      )
      expect(registrate).toEqual([])
    })
  })

  describe('Q5: la riacquisizione dei digitali non tocca gli importati e non e un import', () => {
    it('il FIR digitale non e nel database dopo il carico; riacquisito con il client finto nasce senza provenienza e non bloccato', async () => {
      const az = await azienda('AUTOMATICA')
      expect(
        await owner.fIR.count({ where: { tenantId: az.tenantId, firNumber: 'ABCDE1234567' } })
      ).toBe(0)

      const chiamate: string[] = []
      const client = new Proxy(
        {},
        {
          get: (_t, nome: string) => async () => {
            chiamate.push(nome)
            if (nome === 'leggiFormulario') return { stato_formulario: 'EMESSO' }
            throw new Error(`chiamata non prevista: ${nome}`)
          },
        }
      )
      const port = {
        creaDaDettaglio: jest.fn(async () =>
          FIR.create({
            produttoreId: '11111111-1111-4111-8111-111111111111',
            rifiuto: { cerCode: '150101', quantita: 100 },
            trasportatoreId: '22222222-2222-4222-8222-222222222222',
            destinatarioId: '33333333-3333-4333-8333-333333333333',
            tenantId: az.tenantId,
            creatoDaUserId: az.userId,
          })
        ),
      }
      // I-1: repository e audit sul client APPLICATIVO (RLS), come in produzione; l'adattatore entra
      // nel contesto dell'azienda come fa `RiacquisizioneFirModule`.
      const repoApp = new FIRPrismaRepository(app, owner as any)
      const caso = new AcquisisciFormularioRENTRIUseCase(
        repoApp as any,
        client as any,
        app as any,
        port as any,
        logger()
      )
      const archivio = new ArchivioRiacquisizionePrisma(app)
      const senzaContesto = new RiacquisisciFirService(
        { acquisisci: i => caso.execute(i) },
        archivio,
        logger(),
        async () => undefined
      )
      const riacquisitore = new RiacquisisciFirService(
        {
          acquisisci: i =>
            TenantContext.run({ tenantId: i.tenantId, userId: i.userId }, () => caso.execute(i)),
        },
        archivio,
        logger(),
        async () => undefined
      )
      const richiestaBase = {
        tenantId: az.tenantId,
        userId: az.userId,
        pacchetto: az.pacchetto,
        esegui: true,
        pausaMs: 1000,
        massimo: 10,
      }
      // senza TenantContext la RLS blocca la scrittura: e' il difetto che il contesto corregge
      const rotta = await senzaContesto.esegui(richiestaBase)
      expect(rotta.conteggi).toEqual({ FALLITO: 1 })
      expect(
        await owner.fIR.count({ where: { tenantId: az.tenantId, rentriNumeroFir: 'ABCDE1234567' } })
      ).toBe(0)
      chiamate.length = 0
      const r = await riacquisitore.esegui(richiestaBase)
      expect(r.conteggi).toEqual({ RIACQUISITO: 1 })
      expect(chiamate).toEqual(['leggiFormulario'])

      const riacquisito = await owner.fIR.findFirstOrThrow({
        where: { tenantId: az.tenantId, rentriNumeroFir: 'ABCDE1234567' },
      })
      expect(riacquisito).toMatchObject({
        importSource: null,
        legacyKey: null,
        lottoImportId: null,
        bloccatoInvio: false,
        motivoBloccoInvio: null,
      })
      // gli importati sono sempre e solo i 3 del pacchetto
      expect(
        await owner.fIR.count({ where: { tenantId: az.tenantId, importSource: 'WINWASTE' } })
      ).toBe(3)

      // seconda esecuzione: il numero e gia un FIR dell'azienda, RENTRI non si contatta piu
      const seconda = await riacquisitore.esegui(richiestaBase)
      expect(seconda.conteggi).toEqual({ GIA_PRESENTE: 1 })
      expect(chiamate).toEqual(['leggiFormulario'])
    })
  })

  it('il FIR del pacchetto riletto dal repository e bloccato e non sincronizzabile; un save non tocca il blocco', async () => {
    const az = await azienda('AUTOMATICA')
    const letto = (await repo.findById(az.importati[0]))!
    expect(letto.bloccatoInvio).toBe(true)
    expect(letto.canSyncToRENTRI()).toBe(false)
    expect(letto.rentriNumeroFir).toBeNull()
    ;(letto as any)._annotazioni = 'nota'
    await repo.save(letto)
    const riga = await owner.fIR.findUniqueOrThrow({ where: { id: az.importati[0] } })
    expect(riga.bloccatoInvio).toBe(true)
    expect(riga.importSource).toBe('WINWASTE')
  })
})
