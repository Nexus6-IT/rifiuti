/**
 * RLS pezzo 4, Task 1: `role_permissions` (tabella ponte senza tenant_id) e' protetta dalla
 * policy `isolamento_via_ruolo`: una riga e' visibile e scrivibile solo se il suo ruolo e'
 * visibile, cioe' appartiene all'azienda del contesto (la subquery su `roles` e' filtrata dalla
 * policy di `roles`). Provato collegandosi davvero come `wasteflow_app`.
 *
 * I dati li crea il proprietario (ignora la RLS); la pulizia toglie solo le righe create qui.
 * Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { clientComeRuolo, urlComeRuolo } from '../database/client-come-ruolo'
import { SYSTEM_ROLES, seedRolesForTenant } from '../../application/admin/system-roles'
import { TenantContext } from '../../core/context/tenant-context'
import { PrismaService, creaPrismaServiceApplicativo } from './prisma.service'
import { PrismaPermissionRepository } from './permission.repository'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
const PWD_APP = process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev'

describe('RLS: role_permissions tramite il ruolo (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  const app = clientComeRuolo('wasteflow_app', PWD_APP, urlProprietario)

  const run = randomUUID().replace(/-/g, '')
  const sfx = Date.now().toString().slice(-8)
  const tenantIds: string[] = []
  const permessiCreati: string[] = []
  let A = ''
  let B = ''
  let userA = ''
  let ruoloA = ''
  let ruoloB = ''
  let permessoId = ''

  type Tx = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>
  const conContesto = <T>(
    tenant: string | null,
    fn: (tx: PrismaClient) => Promise<T>
  ): Promise<T> =>
    app.$transaction(async tx => {
      if (tenant)
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenant}', true)`)
      return fn(tx as unknown as PrismaClient)
    })

  async function creaPermesso(resource: string, action: string) {
    const p = await owner.permission.create({
      data: { resource, action, scope: 'all', description: 'prova', module: 'Prova' },
    })
    permessiCreati.push(p.id)
    return p.id
  }

  async function creaAzienda(tag: string) {
    const t = await owner.tenant.create({
      data: { partitaIva: `R${tag}${sfx}`.slice(0, 11), ragioneSociale: `RolePerm ${tag} ${run}` },
    })
    tenantIds.push(t.id)
    const u = await owner.user.create({
      data: {
        tenantId: t.id,
        keycloakId: `kc-rp-${tag}-${run}`,
        fiscalCode: `RPTNT00A00A${tag === 'A' ? '101' : '102'}Z`,
        firstName: 'Prova',
        lastName: tag,
        email: `rp-${tag}-${run}@example.it`,
        role: 'ADMIN',
      },
    })
    const r = await owner.role.create({
      data: { tenantId: t.id, name: `RP-${tag}-${run}`, createdBy: u.id },
    })
    await owner.rolePermission.create({
      data: { roleId: r.id, permissionId: permessoId, grantedBy: u.id },
    })
    return { tenantId: t.id, userId: u.id, roleId: r.id }
  }

  beforeAll(async () => {
    permessoId = await creaPermesso(`rp${run}`.slice(0, 50), 'read')
    const a = await creaAzienda('A')
    const b = await creaAzienda('B')
    A = a.tenantId
    userA = a.userId
    ruoloA = a.roleId
    B = b.tenantId
    ruoloB = b.roleId
  })

  afterAll(async () => {
    await owner.role.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await owner.user.deleteMany({ where: { tenantId: { in: tenantIds } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await owner.permission.deleteMany({ where: { id: { in: permessiCreati } } })
    await Promise.all([owner.$disconnect(), app.$disconnect()])
  })

  const ruoliVisibili = async (tx: Tx) =>
    (
      await tx.$queryRawUnsafe<{ r: string }[]>(
        `SELECT DISTINCT role_id::text AS r FROM role_permissions
         WHERE permission_id = '${permessoId}' ORDER BY 1`
      )
    ).map(x => x.r)

  it('role_permissions: righe di un ruolo di un altra azienda invisibili', async () => {
    expect(await conContesto(A, ruoliVisibili)).toEqual([ruoloA])
    expect(await conContesto(B, ruoliVisibili)).toEqual([ruoloB])
  })

  it('role_permissions: senza contesto nessuna riga', async () => {
    expect(await conContesto(null, ruoliVisibili)).toEqual([])
  })

  it('role_permissions: scrittura per un ruolo di un altra azienda rifiutata', async () => {
    await expect(
      conContesto(A, tx =>
        tx.$executeRawUnsafe(
          `INSERT INTO role_permissions (role_id, permission_id, granted_by)
           VALUES ('${ruoloB}', '${permessoId}', '${userA}')`
        )
      )
    ).rejects.toThrow(/row-level security/i)
  })

  it('role_permissions: DELETE e UPDATE su un ruolo di un altra azienda non toccano nulla', async () => {
    const esiti = await conContesto(A, async tx => [
      await tx.$executeRawUnsafe(`DELETE FROM role_permissions WHERE role_id = '${ruoloB}'`),
      await tx.$executeRawUnsafe(
        `UPDATE role_permissions SET granted_by = '${userA}' WHERE role_id = '${ruoloB}'`
      ),
    ])
    expect(esiti).toEqual([0, 0])
    expect(await owner.rolePermission.count({ where: { roleId: ruoloB } })).toBe(1)
  })

  it('role_permissions: scrittura per un ruolo della propria azienda consentita', async () => {
    const nuovo = await creaPermesso(`rq${run}`.slice(0, 50), 'read')
    const n = await conContesto(A, tx =>
      tx.$executeRawUnsafe(
        `INSERT INTO role_permissions (role_id, permission_id, granted_by)
         VALUES ('${ruoloA}', '${nuovo}', '${userA}')`
      )
    )
    expect(n).toBe(1)
  })

  it('createTenant col ruolo app: permessi dei ruoli creati', async () => {
    // Il seed di createTenant (seedRolesForTenant) col client app nel contesto della nuova
    // azienda: ruoli di sistema e relativi permessi si scrivono e si rileggono. Il numero di
    // righe atteso e' quello che il seed risolve: per ogni ruolo di sistema, le chiavi
    // distinte che esistono davvero nella tabella permissions.
    const chiave = await owner.permission.findUnique({
      where: { resource_action_scope: { resource: 'fir', action: 'read', scope: 'all' } },
    })
    if (!chiave) await creaPermesso('fir', 'read')
    const esistenti = new Set(
      (await owner.permission.findMany()).map(p => `${p.resource}:${p.action}:${p.scope}`)
    )
    const attese = SYSTEM_ROLES.reduce(
      (tot, r) => tot + new Set(r.permissions.filter(k => esistenti.has(k))).size,
      0
    )
    expect(attese).toBeGreaterThan(0)
    const { n, righe } = await conContesto(A, async tx => {
      const n = await seedRolesForTenant(tx as never, A, userA)
      const righe = await tx.rolePermission.count({
        where: { role: { tenantId: A, isSystemRole: true } },
      })
      return { n, righe }
    })
    expect(n).toBe(SYSTEM_ROLES.length)
    expect(righe).toBe(attese)
  })

  it('PrismaService reale come wasteflow_app: findByRole e la select annidata di jwt.strategy non perdono permessi', async () => {
    const precedente = process.env.DATABASE_URL
    process.env.DATABASE_URL = urlComeRuolo('wasteflow_app', PWD_APP, urlProprietario)
    const reale: PrismaService = creaPrismaServiceApplicativo()
    try {
      // Prisma 5 legge DATABASE_URL al $connect: l'ambiente si ripristina solo dopo.
      await reale.$connect()
      process.env.DATABASE_URL = precedente
      await owner.userRoleAssignment.create({
        data: { userId: userA, roleId: ruoloA, tenantId: A, assignedBy: userA },
      })
      const { utente, permessi, annidata } = await TenantContext.run({ tenantId: A }, async () => {
        const [{ cu }] = await reale.$queryRawUnsafe<{ cu: string }[]>('SELECT current_user AS cu')
        const repo = new PrismaPermissionRepository(reale)
        const permessi = await repo.findByRole(ruoloA)
        // Stessa forma di JwtStrategy.resolvePermissions.
        const annidata = await reale.userRoleAssignment.findMany({
          where: { userId: userA, tenantId: A },
          select: {
            role: {
              select: {
                permissions: {
                  select: {
                    permission: { select: { resource: true, action: true, scope: true } },
                  },
                },
              },
            },
          },
        })
        return { utente: cu, permessi, annidata }
      })
      expect(utente).toBe('wasteflow_app')
      expect(permessi.map(p => p.id)).toContain(permessoId)
      const chiavi = annidata.flatMap(a => a.role.permissions.map(p => p.permission.resource))
      expect(chiavi).toContain(`rp${run}`.slice(0, 50))
      // Con il contesto di un'altra azienda le righe del ruolo di A non si vedono.
      const daB = await TenantContext.run({ tenantId: B }, () =>
        new PrismaPermissionRepository(reale).findByRole(ruoloA)
      )
      expect(daB).toEqual([])
    } finally {
      process.env.DATABASE_URL = precedente
      await owner.userRoleAssignment.deleteMany({ where: { userId: userA } })
      await reale.$disconnect()
    }
  })

  it('resolvePermissions e role.controller: join col ruolo e lettura diretta per role_id', async () => {
    const viaJoin = await conContesto(A, tx =>
      tx.role.findMany({
        where: { tenantId: A, name: `RP-A-${run}` },
        include: { permissions: { include: { permission: true } } },
      })
    )
    expect(viaJoin.flatMap(r => r.permissions).map(p => p.permissionId)).toContain(permessoId)
    const diretta = await conContesto(A, tx =>
      tx.rolePermission.findMany({ where: { roleId: ruoloA, permissionId: permessoId } })
    )
    expect(diretta).toHaveLength(1)
    const altra = await conContesto(A, tx =>
      tx.rolePermission.findMany({ where: { roleId: ruoloB } })
    )
    expect(altra).toEqual([])
  })
})
