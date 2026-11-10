/**
 * Emissione in serie dei FIR nati dai ritiri (4.7, T18, P7 §8) contro un Postgres reale, collegato
 * COME `wasteflow_app` (RLS attiva). Si usano i pezzi veri: generazione da ritiri, `EmettiFIRUseCase`,
 * repository dei FIR e delle firme, `TrasmettiFIRSecondoModalitaUseCase` e `RENTRISyncQueue`
 * (con un BullMQ finto che applica la stessa regola dei jobId: un job vivo non si riaccoda).
 * Il proprietario prepara aziende e ritiri e legge; la pulizia cancella SOLO le aziende create qui.
 *
 * Eseguire con `npm run test:postgres` (o jest con `jest.postgres.config.js`).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)
process.env.DATABASE_URL_SISTEMA = urlComeRuolo(
  'wasteflow_sistema',
  process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { LoggerService } from '../../core/logger/logger.service'
import { ICERRepository } from '../../domain/cer/repositories/cer-repository.interface'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { ProduttorePrismaRepository } from '../../infrastructure/persistence/produttore-prisma.repository'
import { TrasportatorePrismaRepository } from '../../infrastructure/persistence/trasportatore-prisma.repository'
import { DestinatarioPrismaRepository } from '../../infrastructure/persistence/destinatario-prisma.repository'
import { RitiriRepository } from '../../infrastructure/persistence/ritiri.repository'
import { SignatureFIRRepository } from '../../infrastructure/signatures/signature-fir.repository'
import { RENTRISyncQueue } from '../../infrastructure/queue/rentri-sync.queue'
import { CreateFIRUseCase } from '../fir/use-cases/create-fir.use-case'
import { EmettiFIRUseCase } from '../fir/use-cases/emetti-fir.use-case'
import { EmettiFIRCommand } from '../fir/commands/emetti-fir.command'
import { DigitalSignatureService } from '../signatures/digital-signature.service'
import { TrasmettiFIRSecondoModalitaUseCase } from '../rentri/trasmetti-fir-secondo-modalita.use-case'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { GeneraFirDaRitiriService } from './genera-fir-da-ritiri.service'

type Modalita = 'AUTOMATICA' | 'MANUALE'
const N = 20

/** BullMQ finto: stessa semantica dei jobId (`add` con id esistente non crea un secondo job). */
class BullFinto {
  readonly jobs = new Map<string, { id: string; data: unknown }>()
  adds = 0
  async getJob(id: string) {
    const j = this.jobs.get(id)
    return j && { ...j, getState: async () => 'waiting', remove: async () => this.jobs.delete(id) }
  }
  async add(_nome: string, data: unknown, opts: { jobId: string }) {
    this.adds++
    if (!this.jobs.has(opts.jobId)) this.jobs.set(opts.jobId, { id: opts.jobId, data })
    return { id: opts.jobId }
  }
}

