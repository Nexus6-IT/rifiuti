/**
 * PermissionGuard sull'azienda effettiva (RLS pezzo 4, Task 4b): middleware reale + guard reale
 * + repository reali + job `audit-logging` reale, su Postgres con la RLS ATTIVA e collegati come
 * `wasteflow_app`. Finta solo la coda BullMQ (un oggetto che esegue subito il job), e la cache dei
 * permessi e' una vera implementazione in memoria, sempre fredda alla prima richiesta.
 *
 * Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import * as jwt from 'jsonwebtoken'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
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

import { AZIENDA_PIATTAFORMA_ID } from '../../core/context/azienda-piattaforma'
import { TenantContextMiddleware } from '../../core/middleware/tenant-context.middleware'
import {
  PrismaService,
  creaPrismaServiceApplicativo,
} from '../../infrastructure/persistence/prisma.service'
import { PrismaUserRoleRepository } from '../../infrastructure/persistence/user-role.repository'
import { PrismaPermissionRepository } from '../../infrastructure/persistence/permission.repository'
import { PrismaPermissionAuditLogRepository } from '../../infrastructure/persistence/permission-audit-log.repository'
import { AuditLoggingProcessor } from '../../infrastructure/jobs/audit-logging.job'
import { PermissionAuditLog } from '../../domain/identity-access/permission-audit-log.entity'
import { PermissionGuard } from './permission.guard'

const SEGRETO = 'segreto-di-prova-guard'

describe('PermissionGuard: azienda effettiva (Postgres reale, ruolo app)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let guard: PermissionGuard
  const middleware = new TenantContextMiddleware({ get: () => SEGRETO } as never)
  const run = randomUUID().replace(/-/g, '')
  const sfx = Date.now().toString().slice(-8)
  const attese: Promise<unknown>[] = []
  const tenantIds: string[] = []
  const userIds: string[] = []
  let casa = ''
  let altra = ''
  let normale = ''
  let superAdmin = ''
  let ruoloId = ''
  let permessoId = ''

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.$connect()
    // Prisma legge DATABASE_URL al connect: si verifica DAVVERO il ruolo, non lo si presume.
    const [{ u }] = await app.$queryRaw<{ u: string }[]>`SELECT current_user::text AS u`
    expect(u).toBe('wasteflow_app')

    const azienda = async (tag: string) => {
      const t = await owner.tenant.create({
        data: { partitaIva: `G${tag}${sfx}`.slice(0, 11), ragioneSociale: `Guard ${tag} ${run}` },
      })
      tenantIds.push(t.id)
      return t.id
    }
    casa = await azienda('A')
    altra = await azienda('B')
    const utente = async (tag: string, role: 'ADMIN' | 'SUPER_ADMIN', cf: string) => {
      const x = await owner.user.create({
        data: {
          tenantId: casa,
          keycloakId: `kc-guard-${tag}-${run}`,
          fiscalCode: cf,
          firstName: 'Prova',
          lastName: tag,
          email: `guard-${tag}-${run}@example.it`,
          role,
        },
      })
      userIds.push(x.id)
      return x.id
    }
    normale = await utente('normale', 'ADMIN', 'GRDNRM00A00A001Z')
    superAdmin = await utente('super', 'SUPER_ADMIN', 'GRDSPR00A00A002Z')

    const ruolo = await owner.role.create({
      data: { tenantId: casa, name: `audit-${run}`, createdBy: normale },
    })
    ruoloId = ruolo.id
    const permesso =
      (await owner.permission.findFirst({
        where: { resource: 'audit', action: 'read', scope: 'all' },
      })) ??
      (await owner.permission.create({
        data: {
          resource: 'audit',
          action: 'read',
          scope: 'all',
          description: 'prova',
          module: 'Audit',
        },
      }))
    permessoId = permesso.id
    await owner.rolePermission.create({
      data: { roleId: ruoloId, permissionId: permessoId, grantedBy: normale },
    })
    for (const u of [normale, superAdmin]) {
      await owner.userRoleAssignment.create({
        data: { userId: u, roleId: ruoloId, tenantId: casa, assignedBy: normale },
      })
    }

    const job = new AuditLoggingProcessor(
      { save: jest.fn() } as never,
      new PrismaPermissionAuditLogRepository(app)
    )
    // Coda finta: esegue subito il job vero e ne tiene la promessa per attenderlo.
    const coda = {
      add: (_nome: string, data: unknown) => {
        const p = job.process({ id: randomUUID(), attemptsMade: 0, data } as never)
        attese.push(p)
        return p
      },
    }
    const cache = new Map<string, string[]>()
    guard = new PermissionGuard(
      { getAllAndOverride: () => 'audit:read:all' } as never,
      {
        getPermissions: async (t: string, u: string) => cache.get(`${t}:${u}`) ?? null,
        setPermissions: async (t: string, u: string, p: string[]) => void cache.set(`${t}:${u}`, p),
      } as never,
      {} as never,
      coda as never,
      { evaluate: jest.fn() } as never,
      { findActiveByUserId: jest.fn(), findActiveByResourceType: async () => [] } as never,
      new PrismaUserRoleRepository(app),
      new PrismaPermissionRepository(app)
    )
  })

  afterAll(async () => {
    await owner.permissionAuditLog.deleteMany({
      where: { OR: [{ userId: { in: userIds } }, { tenantId: { in: tenantIds } }] },
    })
    await owner.userRoleAssignment.deleteMany({ where: { roleId: ruoloId } })
    await owner.rolePermission.deleteMany({ where: { roleId: ruoloId } })
    await owner.role.deleteMany({ where: { id: ruoloId } })
    await owner.user.deleteMany({ where: { id: { in: userIds } } })
    await owner.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await app.$disconnect()
    await owner.$disconnect()
  })

  /** Una richiesta: middleware reale (contesto) e poi guard reale, come in produzione. */
  async function richiesta(utenteId: string, role: string, header?: string) {
    const token = jwt.sign({ sub: utenteId, tenantId: casa, role, type: 'access' }, SEGRETO)
    const req: Record<string, unknown> = {
      headers: {
        authorization: `Bearer ${token}`,
        ...(header ? { 'x-tenant-id': header } : {}),
      },
      ip: '127.0.0.1',
      params: {},
      body: {},
      user: {
        id: utenteId,
        tenantId: casa,
        role,
        fiscalCode: utenteId === superAdmin ? 'GRDSPR00A00A002Z' : 'GRDNRM00A00A001Z',
        sessionId: `sessione-${utenteId}`,
      },
    }
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }
    const esito = await new Promise<boolean>((resolve, reject) => {
      middleware.use(req as never, {} as never, () => {
        guard.canActivate(ctx as never).then(resolve, reject)
      })
    })
    await Promise.all(attese.splice(0))
    return esito
  }

  const righe = (tenantId: string, userId: string) =>
    owner.permissionAuditLog.findMany({
      where: { tenantId, userId },
      orderBy: { timestamp: 'asc' },
    })

  it('utente normale: permessi caricati e audit nell azienda del token, header ignorato', async () => {
    expect(await richiesta(normale, 'ADMIN')).toBe(true)
    expect(await richiesta(normale, 'ADMIN', altra)).toBe(true)
    const inCasa = await righe(casa, normale)
    expect(inCasa).toHaveLength(2)
    expect(await righe(altra, normale)).toHaveLength(0)
    expect(inCasa[0].spidFiscalCode).toBe('GRDNRM00A00A001Z')
    expect(inCasa[0].sessionId).toBe(`sessione-${normale}`)
  })

  it('super admin con X-Tenant-ID: permessi letti nel contesto di casa, audit nell azienda scelta', async () => {
    expect(await richiesta(superAdmin, 'SUPER_ADMIN', altra)).toBe(true)
    const inAltra = await righe(altra, superAdmin)
    expect(inAltra).toHaveLength(1)
    expect(await righe(casa, superAdmin)).toHaveLength(0)
  })

  it('super admin senza X-Tenant-ID: audit nella piattaforma, catena e hash verificabili', async () => {
    expect(await richiesta(superAdmin, 'SUPER_ADMIN')).toBe(true)
    await new Promise(r => setTimeout(r, 5))
    expect(await richiesta(superAdmin, 'SUPER_ADMIN')).toBe(true)
    const inPiattaforma = await righe(AZIENDA_PIATTAFORMA_ID, superAdmin)
    expect(inPiattaforma).toHaveLength(2)
    expect(inPiattaforma[1].previousEntryHash).toBe(inPiattaforma[0].currentHash)
    for (const r of inPiattaforma) {
      const riletta = PermissionAuditLog.fromPersistence({
        id: r.id,
        tenantId: r.tenantId,
        userId: r.userId,
        spidFiscalCode: r.spidFiscalCode,
        actionAttempted: r.actionAttempted,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        decision: r.decision,
        timestamp: r.timestamp,
        sessionId: r.sessionId,
        previousHash: r.previousEntryHash,
        hash: r.currentHash,
      })
      expect(riletta.isHashValid()).toBe(true)
    }
  })
})
