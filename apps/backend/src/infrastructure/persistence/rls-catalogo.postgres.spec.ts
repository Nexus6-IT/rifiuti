import { PrismaClient } from '@prisma/client'

/**
 * RLS pezzo 3, Task 3: controllo sul catalogo. L'elenco delle tabelle NON e'
 * scritto a mano: viene da `information_schema.columns`, cosi' una tabella
 * futura con `tenant_id` e senza policy fa fallire il test.
 */
const ESPR = "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)"

// Escluse volute: se una cambia, il test lo rende esplicito.
const SENZA_RLS = ['role_permissions', 'tenants', 'access_requests']

describe('RLS: catalogo delle tabelle per azienda', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('ogni tabella con tenant_id ha RLS, FORCE e la policy isolamento_azienda', async () => {
    const righe = await prisma.$queryRaw<
      Array<{
        tabella: string
        rls: boolean
        forzata: boolean
        policy: string | null
        cmd: string | null
        roles: string | null
        qual: string | null
        with_check: string | null
      }>
    >`
      SELECT c.relname AS tabella, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzata,
             p.policyname AS policy, p.cmd, p.roles::text AS roles, p.qual, p.with_check
      FROM information_schema.columns k
      JOIN pg_class c ON c.relname = k.table_name AND c.relkind = 'r'
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
        AND p.policyname = 'isolamento_azienda'
      WHERE k.table_schema = 'public' AND k.column_name = 'tenant_id'
      ORDER BY 1`
    expect(righe.length).toBe(29)
    for (const r of righe) {
      expect({ t: r.tabella, rls: r.rls, forzata: r.forzata }).toEqual({
        t: r.tabella,
        rls: true,
        forzata: true,
      })
      expect({ t: r.tabella, policy: r.policy, cmd: r.cmd, roles: r.roles }).toEqual({
        t: r.tabella,
        policy: 'isolamento_azienda',
        cmd: 'ALL',
        roles: '{public}',
      })
      expect({ t: r.tabella, qual: r.qual }).toEqual({ t: r.tabella, qual: ESPR })
      expect({ t: r.tabella, wc: r.with_check }).toEqual({ t: r.tabella, wc: ESPR })
    }
  })

  it('le esclusioni volute restano senza RLS', async () => {
    const righe = await prisma.$queryRaw<Array<{ tabella: string; rls: boolean }>>`
      SELECT relname AS tabella, relrowsecurity AS rls FROM pg_class
      WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
        AND relname IN ('role_permissions', 'tenants', 'access_requests')`
    expect(righe.map(r => r.tabella).sort()).toEqual([...SENZA_RLS].sort())
    for (const r of righe) expect(r.rls).toBe(false)
  })
})