describe('Emissione in serie dei FIR da ritiri — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let genera: GeneraFirDaRitiriService
  let emetti: EmettiFIRUseCase
  let bull: BullFinto
  let modalita: Modalita = 'AUTOMATICA'
  const tenantCreati: string[] = []
  const cerFinto = {
    exists: async () => true,
    isUtilizzabilePerNuovoFormulario: async () => true,
  } as unknown as ICERRepository
  const logger = {
    setContext: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  } as unknown as LoggerService

  interface Azienda {
    t: string
    utente: string
    produttore: { ruoloId: string; sedeId: string }
    trasportatore: { ruoloId: string; sedeId: string }
    destinatario: { ruoloId: string; sedeId: string }
  }

  async function azienda(): Promise<Azienda> {
    const t = (
      await owner.tenant.create({
        data: { partitaIva: partitaIvaUnica(), ragioneSociale: 'Genera SRL', country: 'IT' },
      })
    ).id
    tenantCreati.push(t)
    const sigla = partitaIvaUnica()
    const utente = (
      await owner.user.create({
        data: {
          tenantId: t,
          keycloakId: `kc-gen-${sigla}`,
          fiscalCode: `GEN${sigla}`.slice(0, 16),
          firstName: 'Prova',
          lastName: 'Genera',
          email: `gen-${sigla}@example.test`,
          role: 'ADMIN',
        },
      })
    ).id
    return {
      t,
      utente,
      produttore: await creaDittaConRuolo(owner, t, 'PRODUTTORE'),
      trasportatore: await creaDittaConRuolo(owner, t, 'TRASPORTATORE'),
      destinatario: await creaDittaConRuolo(owner, t, 'DESTINATARIO'),
    }
  }

  interface Extra {
    cerCode?: string
    stato?: 'PROGRAMMATO' | 'ANNULLATO'
    provenienza?: 'URBANO' | 'SPECIALE' | null
    tipoTratta?: 'TERRESTRE' | null
    dataPrevista?: string
    ordineGiro?: number | null
  }

  async function creaRitiri(a: Azienda, n: number, extra: Extra | ((i: number) => Extra) = {}) {
    const dati = Array.from({ length: n }, (_, i) => {
      const e = typeof extra === 'function' ? extra(i) : extra
      return {
        id: crypto.randomUUID(),
        tenantId: a.t,
        dataPrevista: new Date(e.dataPrevista ?? '2026-12-01'),
        ordineGiro: e.ordineGiro === undefined ? i + 1 : e.ordineGiro,
        produttoreId: a.produttore.ruoloId,
        produttoreSedeId: a.produttore.sedeId,
        trasportatoreId: a.trasportatore.ruoloId,
        destinatarioId: a.destinatario.ruoloId,
        destinatarioSedeId: a.destinatario.sedeId,
        cerCode: e.cerCode ?? '15 01 01',
        descrizione: 'Imballaggi',
        quantitaPresunta: '100.00',
        tipoOperazione: 'RECOVERY' as const,
        codiceOperazione: 'R13',
        provenienza: e.provenienza === undefined ? ('SPECIALE' as const) : e.provenienza,
        tipoTratta: e.tipoTratta === undefined ? ('TERRESTRE' as const) : e.tipoTratta,
        creatoDa: a.utente,
        ...(e.stato === 'ANNULLATO' ? { stato: 'ANNULLATO' as const, motivo: 'annullato' } : {}),
      }
    })
    await owner.ritiro.createMany({ data: dati })
    return dati.map(d => d.id)
  }

  const nelTenant = <T>(t: string, fn: () => Promise<T>): Promise<T> =>
    TenantContext.run({ tenantId: t }, async () => await fn())

  /** Genera le bozze e le emette una alla volta, nell'ordine di generazione. */
  async function bozzeEmesse(a: Azienda) {
    const ids = await creaRitiri(a, N)
    const { righe } = await genera.genera(a.t, a.utente, ids)
    const firIds = righe.flatMap(r => (r.esito === 'ERRORE' ? [] : [r.firId]))
    expect(firIds).toHaveLength(N)
    expect(righe.every(r => r.esito === 'CREATO')).toBe(true)
    for (const firId of firIds) {
      const r = await nelTenant(a.t, () =>
        emetti.execute(new EmettiFIRCommand(firId, a.utente, 'Prova Genera'))
      )
      expect(r.isSuccess).toBe(true)
    }
    return firIds
  }

  const numeroDi = async (firIds: string[]) => {
    const righe = await owner.fIR.findMany({
      where: { id: { in: firIds } },
      select: { id: true, firNumber: true, status: true },
    })
    const perId = new Map(righe.map(r => [r.id, r]))
    return firIds.map(id => perId.get(id)!)
  }

  beforeAll(async () => {
    expect(eDatabaseDiTestLocale(urlProprietario)).toBe(true)
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    sistema = new PrismaSistemaService()
    const repoFir = new FIRPrismaRepository(app, sistema)
    const creaFir = new CreateFIRUseCase(
      repoFir,
      cerFinto,
      new ProduttorePrismaRepository(app),
      new TrasportatorePrismaRepository(app),
      new DestinatarioPrismaRepository(app)
    )
    genera = new GeneraFirDaRitiriService(app, new RitiriRepository(), creaFir)

    bull = new BullFinto()
    const coda = new RENTRISyncQueue({ get: () => undefined } as never, logger)
    ;(coda as unknown as { queue: BullFinto }).queue = bull
    const trasmissione = new TrasmettiFIRSecondoModalitaUseCase(
      {
        getForTenant: async () => ({ modalitaLegame: modalita, certificatoConfigurato: true }),
      } as never,
      coda,
      repoFir,
      logger,
      { moduliAttivi: async () => ['rentri'] } as never
    )
    emetti = new EmettiFIRUseCase(
      repoFir,
      new SignatureFIRRepository(app, sistema, logger),
      new DigitalSignatureService(logger),
      trasmissione,
      logger
    )
  })

  beforeEach(() => {
    bull.jobs.clear()
    bull.adds = 0
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const where = { tenantId: { in: tenantCreati } }
      await owner.fIRSignature.deleteMany({ where })
      await owner.activityLog.deleteMany({ where })
      await owner.fIR.deleteMany({ where })
      await owner.ritiro.deleteMany({ where })
      await owner.automezzo.deleteMany({ where })
      await owner.produttore.deleteMany({ where })
      await owner.trasportatore.deleteMany({ where })
      await owner.destinatario.deleteMany({ where })
      await owner.sedeDitta.deleteMany({ where })
      await owner.ditta.deleteMany({ where })
      await owner.user.deleteMany({ where })
      await owner.tenant.deleteMany({ where: { id: { in: tenantCreati } } })
    }
    await Promise.all([owner.$disconnect(), app?.onModuleDestroy(), sistema?.onModuleDestroy()])
  })

  it('20 bozze da ritiri emesse in ordine: numeri consecutivi nell’ordine di emissione', async () => {
    modalita = 'MANUALE'
    const a = await azienda()
    const firIds = await bozzeEmesse(a)
    const fir = await numeroDi(firIds)
    expect(fir.every(f => f.status !== 'DRAFT' && f.firNumber)).toBe(true)
    const numeri = fir.map(f => Number((f.firNumber ?? '').split('-').pop()))
    expect(numeri.every(Number.isInteger)).toBe(true)
    expect(numeri).toEqual(Array.from({ length: N }, (_, i) => numeri[0] + i))
    expect(new Set(fir.map(f => f.firNumber)).size).toBe(N)
  })

  it('AUTOMATICA: 20 job sync-<id>; una seconda emissione non aggiunge job né numeri', async () => {
    modalita = 'AUTOMATICA'
    const a = await azienda()
    const firIds = await bozzeEmesse(a)
    expect([...bull.jobs.keys()].sort()).toEqual(firIds.map(id => `sync-${id}`).sort())
    expect(bull.adds).toBe(N)
    const prima = (await numeroDi(firIds)).map(f => f.firNumber)

    // Seconda emissione degli stessi FIR: il ciclo di vita la rifiuta, nessun job nuovo.
    for (const firId of firIds) {
      await nelTenant(a.t, () =>
        emetti.execute(new EmettiFIRCommand(firId, a.utente, 'Prova Genera')).catch(() => null)
      )
    }
    expect(bull.jobs.size).toBe(N)
    expect(bull.adds).toBe(N)
    expect((await numeroDi(firIds)).map(f => f.firNumber)).toEqual(prima)
  })

  it('MANUALE: nessun job accodato', async () => {
    modalita = 'MANUALE'
    const a = await azienda()
    await bozzeEmesse(a)
    expect(bull.jobs.size).toBe(0)
    expect(bull.adds).toBe(0)
  })
})
