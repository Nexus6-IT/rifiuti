/**
 * RLS pezzo 4, Task 2: il ruolo di gruppo `wasteflow_lettura` (policy `sola_lettura`) permette
 * ai controlli esterni (testing-umano, `rifiuti_testing`) di LEGGERE le righe di tutte le
 * aziende senza contesto, e solo di leggere. Un ruolo LOGIN di prova, membro del gruppo e con
 * SELECT sulle tabelle, si collega davvero. `wasteflow_app` e `wasteflow_sistema` non sono membri.
 *
 * Pulizia: DROP OWNED BY + DROP ROLE del ruolo di prova. Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo } from '../database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'

describe('RLS: sola lettura per i controlli (wasteflow_lettura)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const run = randomUUID().replace(/-/g, '')
  const sfx = Date.now().toString().slice(-8)
  // Nome unico: i ruoli sono dell'intero cluster e altri database li condividono.
  const nomeRuolo = `prova_lettura_${run.slice(0, 12)}`
  const pwd = `pwd_${run.slice(0, 16)}`
  let lettore: PrismaClient
  const tenantIds: string[] = []
  const utenti: Record<string, string> = {}
  let A = ''
  let B = ''

  beforeAll(async () => {
    for (const tag of ['A', 'B']) {
      const t = await owner.tenant.create({
        data: { partitaIva: `L${tag}${sfx}`.slice(0, 11), ragioneSociale: `Lettura ${tag} ${run}` },
      })
      tenantIds.push(t.id)
      const u = await owner.user.create({
        data: {
          tenantId: t.id,
          keycloakId: `kc-lt-${tag}-${run}`,
          fiscalCode: `LTTNT00A00A${tag === 'A' ? '201' : '202'}Z`,
          firstName: 'Prova',
          lastName: tag,
          email: `lt-${tag}-${run}@example.it`,
          role: 'ADMIN',
        },
      })
      utenti[tag] = u.id
      await owner.role.create({
        data: { tenantId: t.id, name: `LT-${tag}-${run}`, createdBy: u.id },
      })
    }
    A = tenantIds[0]
    B = tenantIds[1]
    await owner.$executeRawUnsafe(
      `CREATE ROLE ${nomeRuolo} LOGIN PASSWORD '${pwd}' IN ROLE wasteflow_lettura`
    )
    // Come i default privileges danno SELECT a rifiuti_testing: qui solo SELECT.
    await owner.$executeRawUnsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${nomeRuolo}`)
    lettore = clientComeRuolo(nomeRuolo, pwd, urlProprietario)
  })

  afterAll(async () => {
    await lettore?.$disconnect()
    await owner.role.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await owner.user.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await owner.$executeRawUnsafe(`DROP OWNED BY ${nomeRuolo}`)
    await owner.$executeRawUnsafe(`DROP ROLE ${nomeRuolo}`)
    await owner.$disconnect()
  })

  it('wasteflow_lettura e un ruolo di gruppo: NOLOGIN, senza BYPASSRLS, senza superuser', async () => {
    const [r] = await owner.$queryRaw<
      Array<{ rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean }>
    >`SELECT rolcanlogin, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'wasteflow_lettura'`
    expect(r).toEqual({ rolcanlogin: false, rolbypassrls: false, rolsuper: false })
  })

  it('wasteflow_app e wasteflow_sistema NON sono membri di wasteflow_lettura', async () => {
    const [r] = await owner.$queryRaw<Array<{ app: boolean; sistema: boolean; prova: boolean }>>`
      SELECT pg_has_role('wasteflow_app', 'wasteflow_lettura', 'member') AS app,
             pg_has_role('wasteflow_sistema', 'wasteflow_lettura', 'member') AS sistema,
             pg_has_role(${nomeRuolo}, 'wasteflow_lettura', 'member') AS prova`
    expect(r).toEqual({ app: false, sistema: false, prova: true })
  })

  it('senza contesto il membro vede le righe di tutte le aziende', async () => {
    const utentiVisti = await lettore.$queryRawUnsafe<{ t: string }[]>(
      `SELECT DISTINCT tenant_id::text AS t FROM users WHERE tenant_id IN ('${A}', '${B}') ORDER BY 1`
    )
    expect(utentiVisti.map(x => x.t).sort()).toEqual([A, B].sort())
    const ruoli = await lettore.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM roles WHERE tenant_id IN ('${A}', '${B}')`
    )
    expect(ruoli[0].n).toBe(2)
  })

  it('role_permissions: il membro la legge per intero, senza contesto', async () => {
    const [{ n }] = await lettore.$queryRawUnsafe<{ n: number }[]>(
      'SELECT count(*)::int AS n FROM role_permissions'
    )
    const [{ m }] = await owner.$queryRaw<
      { m: number }[]
    >`SELECT count(*)::int AS m FROM role_permissions`
    expect(n).toBe(m)
  })

  it('scrittura rifiutata per mancanza di privilegi (il membro ha solo SELECT)', async () => {
    await expect(
      lettore.$executeRawUnsafe(`UPDATE users SET first_name = 'X' WHERE tenant_id = '${A}'`)
    ).rejects.toThrow(/permission denied/i)
    await expect(
      lettore.$executeRawUnsafe(`DELETE FROM roles WHERE tenant_id = '${A}'`)
    ).rejects.toThrow(/permission denied/i)
  })

  it('scrittura rifiutata dalla RLS anche CON i privilegi: la policy e di sola lettura', async () => {
    await owner.$executeRawUnsafe(
      `GRANT INSERT, UPDATE, DELETE ON users, roles, role_permissions TO ${nomeRuolo}`
    )
    // UPDATE e DELETE: nessuna policy li consente, quindi 0 righe toccate.
    expect(
      await lettore.$executeRawUnsafe(`UPDATE users SET first_name = 'X' WHERE tenant_id = '${A}'`)
    ).toBe(0)
    expect(await lettore.$executeRawUnsafe(`DELETE FROM roles WHERE tenant_id = '${A}'`)).toBe(0)
    // INSERT: la WITH CHECK dell'isolamento (nessun contesto) lo rifiuta.
    await expect(
      lettore.$executeRawUnsafe(
        `INSERT INTO roles (id, tenant_id, name, created_by, updated_at)
         VALUES (gen_random_uuid(), '${A}', 'abusivo-${run}', '${utenti.A}', now())`
      )
    ).rejects.toThrow(/row-level security/i)
    expect(await owner.user.count({ where: { tenantId: A, firstName: 'X' } })).toBe(0)
    expect(await owner.role.count({ where: { tenantId: A } })).toBe(1)
  })
})
