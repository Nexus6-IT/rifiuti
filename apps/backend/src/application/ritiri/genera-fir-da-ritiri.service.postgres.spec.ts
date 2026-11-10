/**
 * Generazione in serie dei FIR dai ritiri (4.7, T12) contro un Postgres reale, collegato COME
 * `wasteflow_app` (RLS attiva). Il proprietario prepara aziende, anagrafiche e ritiri e legge.
 * La pulizia cancella SOLO le aziende create qui, per id esatto.
 *
 * Eseguire con `npm run test:postgres` (o jest con `jest.postgres.config.js`).
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'
import { eDatabaseDiTestLocale } from '../../test-support/database-di-test'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55438/wasteflow_ci?schema=public'
const NOME_APP = 'ritiri-genera-t12'
// I servizi dell'applicazione leggono queste variabili, come in produzione. L'application_name
// permette alla barriera di riconoscere le sessioni del servizio in pg_stat_activity.
process.env.DATABASE_URL =
  urlComeRuolo(
    'wasteflow_app',
    process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
    urlProprietario
  ) + `&application_name=${NOME_APP}`
process.env.DATABASE_URL_SISTEMA = urlComeRuolo(
  'wasteflow_sistema',
  process.env.DB_SISTEMA_PASSWORD ?? 'wasteflow_sistema_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
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
import { CreateFIRUseCase } from '../fir/use-cases/create-fir.use-case'
import { creaDittaConRuolo, partitaIvaUnica } from '../../test-support/anagrafiche-di-test'
import { RitiroConFirError } from './errori-ritiri'
import { RitiriService } from './ritiri.service'
import { GeneraFirDaRitiriService, type EsitoGenerazioneRiga } from './genera-fir-da-ritiri.service'

const CER_NON_VALIDO = '99 99 99'

describe('Generazione FIR da ritiri — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let sistema: PrismaSistemaService
  let genera: GeneraFirDaRitiriService
  let ritiri: RitiriService
  const tenantCreati: string[] = []
  const cerFinto = {
    exists: async (c: string) => c !== CER_NON_VALIDO,
    isUtilizzabilePerNuovoFormulario: async () => true,
  } as unknown as ICERRepository

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
  const lancia = (a: Azienda, ids: string[]) => genera.genera(a.t, a.utente, ids)
  const contaEsiti = (righe: EsitoGenerazioneRiga[]) =>
    righe.reduce<Record<string, number>>((m, r) => ({ ...m, [r.esito]: (m[r.esito] ?? 0) + 1 }), {})
  const firDi = (ids: string[]) => owner.fIR.count({ where: { ritiroId: { in: ids } } })

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
    const repo = new RitiriRepository()
    genera = new GeneraFirDaRitiriService(app, repo, creaFir)
    ritiri = new RitiriService(app, repo, cerFinto)
  })

  afterAll(async () => {
    if (tenantCreati.length > 0) {
      const where = { tenantId: { in: tenantCreati } }
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

  it('100 ritiri con 1 CER non valido: 99 CREATO e 1 ERRORE, nessun rollback degli altri', async () => {
    const a = await azienda()
    const ids = await creaRitiri(a, 100, i => (i === 41 ? { cerCode: CER_NON_VALIDO } : {}))
    const { righe } = await lancia(a, ids)
    expect(righe).toHaveLength(100)
    expect(contaEsiti(righe)).toEqual({ CREATO: 99, ERRORE: 1 })
    const errore = righe.find(r => r.esito === 'ERRORE')
    expect(errore).toMatchObject({ codice: 'CER_NON_VALIDO', ritiroId: ids[41] })
    // I messaggi non contengono id.
    expect((errore as { messaggio: string }).messaggio).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(await firDi(ids)).toBe(99)
    // Nessuna trasmissione: tutte bozze.
    const stati = await owner.fIR.findMany({
      where: { ritiroId: { in: ids } },
      select: { status: true },
    })
    expect(new Set(stati.map(s => s.status))).toEqual(new Set(['DRAFT']))
  })

  it('ordine fisso: data, mezzo, ordine nel giro, creazione', async () => {
    const a = await azienda()
    const m = await owner.automezzo.create({
      data: { tenantId: a.t, targa: 'ZZ999ZZ', creatoDa: a.utente },
    })
    const [tardi, senzaOrdine, secondo, primo] = [
      ...(await creaRitiri(a, 1, { dataPrevista: '2026-12-05', ordineGiro: 1 })),
      ...(await creaRitiri(a, 1, { dataPrevista: '2026-12-02', ordineGiro: null })),
      ...(await creaRitiri(a, 1, { dataPrevista: '2026-12-02', ordineGiro: 2 })),
      ...(await creaRitiri(a, 1, { dataPrevista: '2026-12-02', ordineGiro: 1 })),
    ]
    void m
    const { righe } = await lancia(a, [tardi, senzaOrdine, secondo, primo])
    expect(righe.map(r => r.ritiroId)).toEqual([primo, secondo, senzaOrdine, tardi])
  })

  it('stesso lotto rilanciato: 100 GIA_GENERATO e `firs` invariato', async () => {
    const a = await azienda()
    const ids = await creaRitiri(a, 100)
    const primo = await lancia(a, ids)
    expect(contaEsiti(primo.righe)).toEqual({ CREATO: 100 })
    const secondo = await lancia(a, ids)
    expect(contaEsiti(secondo.righe)).toEqual({ GIA_GENERATO: 100 })
    expect(await firDi(ids)).toBe(100)
    const firPrimo = new Map(primo.righe.map(r => [r.ritiroId, (r as { firId: string }).firId]))
    for (const r of secondo.righe) {
      expect((r as { firId: string }).firId).toBe(firPrimo.get(r.ritiroId))
    }
  })

  it('due lotti sovrapposti in parallelo: un solo FIR per ritiro', async () => {
    const a = await azienda()
    const ids = await creaRitiri(a, 30)
    const [x, y] = await Promise.all([lancia(a, ids), lancia(a, [...ids].reverse())])
    expect(await firDi(ids)).toBe(30)
    for (const id of ids) {
      const esiti = [x, y].map(l => l.righe.find(r => r.ritiroId === id)!)
      expect(esiti.every(e => e.esito === 'CREATO' || e.esito === 'GIA_GENERATO')).toBe(true)
      expect(esiti.filter(e => e.esito === 'CREATO').length).toBeLessThanOrEqual(1)
      const firIds = new Set(esiti.map(e => (e as { firId: string }).firId))
      expect(firIds.size).toBe(1)
    }
  })

  it('tenant sbagliato: RITIRO_NON_TROVATO e nessuna scrittura', async () => {
    const a = await azienda()
    const b = await azienda()
    const ids = await creaRitiri(a, 3)
    const { righe } = await lancia(b, ids)
    expect(righe.every(r => r.esito === 'ERRORE' && r.codice === 'RITIRO_NON_TROVATO')).toBe(true)
    expect(await firDi(ids)).toBe(0)
  })

  it('ritiro annullato: ERRORE RITIRO_NON_PROGRAMMATO, gli altri proseguono', async () => {
    const a = await azienda()
    const ids = await creaRitiri(a, 3, i => (i === 1 ? { stato: 'ANNULLATO' } : {}))
    const { righe } = await lancia(a, ids)
    expect(righe.find(r => r.ritiroId === ids[1])).toMatchObject({
      esito: 'ERRORE',
      codice: 'RITIRO_NON_PROGRAMMATO',
    })
    expect(contaEsiti(righe)).toEqual({ CREATO: 2, ERRORE: 1 })
  })

  it('provenienza o tipo di tratta nulli: ANAGRAFICA_MANCANTE (la creazione manuale non ha default)', async () => {
    const a = await azienda()
    const ids = await creaRitiri(a, 2, i =>
      i === 0 ? { provenienza: null } : { tipoTratta: null }
    )
    const { righe } = await lancia(a, ids)
    expect(righe.every(r => r.esito === 'ERRORE' && r.codice === 'ANAGRAFICA_MANCANTE')).toBe(true)
    expect(await firDi(ids)).toBe(0)
  })

  it('rifiuta lotti vuoti, oltre 100 o con id non validi', async () => {
    const a = await azienda()
    await expect(lancia(a, [])).rejects.toThrow()
    await expect(
      lancia(
        a,
        Array.from({ length: 101 }, () => crypto.randomUUID())
      )
    ).rejects.toThrow()
    await expect(lancia(a, ['non-un-uuid'])).rejects.toThrow()
  })

  it('FIR annullato: il ritiro si rigenera', async () => {
    const a = await azienda()
    const [id] = await creaRitiri(a, 1)
    const primo = await lancia(a, [id])
    await owner.fIR.update({
      where: { id: (primo.righe[0] as { firId: string }).firId },
      data: { status: 'CANCELLED' },
    })
    const secondo = await lancia(a, [id])
    expect(secondo.righe[0].esito).toBe('CREATO')
    expect(await firDi([id])).toBe(2)
  })

  // --- corsa annullo <-> generazione (barriera su pg_stat_activity) ------------------------

  /** Sessioni del servizio ferme su un lock: la barriera che dice "sono entrambe in coda". */
  async function inAttesaDiLock(): Promise<number> {
    const r = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity
      WHERE application_name = ${NOME_APP} AND wait_event_type = 'Lock'
        AND datname = current_database()`
    return Number(r[0].n)
  }
  async function attendi(n: number): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if ((await inAttesaDiLock()) >= n) return
      await new Promise(r => setTimeout(r, 50))
    }
    throw new Error(`barriera: meno di ${n} sessioni in attesa di lock dopo 10 s`)
  }

  /**
   * Tiene il lock sul ritiro (FOR UPDATE) con il proprietario, mette in coda le due operazioni
   * nell'ordine voluto, aspetta che siano davvero in coda e rilascia.
   */
  async function corsa(a: Azienda, id: string, primaLaGenerazione: boolean) {
    let rilascia!: () => void
    const rilasciato = new Promise<void>(r => (rilascia = r))
    let bloccato!: () => void
    const pronto = new Promise<void>(r => (bloccato = r))
    const tenuto = owner.$transaction(
      async tx => {
        await tx.$queryRaw`SELECT 1 FROM ritiri WHERE id = ${id}::uuid FOR UPDATE`
        bloccato()
        await rilasciato
      },
      { timeout: 60_000, maxWait: 10_000 }
    )
    await pronto
    const avviaGenerazione = () => lancia(a, [id])
    const avviaAnnullo = () =>
      nelTenant(a.t, () => ritiri.annulla(a.t, a.utente, id, 'annullo in corsa', 1)).then(
        v => ({ ok: true as const, v }),
        (e: unknown) => ({ ok: false as const, e })
      )
    let gen: ReturnType<typeof avviaGenerazione>
    let ann: ReturnType<typeof avviaAnnullo>
    if (primaLaGenerazione) {
      gen = avviaGenerazione()
      await attendi(1)
      ann = avviaAnnullo()
      await attendi(2)
    } else {
      ann = avviaAnnullo()
      await attendi(1)
      gen = avviaGenerazione()
      await attendi(2)
    }
    rilascia()
    await tenuto
    return { gen: await gen, ann: await ann }
  }

  it("corsa, generazione in coda per prima: nasce il FIR e l'annullo risponde 409 RITIRO_CON_FIR", async () => {
    const a = await azienda()
    const [id] = await creaRitiri(a, 1)
    const { gen, ann } = await corsa(a, id, true)
    expect(gen.righe[0].esito).toBe('CREATO')
    expect(ann.ok).toBe(false)
    expect(!ann.ok && ann.e).toBeInstanceOf(RitiroConFirError)
    expect(await firDi([id])).toBe(1)
    expect((await owner.ritiro.findUniqueOrThrow({ where: { id } })).stato).toBe('PROGRAMMATO')
  })

  it('corsa, annullo in coda per primo: ANNULLATO senza FIR e generazione ERRORE (mai un 500)', async () => {
    const a = await azienda()
    const [id] = await creaRitiri(a, 1)
    const { gen, ann } = await corsa(a, id, false)
    expect(ann.ok).toBe(true)
    expect(gen.righe[0]).toMatchObject({ esito: 'ERRORE', codice: 'RITIRO_NON_PROGRAMMATO' })
    expect(await firDi([id])).toBe(0)
    expect((await owner.ritiro.findUniqueOrThrow({ where: { id } })).stato).toBe('ANNULLATO')
  })
})
