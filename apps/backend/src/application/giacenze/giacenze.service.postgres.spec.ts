/**
 * Pagina giacenze con le giacenze iniziali (Fase 2 pezzo 2) contro un Postgres reale, collegato
 * COME `wasteflow_app` (RLS ENABLE+FORCE soggetta alle policy), dentro il `TenantContext`
 * dell'azienda: da superuser la RLS non si vedrebbe.
 *
 * Il proprietario (`wasteflow`, superuser) prepara aziende e sedi; la pulizia toglie solo le righe
 * create qui. Modello: `registro/registro-per-sede.postgres.spec.ts`.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
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
import { RegistriService } from '../registro/registri.service'
import { GiacenzeInizialiService } from '../registro/giacenze-iniziali.service'
import { GiacenzeService } from './giacenze.service'
import { SoglieDepositoService } from './soglie-deposito.service'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('GiacenzeService.getGiacenze con giacenze iniziali — Postgres reale, ruolo wasteflow_app', () => {
  const CER_A = '99 99 07'
  const CER_B = '99 99 08'
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let giacenzeIniziali: GiacenzeInizialiService
  let giacenze: GiacenzeService
  let registri: RegistriService
  let userId: string
  const cerCreati: string[] = []
  const tenantCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  /** Azienda con una sede principale e il suo registro. */
  async function aziendaConRegistro() {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `GI${suffisso}`, ragioneSociale: 'Giacenze iniziali SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    await owner.rentriUnitaLocale.create({
      data: {
        tenantId: t.id,
        numIscrSito: `OP0001GI${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: 'Sede',
        principale: true,
      },
    })
    const [registro] = await nelTenant(t.id, () => registri.assicuraRegistri(t.id))
    return { tenantId: t.id, registroId: registro.id }
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')
    registri = new RegistriService(app, loggerStub as never)
    giacenzeIniziali = new GiacenzeInizialiService(app, registri)
    giacenze = new GiacenzeService(app, loggerStub as never, new SoglieDepositoService(app))
    const tenantUtente = await aziendaConRegistro()
    userId = (
      await owner.user.create({
        data: {
          tenantId: tenantUtente.tenantId,
          keycloakId: `keycloak-giacenze-${Date.now()}`,
          fiscalCode: 'RSSMRA80A01H501U',
          firstName: 'Mario',
          lastName: 'Rossi',
          email: `giacenze-${Date.now()}@example.com`,
          role: 'ADMIN',
        },
      })
    ).id
    for (const code of [CER_A, CER_B]) {
      if ((await owner.cERCode.count({ where: { code } })) === 0) cerCreati.push(code)
      await owner.cERCode.upsert({
        where: { code },
        create: { code, description: 'CER di test', category: '99', subcategory: '' },
        update: {},
      })
    }
  })

  afterAll(async () => {
    await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.sogliaDepositoTemporaneo.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.wasteMovement.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.giacenzaIniziale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    // senza id deleteMany non avrebbe filtro e cancellerebbe tutti gli utenti
    if (userId) await owner.user.deleteMany({ where: { id: userId } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreati.length > 0) await owner.cERCode.deleteMany({ where: { code: { in: cerCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('un CER con la sola apertura compare con caricoKg = inizialeKg; quella di un’altra azienda no', async () => {
    const a = await aziendaConRegistro()
    const b = await aziendaConRegistro()
    await nelTenant(a.tenantId, () =>
      giacenzeIniziali.crea(a.tenantId, userId, {
        cerCode: CER_A,
        quantita: 1.5,
        unita: 't',
        dataRiferimento: '2026-01-01',
      })
    )
    await nelTenant(b.tenantId, () =>
      giacenzeIniziali.crea(b.tenantId, userId, {
        cerCode: CER_B,
        quantita: 40,
        unita: 'KG',
        dataRiferimento: '2026-01-01',
      })
    )

    // senza e con registroId: stesso risultato (l'azienda ha un solo registro)
    for (const registroId of [undefined, a.registroId]) {
      const righe = await nelTenant(a.tenantId, () => giacenze.getGiacenze(a.tenantId, registroId))
      expect(righe.map(r => r.cerCode)).toEqual([CER_A])
      expect(righe[0]).toMatchObject({
        caricoKg: 1500,
        inizialeKg: 1500,
        scaricoKg: 0,
        giacenzaKg: 1500,
      })
      expect(righe[0].oldestCaricoDate).toEqual(new Date('2026-01-01T00:00:00Z'))
    }

    // l'altra azienda vede solo la propria, non quella di A
    const righeB = await nelTenant(b.tenantId, () => giacenze.getGiacenze(b.tenantId))
    expect(righeB.map(r => r.cerCode)).toEqual([CER_B])
    expect(righeB[0]).toMatchObject({ caricoKg: 40, inizialeKg: 40, giacenzaKg: 40 })
  })

  it('con il contesto di un’altra azienda la RLS nasconde le aperture anche se il tenantId è quello di A', async () => {
    const a = await aziendaConRegistro()
    const b = await aziendaConRegistro()
    await nelTenant(a.tenantId, () =>
      giacenzeIniziali.crea(a.tenantId, userId, {
        cerCode: CER_A,
        quantita: 10,
        unita: 'KG',
        dataRiferimento: '2026-01-01',
      })
    )
    const righe = await nelTenant(b.tenantId, () => giacenze.getGiacenze(a.tenantId))
    expect(righe).toEqual([])
  })

  it('F2-6: due registri dello stesso CER hanno lotti, soglie e avvisi propri; un’altra azienda non li vede', async () => {
    const az = await aziendaConRegistro()
    const regA = az.registroId
    const regB = (
      await owner.registroRifiuti.create({
        data: { tenantId: az.tenantId, descrizione: 'Registro B', codice: 'ALTRO_REGISTRO' },
      })
    ).id
    const carico = (registroId: string, numero: number, quantita: number, giorno: string) =>
      owner.wasteMovement.create({
        data: {
          tenantId: az.tenantId,
          registroId,
          progressiveYear: 2026,
          progressiveNumber: numero,
          type: 'CARICO',
          movementDate: new Date(`${giorno}T10:00:00Z`),
          registrationDate: new Date(`${giorno}T10:00:00Z`),
          causale: 'PRODUZIONE_INTERNA',
          cerCode: CER_A,
          quantity: quantita,
          unit: 'KG',
          tipoAnnotazione: 'ORDINARIA',
        },
      })
    await carico(regA, 1, 100, '2026-01-01')
    await carico(regB, 1, 25000, '2026-03-01')
    // soglie solo per A: durata a 30 giorni; B resta sulle predefinite dell'azienda
    await owner.sogliaDepositoTemporaneo.create({
      data: {
        tenantId: az.tenantId,
        registroId: regA,
        criterio: 'TEMPORALE',
        giorniMax: 30,
        kgMaxTotale: 500,
        kgMaxPericolosi: 100,
        preavvisoGiorni: 5,
        preavvisoPercentuale: 80,
        impostatoDa: userId,
      },
    })

    const vista = await nelTenant(az.tenantId, () =>
      giacenze.getDepositoTemporaneo(az.tenantId, { oggi: '2026-03-20' })
    )

    expect(vista.registri.map(r => r.registroId).sort()).toEqual([regA, regB].sort())
    const a = vista.registri.find(r => r.registroId === regA)!
    const b = vista.registri.find(r => r.registroId === regB)!
    expect(a.soglie.origine).toBe('REGISTRO')
    expect(b.soglie.origine).toBe('PREDEFINITA')
    expect(a.cer[0]).toMatchObject({ giornoPiuVecchio: '2026-01-01', residuoKg: 100 })
    expect(b.cer[0]).toMatchObject({ giornoPiuVecchio: '2026-03-01', residuoKg: 25000 })
    // A: scaduta la soglia di 30 giorni; niente avvisi di quantità (criterio TEMPORALE)
    expect(a.avvisi.map(x => [x.tipo, x.livello])).toEqual([['DURATA', 'SUPERATO']])
    // B: nessuna durata (tre mesi dal 01/03), preavviso di quantità all'83% della soglia di 30000
    expect(b.avvisi.map(x => [x.tipo, x.livello])).toEqual([['QUANTITA_TOTALE', 'PREAVVISO']])
    expect(a.totaleKg).toBe(100)
    expect(b.totaleKg).toBe(25000)

    const alerts = await nelTenant(az.tenantId, () =>
      giacenze.getDepositoTemporaneoAlerts(az.tenantId, regB, '2026-03-20')
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ registroId: regB, registroDescrizione: 'Registro B' })

    // contesto di un'altra azienda: la RLS nasconde i registri
    const altra = await aziendaConRegistro()
    const nascosta = await nelTenant(altra.tenantId, () =>
      giacenze.getDepositoTemporaneo(az.tenantId, { oggi: '2026-03-20' })
    )
    expect(nascosta.registri).toEqual([])
  })
})
