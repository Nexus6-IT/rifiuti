/**
 * NotificationService contro un Postgres reale, ruolo `wasteflow_app` (RLS): la lettura
 * restituisce `read`, `readAt` e `createdAt` veri, e `unreadOnly` filtra davvero.
 */
import { PrismaClient } from '@prisma/client'
import { urlComeRuolo } from '../../infrastructure/database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
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
import { NotificationService } from './notification.service'

describe('NotificationService — Postgres reale, ruolo wasteflow_app', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  let service: NotificationService
  let tenantId = ''
  let userId = ''
  const logger = { setContext: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() }

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    service = new NotificationService(app, {} as never, logger as never)
    const suffisso = `${Date.now()}`.slice(-9)
    const t = await owner.tenant.create({
      data: { partitaIva: `NT${suffisso}`, ragioneSociale: 'Notifiche SRL', country: 'IT' },
    })
    tenantId = t.id
    const u = await owner.user.create({
      data: {
        tenantId,
        keycloakId: `keycloak-notif-${suffisso}`,
        fiscalCode: 'RSSMRA80A01H501U',
        firstName: 'Mario',
        lastName: 'Rossi',
        email: `notif-${suffisso}@example.com`,
        role: 'ADMIN',
      },
    })
    userId = u.id
  })

  afterAll(async () => {
    await owner.notification.deleteMany({ where: { tenantId } })
    await owner.user.deleteMany({ where: { tenantId } })
    await owner.tenant.deleteMany({ where: { id: tenantId } })
    await owner.$disconnect()
    await app.$disconnect()
  })

  it('restituisce i valori salvati di read, readAt e createdAt', async () => {
    const creata = new Date('2026-09-01T07:00:00.000Z')
    const letta = new Date('2026-09-02T10:15:00.000Z')
    const nonLetta = await owner.notification.create({
      data: {
        tenantId,
        userId,
        type: 'SYSTEM_ERROR',
        title: 'Da leggere',
        message: 'm',
        createdAt: creata,
      },
    })
    const gia = await owner.notification.create({
      data: {
        tenantId,
        userId,
        type: 'SYSTEM_ERROR',
        title: 'Già letta',
        message: 'm',
        createdAt: new Date('2026-08-01T07:00:00.000Z'),
        isRead: true,
        readAt: letta,
      },
    })

    const out = await TenantContext.run({ tenantId }, () =>
      service.getUserNotifications({ userId, tenantId })
    )

    const a = out.find(n => n.getId() === nonLetta.id)!
    const b = out.find(n => n.getId() === gia.id)!
    expect(a.isRead()).toBe(false)
    expect(a.getCreatedAt()).toEqual(creata)
    expect(b.isRead()).toBe(true)
    expect(b.getReadAt()).toEqual(letta)
    expect(b.getCreatedAt()).toEqual(new Date('2026-08-01T07:00:00.000Z'))
  })

  it('unreadOnly restituisce solo le non lette', async () => {
    const out = await TenantContext.run({ tenantId }, () =>
      service.getUserNotifications({ userId, tenantId, unreadOnly: true })
    )
    expect(out.length).toBeGreaterThan(0)
    expect(out.every(n => !n.isRead())).toBe(true)
  })

  it('createNotification salva la riga (isRead false, senza campi ignoti)', async () => {
    const n = await TenantContext.run({ tenantId }, () =>
      service.createNotification({
        tenantId,
        userId,
        userEmail: 'x@example.com',
        userName: 'X',
        type: 'SYSTEM_ERROR',
        title: 'creata',
        message: 'm',
        severity: 'INFO',
        metadata: { a: 1 },
      })
    )
    const riga = await owner.notification.findUniqueOrThrow({ where: { id: n.getId() } })
    expect(riga).toMatchObject({ isRead: false, readAt: null, title: 'creata' })
  })

  it('la lettura esclude le notifiche di un altro utente e di un altro tenant', async () => {
    const suffisso = `${Date.now()}`.slice(-8)
    const altroTenant = await owner.tenant.create({
      data: { partitaIva: `NX${suffisso}`, ragioneSociale: 'Altra SRL', country: 'IT' },
    })
    const mk = (tid: string, k: string) =>
      owner.user.create({
        data: {
          tenantId: tid,
          keycloakId: `keycloak-notif-${k}-${suffisso}`,
          fiscalCode: `FC${k}${suffisso}`,
          firstName: 'A',
          lastName: 'B',
          email: `notif-${k}-${suffisso}@example.com`,
          role: 'ADMIN',
        },
      })
    const stessoTenant = await mk(tenantId, 'st')
    const utenteAltro = await mk(altroTenant.id, 'al')
    try {
      const altroUtente = await owner.notification.create({
        data: {
          tenantId,
          userId: stessoTenant.id,
          type: 'SYSTEM_ERROR',
          title: 'altro utente',
          message: 'm',
        },
      })
      const altraAzienda = await owner.notification.create({
        data: {
          tenantId: altroTenant.id,
          userId: utenteAltro.id,
          type: 'SYSTEM_ERROR',
          title: 'altra azienda',
          message: 'm',
        },
      })
      const out = await TenantContext.run({ tenantId }, () =>
        service.getUserNotifications({ userId, tenantId })
      )
      const ids = out.map(x => x.getId())
      expect(ids).not.toContain(altroUtente.id)
      expect(ids).not.toContain(altraAzienda.id)
    } finally {
      await owner.notification.deleteMany({
        where: {
          tenantId: { in: [tenantId, altroTenant.id] },
          userId: { in: [stessoTenant.id, utenteAltro.id] },
        },
      })
      await owner.user.deleteMany({ where: { id: { in: [stessoTenant.id, utenteAltro.id] } } })
      await owner.tenant.deleteMany({ where: { id: altroTenant.id } })
    }
  })
})
