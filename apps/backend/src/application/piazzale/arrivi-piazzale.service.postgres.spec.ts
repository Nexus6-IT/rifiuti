/**
 * Isolamento dell'elenco dei FIR in arrivo al piazzale contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS ENABLE+FORCE soggetta alle policy), dentro il `TenantContext` dell'azienda.
 *
 * Il proprietario (`wasteflow`, superuser) prepara aziende e utente e fa la pulizia per `tenantId`;
 * i FIR si salvano con `FIRPrismaRepository.save` dentro `TenantContext.run`.
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
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { MudIntegrazioniService } from '../mud/mud-integrazioni.service'
import { ArriviPiazzaleService } from './arrivi-piazzale.service'

const loggerStub = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} }

describe('ArriviPiazzaleService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let servizio: ArriviPiazzaleService
  let repo: FIRPrismaRepository
  const utenti = new Map<string, string>()
  let cerCreato = false
  const tenantCreati: string[] = []
  const firCreati: string[] = []
  let n = 0

  const nelTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
    TenantContext.run({ tenantId }, async () => await fn())

  async function azienda(nome: string) {
    const suffisso = `${Date.now()}${++n}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `PZ${suffisso}`, ragioneSociale: nome, country: 'IT' },
    })
    tenantCreati.push(t.id)
    // il produttore del FIR e' un utente dello stesso tenant: sotto RLS un altro non si vede
    const u = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `keycloak-pz-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `pz-${suffisso}@example.com`,
        role: 'OPERATOR',
      },
    })
    utenti.set(t.id, u.id)
    return t
  }

  /** FIR IN_TRANSITO del tenant indicato, con il destinatario che ha la P.IVA indicata. */
  async function firInTransito(tenantId: string, partitaIvaDestinatario: string) {
    const fir = FIR.create({
      produttoreId: '11111111-1111-4111-8111-111111111111',
      rifiuto: { cerCode: '999904', quantita: 100 },
      trasportatoreId: '22222222-2222-4222-8222-222222222222',
      destinatarioId: '33333333-3333-4333-8333-333333333333',
      destinatario: {
        ragioneSociale: 'Impianto di destino SRL',
        partitaIva: partitaIvaDestinatario,
      },
      tenantId,
      creatoDaUserId: utenti.get(tenantId)!,
    })
    await nelTenant(tenantId, () => repo.save(fir))
    firCreati.push(fir.id)
    await owner.fIR.update({ where: { id: fir.id }, data: { status: 'AWAITING_RECEIVER' } })
    return fir.id
  }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    repo = new FIRPrismaRepository(app, owner as never)
    const mud = new MudIntegrazioniService(app, {} as any, loggerStub as any)
    servizio = new ArriviPiazzaleService(repo, mud, app)
    const [r] = await app.$queryRaw<{ u: string }[]>`SELECT current_user AS u`
    expect(r.u).toBe('wasteflow_app')

    cerCreato = (await owner.cERCode.count({ where: { code: '999904' } })) === 0
    await owner.cERCode.upsert({
      where: { code: '999904' },
      create: { code: '999904', description: 'CER di test', category: '99', subcategory: '' },
      update: {},
    })
  })

  afterAll(async () => {
    if (firCreati.length > 0) {
      await owner.fIRSignature.deleteMany({ where: { firId: { in: firCreati } } })
    }
    await owner.fIR.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.user.deleteMany({ where: { tenantId: { in: tenantCreati } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    if (cerCreato) await owner.cERCode.deleteMany({ where: { code: '999904' } })
    await app.onModuleDestroy()
    await owner.$disconnect()
  })

  it('A non vede il FIR di B anche se il destinatario ha la P.IVA di A', async () => {
    const a = await azienda('Impianto A SRL')
    const b = await azienda('Produttore B SRL')
    const firDiB = await firInTransito(b.id, a.partitaIva)

    const daA = await nelTenant(a.id, () => servizio.elenca(a.id))

    expect(daA.codiciAziendaConfigurati).toBe(true)
    expect(daA.arrivi.map(f => f.id)).not.toContain(firDiB)
    expect(daA.arrivi).toEqual([])
  })

  it('dentro il contesto di A, elenca(B) non legge nessun FIR di B (RLS)', async () => {
    const a = await azienda('Contesto A SRL')
    const b = await azienda('Destinatario B SRL')
    const firDiB = await firInTransito(b.id, b.partitaIva)

    const daContestoA = await nelTenant(a.id, () => servizio.elenca(b.id))
    expect(daContestoA.arrivi).toEqual([])

    // controprova: nel contesto di B lo stesso FIR c'e', quindi il vuoto sopra viene dalla RLS
    const daContestoB = await nelTenant(b.id, () => servizio.elenca(b.id))
    expect(daContestoB.arrivi.map(f => f.id)).toEqual([firDiB])
  })

  it('B vede il proprio FIR solo se il destinatario è B', async () => {
    const a = await azienda('Altro impianto A SRL')
    const b = await azienda('Impianto B SRL')
    const proprio = await firInTransito(b.id, b.partitaIva)
    await firInTransito(b.id, a.partitaIva)

    const daB = await nelTenant(b.id, () => servizio.elenca(b.id))

    expect(daB.azienda).toEqual({ id: b.id, ragioneSociale: 'Impianto B SRL' })
    expect(daB.arrivi.map(f => f.id)).toEqual([proprio])
  })
})
