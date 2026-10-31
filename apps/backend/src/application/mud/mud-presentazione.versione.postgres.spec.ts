/**
 * Versione del calcolo della presentazione (Fase 2 pezzo 8, D10) contro un Postgres reale,
 * collegato COME `wasteflow_app` (RLS ENABLE+FORCE) dentro il `TenantContext` dell'azienda.
 *
 * Un MUD presentato prima di F2-8 non porta `versioneCalcolo`: `stato()` lo ricalcola con la
 * versione 1 e lo confronta con l'hash dell'oracolo (a2bf11e), quindi le giacenze al 31/12 che la
 * versione 2 scrive nel registro non lo fanno risultare «modificato dopo la presentazione».
 * Preparazione e pulizia col client proprietario, per `tenantId`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55436/wasteflow_ci?schema=public'
// I servizi dell'applicazione leggono DATABASE_URL, come in produzione.
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { MudAggregazioneService } from './aggregazione/mud-aggregazione.service'
import { MudAggregazioneOracoloA2bf11e } from './aggregazione/mud-aggregazione-a2bf11e.oracolo-spec'
import { hashAggregato, hashCalcoloMud } from './aggregazione/mud-regole'
import { MudPresentazioneService } from './mud-presentazione.service'
import { MudVersionRegistry } from './export/mud-version.registry'
import {
  creaAziendaMud,
  creaMovimento,
  pulisciAziendeMud,
  type AziendaMud,
} from './aggregazione/mud-seed.postgres-spec'

describe('MudPresentazione: versione del calcolo — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let aggregazione: MudAggregazioneService
  let oracolo: MudAggregazioneOracoloA2bf11e
  let presentazione: MudPresentazioneService
  const tenantCreati: string[] = []
  let az: AziendaMud

  const nelTenant = <R>(fn: () => Promise<R>) =>
    TenantContext.run({ tenantId: az.tenantId }, async () => await fn())

  const presenta = async (reportData: Record<string, unknown>) => {
    await owner.mUDReport.deleteMany({ where: { tenantId: { in: [az.tenantId] } } })
    await owner.mUDReport.create({
      data: {
        tenantId: az.tenantId,
        year: 2025,
        status: 'SUBMITTED',
        submittedAt: new Date('2026-06-30T10:00:00Z'),
        reportData: reportData as any,
      },
    })
  }

  beforeAll(async () => {
    expect(process.env.DATABASE_URL ?? '').toMatch(
      /@(127\.0\.0\.1|localhost):(55432|55436)\/wasteflow_ci\b/
    )
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
    const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn() }
    aggregazione = new MudAggregazioneService(
      app,
      { findComuneByName: jest.fn().mockResolvedValue({ code: '015146' }) } as any,
      logger
    )
    oracolo = new MudAggregazioneOracoloA2bf11e(
      app,
      { findComuneByName: jest.fn().mockResolvedValue({ code: '015146' }) } as any,
      logger,
      aggregazione
    )
    presentazione = new MudPresentazioneService(app, new MudVersionRegistry(), aggregazione, logger)

    az = await creaAziendaMud(owner, 'PV')
    tenantCreati.push(az.tenantId)
    // 500 kg prodotti il 10/06 e 200 kg avviati a recupero il 01/07: restano 300 kg in registro
    // al 31/12, che la versione 2 dichiara come giacenza a recupero
    await creaMovimento(owner, az, {
      type: 'CARICO',
      causale: 'PRODUZIONE_INTERNA',
      cerCode: '17 04 05',
      quantita: 500,
      giorno: '2025-06-10',
    })
    await creaMovimento(owner, az, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: '17 04 05',
      quantita: 200,
      giorno: '2025-07-01',
      operationCode: 'R13',
      counterpartName: 'Recuperi Nord Srl',
    })
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const where = { tenantId: { in: tenantCreati } }
      await owner.activityLog.deleteMany({ where })
      await owner.mUDReport.deleteMany({ where })
      await pulisciAziendeMud(owner, tenantCreati)
    }
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('stato: un MUD presentato senza versioneCalcolo si confronta con la versione 1 e non risulta modificato dopo le giacenze nuove', async () => {
    const { storico, oggi } = await nelTenant(async () => ({
      storico: await oracolo.aggrega(az.tenantId, 2025),
      oggi: await aggregazione.aggrega(az.tenantId, 2025),
    }))
    // le giacenze al 31/12 ci sono davvero nel calcolo di oggi e non in quello di prima
    expect(oggi.righe[0].giacenzaRecuperoKg).toBe(300)
    expect(storico.righe[0].giacenzaRecuperoKg).toBeUndefined()
    // presentazione fatta prima di F2-8: hash dell'oracolo, nessuna versione
    await presenta({ hashAggregato: hashAggregato(storico.righe), fileTracciato: true })

    const stato = await nelTenant(() => presentazione.stato(az.tenantId, 2025))

    expect(stato.status).toBe('SUBMITTED')
    expect(stato.datiModificatiDopoPresentazione).toBe(false)
    expect(stato.versioneCalcolo).toBe(1)
    expect(stato.versioneCalcoloAttuale).toBe(2)
    expect(hashCalcoloMud(oggi)).not.toBe(hashAggregato(storico.righe))
  })

  it('stato: con versione 2 una rettifica dopo la presentazione risulta', async () => {
    const presentato = await nelTenant(() => aggregazione.aggrega(az.tenantId, 2025))
    await presenta({
      hashAggregato: hashCalcoloMud(presentato),
      versioneCalcolo: 2,
      fileTracciato: true,
    })
    expect(
      (await nelTenant(() => presentazione.stato(az.tenantId, 2025)))
        .datiModificatiDopoPresentazione
    ).toBe(false)

    // dopo la presentazione si registra un altro avvio a recupero di 50 kg
    await creaMovimento(owner, az, {
      type: 'SCARICO',
      causale: 'AVVIO_RECUPERO',
      cerCode: '17 04 05',
      quantita: 50,
      giorno: '2025-09-01',
      operationCode: 'R13',
      counterpartName: 'Recuperi Nord Srl',
    })
    const stato = await nelTenant(() => presentazione.stato(az.tenantId, 2025))
    expect(stato.datiModificatiDopoPresentazione).toBe(true)
    expect(stato.versioneCalcolo).toBe(2)
  })
})
