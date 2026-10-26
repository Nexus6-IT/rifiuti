/**
 * RegistriService contro un Postgres reale, collegato COME `wasteflow_app` (RLS ENABLE+FORCE
 * soggetta alle policy), come in produzione: un test da superuser non vedrebbe i difetti di RLS.
 *
 * - Il servizio gira nel contesto del tenant (`TenantContext.run`) col `PrismaService` prodotto
 *   dalla factory dell'applicazione; la preparazione dei dati e le verifiche usano il
 *   proprietario (`wasteflow`, superuser, esente dalla RLS).
 * - Il database di test e' quello del container `wasteflow-pg-test` (127.0.0.1:55432) con le
 *   migration applicate (`npx prisma migrate deploy`).
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
import { RegistriService } from './registri.service'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('RegistriService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: RegistriService
  const tenantCreati: string[] = []
  let n = 0

  async function nuovoTenant(): Promise<string> {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `RS${suffisso}`, ragioneSociale: 'Registri SRL', country: 'IT' },
    })
    tenantCreati.push(t.id)
    return t.id
  }
  async function nuovaSede(tenantId: string, principale: boolean, nome: string) {
    return owner.rentriUnitaLocale.create({
      data: {
        tenantId,
        numIscrSito: `OP0001ABC${String(++n).padStart(6, '0')}-MI0001`,
        denominazione: nome,
        principale,
      },
    })
  }
  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    service = new RegistriService(app, loggerStub as never)
    const [r] = await owner.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow')
    const [a] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(a.u).toBe('wasteflow_app')
  })

  afterAll(async () => {
    await owner.activityLog.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.registroRifiuti.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.rentriUnitaLocale.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('assicuraRegistri concorrente: 6 chiamate parallele creano un solo registro per sede', async () => {
    const tenantId = await nuovoTenant()
    const principale = await nuovaSede(tenantId, true, 'Sede di Milano')
    const secondaria = await nuovaSede(tenantId, false, 'Sede di Torino')

    const esiti = await nelTenant(tenantId, () =>
      Promise.all(Array.from({ length: 6 }, () => service.assicuraRegistri(tenantId)))
    )

    const registri = await owner.registroRifiuti.findMany({ where: { tenantId } })
    expect(registri).toHaveLength(2)
    expect(registri.map(r => r.unitaLocaleId).sort()).toEqual([principale.id, secondaria.id].sort())
    expect(registri.every(r => r.updatedAt !== null)).toBe(true)
    // tutte le chiamate vedono lo stesso risultato
    for (const e of esiti) expect(e.map(v => v.id).sort()).toEqual(registri.map(r => r.id).sort())
    // un'altra azienda non li vede
    const altro = await nuovoTenant()
    expect(await nelTenant(altro, () => service.elenca(altro))).toHaveLength(0)
  })

  it('assicuraRegistri: senza contesto di richiesta funziona comunque (il tenant e impostato dalla transazione propria)', async () => {
    const tenantId = await nuovoTenant()
    await nuovaSede(tenantId, true, 'Sede unica')
    const viste = await service.assicuraRegistri(tenantId)
    expect(viste).toHaveLength(1)
    expect(await owner.registroRifiuti.count({ where: { tenantId } })).toBe(1)
  })

  it('assicuraRegistri: azienda senza sedi e senza registri → un solo registro senza sede, anche in parallelo', async () => {
    const tenantId = await nuovoTenant()
    await nelTenant(tenantId, () =>
      Promise.all(Array.from({ length: 6 }, () => service.assicuraRegistri(tenantId)))
    )
    const registri = await owner.registroRifiuti.findMany({ where: { tenantId } })
    expect(registri).toHaveLength(1)
    expect(registri[0].unitaLocaleId).toBeNull()
  })

  it('assicuraRegistri: lo scrive in ActivityLog quando lega il registro senza sede alla sede principale', async () => {
    const tenantId = await nuovoTenant()
    await nelTenant(tenantId, () => service.assicuraRegistri(tenantId))
    const [orfano] = await owner.registroRifiuti.findMany({ where: { tenantId } })
    expect(orfano.unitaLocaleId).toBeNull()

    const sede = await nuovaSede(tenantId, true, 'Sede principale')
    const viste = await nelTenant(tenantId, () => service.assicuraRegistri(tenantId))

    expect(viste).toHaveLength(1)
    expect(viste[0]).toMatchObject({
      id: orfano.id,
      unitaLocaleId: sede.id,
      numIscrSito: sede.numIscrSito,
      principale: true,
    })
    const registri = await owner.registroRifiuti.findMany({ where: { tenantId } })
    expect(registri).toHaveLength(1)
    expect(registri[0].unitaLocaleId).toBe(sede.id)
    const log = await owner.activityLog.findMany({
      where: { tenantId, action: 'REGISTRO_COLLEGATO_SEDE' },
    })
    expect(log).toHaveLength(1)
    expect(log[0].userId).toBeNull()
    expect(log[0].metadata).toMatchObject({ registroId: orfano.id, unitaLocaleId: sede.id })

    // seconda chiamata: nessuna nuova scrittura
    await nelTenant(tenantId, () => service.assicuraRegistri(tenantId))
    expect(
      await owner.activityLog.count({ where: { tenantId, action: 'REGISTRO_COLLEGATO_SEDE' } })
    ).toBe(1)
  })

  it('assicuraRegistri: il trigger impedisce di cambiare la sede di un registro già agganciato', async () => {
    const tenantId = await nuovoTenant()
    const a = await nuovaSede(tenantId, true, 'Sede A')
    const b = await nuovaSede(tenantId, false, 'Sede B')
    await nelTenant(tenantId, () => service.assicuraRegistri(tenantId))
    const registroA = await owner.registroRifiuti.findFirstOrThrow({
      where: { tenantId, unitaLocaleId: a.id },
    })
    // col ruolo app, nel contesto dell'azienda: la RLS lascia passare l'UPDATE, il trigger no
    await expect(
      nelTenant(tenantId, () =>
        app.registroRifiuti.update({ where: { id: registroA.id }, data: { unitaLocaleId: b.id } })
      )
    ).rejects.toThrow(/non si cambia dopo l'aggancio/)
    const dopo = await owner.registroRifiuti.findUniqueOrThrow({ where: { id: registroA.id } })
    expect(dopo.unitaLocaleId).toBe(a.id)
  })

  it('RLS: elenca, risolvi e sedeRentri col ruolo app vedono solo i registri dell azienda del contesto', async () => {
    const t1 = await nuovoTenant()
    const t2 = await nuovoTenant()
    const s1 = await nuovaSede(t1, true, 'Sede T1')
    await nuovaSede(t2, true, 'Sede T2')
    await nelTenant(t1, () => service.assicuraRegistri(t1))
    await nelTenant(t2, () => service.assicuraRegistri(t2))
    const r1 = await owner.registroRifiuti.findFirstOrThrow({ where: { tenantId: t1 } })
    const r2 = await owner.registroRifiuti.findFirstOrThrow({ where: { tenantId: t2 } })

    // dentro il contesto di t1 il registro di t2 non esiste, nemmeno chiedendolo per id
    expect(await nelTenant(t1, () => service.elenca(t1))).toHaveLength(1)
    await expect(nelTenant(t1, () => service.sedeRentri(t1, r2.id))).rejects.toMatchObject({
      name: 'RegistroNonTrovatoError',
    })
    expect(await nelTenant(t1, () => service.sedeRentri(t1, r1.id))).toEqual({
      numIscrSito: s1.numIscrSito,
      denominazione: 'Sede T1',
    })
    const risolto = await nelTenant(t1, () => app.$transaction(tx => service.risolvi(tx, t1)))
    expect(risolto.id).toBe(r1.id)
    await expect(
      nelTenant(t1, () => app.$transaction(tx => service.risolvi(tx, t1, r2.id)))
    ).rejects.toMatchObject({ name: 'RegistroNonTrovatoError' })
    // preparaRegistri su un registro che c'e' non scrive nulla
    const prima = await owner.registroRifiuti.count({ where: { tenantId: t1 } })
    await nelTenant(t1, () => service.preparaRegistri(t1, r1.id))
    await nelTenant(t1, () => service.preparaRegistri(t1))
    expect(await owner.registroRifiuti.count({ where: { tenantId: t1 } })).toBe(prima)
  })

  it('RLS: contesto di un altra azienda e richiesta per t1 → errore e nessuna riga creata in t1 (il service non sovrascrive il tenant)', async () => {
    const t1 = await nuovoTenant()
    const t2 = await nuovoTenant()
    await nuovaSede(t1, true, 'Sede T1')
    await expect(nelTenant(t2, () => service.assicuraRegistri(t1))).rejects.toThrow(/non coincide/)
    await expect(nelTenant(t2, () => service.preparaRegistri(t1))).rejects.toThrow(/non coincide/)
    expect(await owner.registroRifiuti.count({ where: { tenantId: t1 } })).toBe(0)
    expect(await owner.activityLog.count({ where: { tenantId: t1 } })).toBe(0)
    expect(await owner.registroRifiuti.count({ where: { tenantId: t2 } })).toBe(0)
  })

  it('preparaRegistri fuori contesto (job): lavora in TenantContext.run e crea il registro predefinito', async () => {
    const tenantId = await nuovoTenant()
    await nuovaSede(tenantId, true, 'Sede unica')
    await service.preparaRegistri(tenantId)
    expect(await owner.registroRifiuti.count({ where: { tenantId } })).toBe(1)
  })

  it('il solo lock basta: con un unico tentativo (nessun retry su P2002) 6 chiamate parallele danno comunque un registro per sede', async () => {
    const senzaRetry = new RegistriService(app, loggerStub as never, 1)
    const tenantId = await nuovoTenant()
    await nuovaSede(tenantId, true, 'Sede A')
    await nuovaSede(tenantId, false, 'Sede B')
    await nelTenant(tenantId, () =>
      Promise.all(Array.from({ length: 6 }, () => senzaRetry.assicuraRegistri(tenantId)))
    )
    expect(await owner.registroRifiuti.count({ where: { tenantId } })).toBe(2)
  })
})
