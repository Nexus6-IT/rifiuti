/**
 * PROVA DEL MECCANISMO "tenant per transazione" su Prisma 5.22 e Postgres reale.
 *
 * Ogni operazione del client esteso, con un tenant nello store del
 * TenantContext, deve eseguire `set_config('app.tenant_id', <tenant>, true)`
 * nella STESSA transazione dell'operazione. Il pool e' forzato a una sola
 * connessione (`connection_limit=1`) per rendere evidente ogni perdita di
 * valore fra un'operazione e la successiva.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { Prisma, PrismaClient } from '@prisma/client'
import { TenantContext } from '../../core/context/tenant-context'
import { rlsExtension } from './prisma-rls.extension'
import { estensioneTenantTransazione } from './prisma-tenant-transazione'

const urlBase =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
const conUnaConnessione = (url: string) =>
  `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`

const base = new PrismaClient({
  datasources: { db: { url: conUnaConnessione(urlBase) } },
  log: [{ emit: 'event', level: 'query' }],
})
const client = base.$extends(estensioneTenantTransazione(base))

// Seconda connessione indipendente, per osservare i lock dall'esterno.
const secondo = new PrismaClient({ datasources: { db: { url: urlBase } } })

const queryLog: string[] = []
base.$on('query', e => {
  queryLog.push(e.query)
})

// Gli eventi 'query' di Prisma arrivano in modo asincrono, dopo che la query e'
// gia' tornata: azzerare o leggere subito il log corre contro la loro consegna.
// Si aspetta quindi che il log sia quiescente (nessuna voce nuova per
// FINESTRA_QUIESCENZA_MS), con un tetto, prima di azzerarlo e prima di leggerlo.
const FINESTRA_QUIESCENZA_MS = 150
const TETTO_ATTESA_MS = 3000
const logQuiescente = async (): Promise<string[]> => {
  const inizio = Date.now()
  let lunghezza = queryLog.length
  let ultimaVariazione = Date.now()
  while (Date.now() - ultimaVariazione < FINESTRA_QUIESCENZA_MS) {
    if (Date.now() - inizio > TETTO_ATTESA_MS) break
    await new Promise(r => setTimeout(r, 20))
    if (queryLog.length !== lunghezza) {
      lunghezza = queryLog.length
      ultimaVariazione = Date.now()
    }
  }
  return [...queryLog]
}
const azzeraLog = async () => {
  await logQuiescente()
  queryLog.length = 0
}

const leggiTenant = async (c: { $queryRaw: PrismaClient['$queryRaw'] } = client) => {
  const righe = await c.$queryRaw<
    { v: string | null }[]
  >`SELECT current_setting('app.tenant_id', true) AS v`
  return righe[0].v ?? ''
}

describe('Tenant per transazione (Postgres reale, connection_limit=1)', () => {
  beforeEach(async () => {
    await azzeraLog()
  })

  afterAll(async () => {
    await base.$disconnect()
    await secondo.$disconnect()
  })

  it('operazione su modello con tenant nel contesto: current_setting vede il tenant', async () => {
    await TenantContext.run({ tenantId: 'tenant-modello' }, async () => {
      await client.tenant.count()
    })
    const sql = (await logQuiescente()).map(q => q.trim())
    const i = sql.findIndex(q => q.includes('set_config'))
    expect(i).toBeGreaterThan(0)
    expect(sql[i - 1]).toBe('BEGIN')
    expect(sql[i + 1]).toMatch(/count|SELECT/i)
    expect(sql[i + 1]).toContain('"public"."tenants"')
    expect(sql[i + 2]).toBe('COMMIT')
  })

  it('raw query fuori transazione: set_config applicato', async () => {
    const visto = await TenantContext.run({ tenantId: 'tenant-raw' }, () => leggiTenant())
    expect(visto).toBe('tenant-raw')
    const esito = await TenantContext.run({ tenantId: 'tenant-exec' }, async () => {
      await client.$executeRaw`SELECT 1`
      return leggiTenant()
    })
    expect(esito).toBe('tenant-exec')
  })

  it('connessione riusata: A poi B poi senza contesto → A, B, vuoto', async () => {
    const a = await TenantContext.run({ tenantId: 'A' }, () => leggiTenant())
    const b = await TenantContext.run({ tenantId: 'B' }, () => leggiTenant())
    const nessuno = await leggiTenant()
    expect([a, b, nessuno]).toEqual(['A', 'B', ''])
  })

  it('senza tenant nel contesto: nessuna transazione aggiunta (anche con CURRENT_TENANT_ID)', async () => {
    const prima = process.env.CURRENT_TENANT_ID
    process.env.CURRENT_TENANT_ID = 'tenant-da-env'
    try {
      await client.tenant.count()
      expect(await leggiTenant()).toBe('')
    } finally {
      if (prima === undefined) delete process.env.CURRENT_TENANT_ID
      else process.env.CURRENT_TENANT_ID = prima
    }
    const sql = (await logQuiescente()).map(q => q.trim())
    expect(sql.some(q => q === 'BEGIN' || q === 'COMMIT')).toBe(false)
    expect(sql.some(q => q.includes('set_config'))).toBe(false)
  })

  it('transazione interattiva: set_config primo statement, operazioni del tx senza transazioni annidate, advisory lock nella stessa transazione', async () => {
    const chiave = 424242
    let provaDurante: boolean | undefined
    let vistoNelTx = ''
    await TenantContext.run({ tenantId: 'tenant-int' }, async () => {
      await client.$transaction(
        async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${chiave})`
          vistoNelTx = await leggiTenant(tx)
          await tx.tenant.count()
          const r = await secondo.$queryRaw<
            { ok: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(${chiave}) AS ok`
          provaDurante = r[0].ok
        },
        { maxWait: 5000, timeout: 10000 }
      )
    })
    expect(vistoNelTx).toBe('tenant-int')
    // il lock e' tenuto dalla transazione interattiva: dal secondo client non si ottiene
    expect(provaDurante).toBe(false)

    const sql = (await logQuiescente()).map(q => q.trim())
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('set_config')
    expect(sql[2]).toContain('pg_advisory_xact_lock')
    // una sola transazione: un BEGIN e un COMMIT in tutto
    expect(sql.filter(q => q === 'BEGIN')).toHaveLength(1)
    expect(sql.filter(q => q === 'COMMIT')).toHaveLength(1)
    expect(sql.filter(q => q.includes('set_config'))).toHaveLength(1)
    // a transazione chiusa il lock e il tenant non sono piu' sulla connessione
    expect(await leggiTenant()).toBe('')
    const dopo = await secondo.$queryRaw<
      { ok: boolean }[]
    >`SELECT pg_try_advisory_xact_lock(${chiave}) AS ok`
    expect(dopo[0].ok).toBe(true)
  })

  it('transazione batch: tenant visibile in tutte le operazioni', async () => {
    const [r1, r2] = await TenantContext.run({ tenantId: 'tenant-batch' }, () =>
      client.$transaction([
        client.$queryRaw<{ v: string }[]>`SELECT current_setting('app.tenant_id', true) AS v`,
        client.$queryRaw<{ v: string }[]>`SELECT current_setting('app.tenant_id', true) AS v`,
      ])
    )
    expect(r1[0].v).toBe('tenant-batch')
    expect(r2[0].v).toBe('tenant-batch')
    // un'unica transazione, con il set_config come primo statement
    const sql = (await logQuiescente()).map(q => q.trim())
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('set_config')
    expect(sql.filter(q => q === 'BEGIN')).toHaveLength(1)
    expect(sql.filter(q => q === 'COMMIT')).toHaveLength(1)
    expect(sql.filter(q => q.includes('set_config'))).toHaveLength(1)
    expect(await leggiTenant()).toBe('')
  })

  it('transazione interattiva con errore: rollback e nessun tenant rimasto sulla connessione', async () => {
    await expect(
      TenantContext.run({ tenantId: 'tenant-err' }, () =>
        client.$transaction(async tx => {
          await tx.$executeRaw`SELECT 1`
          throw new Error('boom')
        })
      )
    ).rejects.toThrow('boom')
    const sql = (await logQuiescente()).map(q => q.trim())
    expect(sql).toContain('ROLLBACK')
    expect(await leggiTenant()).toBe('')
  })
})

describe('Opzioni di $transaction e composizione col filtro per tenant', () => {
  const tenantUuid = '00000000-0000-0000-0000-000000000001'

  beforeEach(async () => {
    await azzeraLog()
  })

  it('le opzioni (isolationLevel, maxWait, timeout) arrivano alla transazione interattiva', async () => {
    const livello = await TenantContext.run({ tenantId: 'tenant-opz' }, () =>
      client.$transaction(
        async tx => {
          const r = await tx.$queryRaw<
            { v: string }[]
          >`SELECT current_setting('transaction_isolation') AS v`
          return r[0].v
        },
        {
          maxWait: 5000,
          timeout: 10000,
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      )
    )
    expect(livello).toBe('serializable')
  })

  it('compone con rlsExtension in entrambi gli ordini: filtro applicato e set_config presente', async () => {
    const tenantPoi = client.$extends(rlsExtension)
    const rlsPoi = base.$extends(rlsExtension).$extends(estensioneTenantTransazione(base))
    for (const c of [tenantPoi, rlsPoi]) {
      await azzeraLog()
      await TenantContext.run({ tenantId: tenantUuid }, async () => await c.user.count())
      const sql = (await logQuiescente()).map(q => q.trim())
      expect(sql[0]).toBe('BEGIN')
      expect(sql[1]).toContain('set_config')
      expect(sql[2]).toContain('"public"."users"')
      expect(sql[3]).toBe('COMMIT')
    }
  })
})

describe('Casi aggiuntivi (revisione)', () => {
  beforeEach(async () => {
    await azzeraLog()
  })

  it('Unsafe: $queryRawUnsafe e $executeRawUnsafe passano da set_config', async () => {
    const r = await TenantContext.run({ tenantId: 'tenant-unsafe' }, async () => {
      const letto = await client.$queryRawUnsafe<{ v: string }[]>(
        "SELECT current_setting('app.tenant_id', true) AS v"
      )
      const n = await client.$executeRawUnsafe('SELECT 1')
      return { letto: letto[0].v, n }
    })
    expect(r.letto).toBe('tenant-unsafe')
    expect((await logQuiescente()).filter(q => q.includes('set_config'))).toHaveLength(2)
    expect(await leggiTenant()).toBe('')
  })

  it('concorrenza: due contesti in parallelo su una connessione vedono ciascuno il proprio tenant', async () => {
    const [a, b] = await Promise.all([
      TenantContext.run({ tenantId: 'conc-A' }, () => leggiTenant()),
      TenantContext.run({ tenantId: 'conc-B' }, () => leggiTenant()),
    ])
    expect([a, b]).toEqual(['conc-A', 'conc-B'])
  })

  it('interattiva: una query del client ESTERNO dentro fn ha il proprio tenant (altra connessione)', async () => {
    const baseDue = new PrismaClient({
      datasources: {
        db: { url: `${urlBase}${urlBase.includes('?') ? '&' : '?'}connection_limit=3` },
      },
    })
    const clientDue = baseDue.$extends(estensioneTenantTransazione(baseDue))
    try {
      const esito = await TenantContext.run({ tenantId: 'tenant-esterno' }, () =>
        clientDue.$transaction(async tx => {
          const dentro = await leggiTenant(tx)
          const fuori = await leggiTenant(clientDue)
          return { dentro, fuori }
        })
      )
      expect(esito).toEqual({ dentro: 'tenant-esterno', fuori: 'tenant-esterno' })
    } finally {
      await baseDue.$disconnect()
    }
  })
})

describe('Valore di current_setting visto da un modello (trigger di prova)', () => {
  let tenantCreatoId: string | undefined

  beforeAll(async () => {
    await secondo.$executeRawUnsafe('DROP TABLE IF EXISTS prova_tenant_set CASCADE')
    await secondo.$executeRawUnsafe('CREATE TABLE prova_tenant_set (valore text)')
    await secondo.$executeRawUnsafe(
      "CREATE OR REPLACE FUNCTION prova_registra_tenant() RETURNS trigger AS $$ BEGIN INSERT INTO prova_tenant_set VALUES (current_setting('app.tenant_id', true)); RETURN NEW; END $$ LANGUAGE plpgsql"
    )
    await secondo.$executeRawUnsafe(
      'CREATE TRIGGER prova_tenant_trg AFTER INSERT ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION prova_registra_tenant()'
    )
  })

  afterAll(async () => {
    if (tenantCreatoId) await secondo.tenant.deleteMany({ where: { id: tenantCreatoId } })
    await secondo.$executeRawUnsafe('DROP TRIGGER IF EXISTS prova_tenant_trg ON "public"."tenants"')
    await secondo.$executeRawUnsafe('DROP FUNCTION IF EXISTS prova_registra_tenant()')
    await secondo.$executeRawUnsafe('DROP TABLE IF EXISTS prova_tenant_set')
  })

  it('un create di modello vede il tenant dentro la propria transazione', async () => {
    // Il trigger AFTER INSERT gira nella transazione del create e registra il valore
    // che current_setting ha in quel momento: e' la prova del VALORE per un'operazione
    // di modello (un count non lascia tracce osservabili da fuori).
    const piva = String(Date.now()).slice(-11).padStart(11, '7')
    const creato = await TenantContext.run({ tenantId: 'tenant-modello-valore' }, async () =>
      client.tenant.create({ data: { partitaIva: piva, ragioneSociale: 'Prova valore Srl' } })
    )
    tenantCreatoId = creato.id
    const righe = await secondo.$queryRaw<{ valore: string }[]>`SELECT valore FROM prova_tenant_set`
    expect(righe.map(r => r.valore)).toEqual(['tenant-modello-valore'])
  })
})

describe('Composizione: base già estesa con rlsExtension', () => {
  const tenantUuid = '00000000-0000-0000-0000-000000000001'
  const rlsBase = base.$extends(rlsExtension)
  const composto = rlsBase.$extends(estensioneTenantTransazione(rlsBase))

  beforeEach(async () => {
    await azzeraLog()
  })

  it('interattiva: il tx è filtrato per tenant E ha il set_config', async () => {
    await TenantContext.run({ tenantId: tenantUuid }, () =>
      composto.$transaction(async tx => {
        await tx.user.count()
      })
    )
    const sql = (await logQuiescente()).map(q => q.trim())
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('set_config')
    expect(sql[2]).toContain('"public"."users"')
    expect(sql[2]).toContain('tenant_id')
    expect(sql[3]).toBe('COMMIT')
  })

  it('batch: operazioni create sul client composto, filtrate e nella stessa transazione', async () => {
    await TenantContext.run({ tenantId: tenantUuid }, () =>
      composto.$transaction([composto.user.count(), composto.user.count()])
    )
    const sql = (await logQuiescente()).map(q => q.trim())
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('set_config')
    expect(sql[2]).toContain('tenant_id')
    expect(sql[3]).toContain('tenant_id')
    expect(sql.filter(q => q === 'BEGIN')).toHaveLength(1)
    expect(sql.filter(q => q === 'COMMIT')).toHaveLength(1)
  })
})
