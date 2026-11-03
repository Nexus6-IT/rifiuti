import { PrismaClient } from '@prisma/client'

/**
 * RLS pezzo 3, Task 3 e pezzo 4, Task 1-2: controllo sul catalogo. L'elenco delle tabelle NON e'
 * scritto a mano: viene da `information_schema.columns`, cosi' una tabella futura con
 * `tenant_id` e senza policy fa fallire il test. Ogni tabella ha ESATTAMENTE due policy:
 * l'isolamento e la sola lettura per `wasteflow_lettura`.
 */
const ESPR = "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)"

// Espressione normalizzata da pg_policies per role_permissions (come ESPR per le altre).
const ESPR_VIA_RUOLO =
  '(EXISTS ( SELECT 1\n   FROM roles r\n  WHERE (r.id = role_permissions.role_id)))'

// Escluse volute: se una cambia, il test lo rende esplicito.
const SENZA_RLS = ['tenants', 'access_requests']

type PolicyRiga = {
  policyname: string
  permissive: string
  cmd: string
  roles: string
  qual: string | null
  with_check: string | null
}

const SOLA_LETTURA: PolicyRiga = {
  policyname: 'sola_lettura',
  permissive: 'PERMISSIVE',
  cmd: 'SELECT',
  roles: '{wasteflow_lettura}',
  qual: 'true',
  with_check: null,
}

describe('RLS: catalogo delle tabelle per azienda', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.$connect()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const policyDi = (tabella: string) =>
    prisma.$queryRawUnsafe<PolicyRiga[]>(
      `SELECT policyname, permissive, cmd, roles::text AS roles, qual, with_check FROM pg_policies
       WHERE schemaname = 'public' AND tablename = '${tabella}' ORDER BY policyname`
    )

  it('ogni tabella con tenant_id ha RLS, FORCE e esattamente isolamento_azienda + sola_lettura', async () => {
    const righe = await prisma.$queryRaw<
      Array<{ tabella: string; rls: boolean; forzata: boolean }>
    >`
      SELECT c.relname AS tabella, c.relrowsecurity AS rls, c.relforcerowsecurity AS forzata
      FROM information_schema.columns k
      JOIN pg_class c ON c.relname = k.table_name AND c.relkind = 'r'
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE k.table_schema = 'public' AND k.column_name = 'tenant_id'
      ORDER BY 1`
    // 67 dalla fase 4.3: le tre tabelle dei legami (`legami_movimento`, `righe_legame_movimento`,
    // `impostazioni_fatturazione`) sono provate per nome in
    // `application/legami-movimento/legami-movimento.schema.postgres.spec.ts`.
    expect(righe.length).toBe(67)
    for (const r of righe) {
      expect({ t: r.tabella, rls: r.rls, forzata: r.forzata }).toEqual({
        t: r.tabella,
        rls: true,
        forzata: true,
      })
      // Un'altra policy qualunque (o una mancante) fa fallire.
      expect({ t: r.tabella, policy: await policyDi(r.tabella) }).toEqual({
        t: r.tabella,
        policy: [
          {
            policyname: 'isolamento_azienda',
            permissive: 'PERMISSIVE',
            cmd: 'ALL',
            roles: '{public}',
            qual: ESPR,
            with_check: ESPR,
          },
          SOLA_LETTURA,
        ],
      })
    }
  })

  it('le esclusioni volute restano senza RLS', async () => {
    const righe = await prisma.$queryRaw<
      Array<{ tabella: string; rls: boolean; forzata: boolean }>
    >`
      SELECT relname AS tabella, relrowsecurity AS rls, relforcerowsecurity AS forzata FROM pg_class
      WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace
        AND relname IN ('tenants', 'access_requests')`
    expect(righe.map(r => r.tabella).sort()).toEqual([...SENZA_RLS].sort())
    for (const r of righe)
      expect({ t: r.tabella, rls: r.rls, forzata: r.forzata }).toEqual({
        t: r.tabella,
        rls: false,
        forzata: false,
      })
  })

  it('role_permissions ha RLS, FORCE e solo isolamento_via_ruolo (tramite roles) + sola_lettura', async () => {
    const [t] = await prisma.$queryRaw<Array<{ rls: boolean; forzata: boolean }>>`
      SELECT relrowsecurity AS rls, relforcerowsecurity AS forzata FROM pg_class
      WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname = 'role_permissions'`
    expect(t).toEqual({ rls: true, forzata: true })
    expect(await policyDi('role_permissions')).toEqual([
      {
        policyname: 'isolamento_via_ruolo',
        permissive: 'PERMISSIVE',
        cmd: 'ALL',
        roles: '{public}',
        qual: ESPR_VIA_RUOLO,
        with_check: ESPR_VIA_RUOLO,
      },
      SOLA_LETTURA,
    ])
  })
})
