/**
 * NotificationService.getUserNotifications — la lettura restituisce i valori veri
 * di `read`, `readAt` e `createdAt` salvati, non quelli di una notifica appena creata.
 */
import { NotificationService } from './notification.service'

const logger = { setContext: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() }

function riga(sovrascrivi: Record<string, unknown> = {}) {
  return {
    id: 'n-1',
    tenantId: 't-1',
    userId: 'u-1',
    type: 'SYSTEM_ERROR',
    title: 'Titolo',
    message: 'Messaggio',
    severity: 'WARNING',
    actionUrl: '/fir/1',
    isRead: false,
    readAt: null,
    createdAt: new Date('2026-10-01T08:00:00Z'),
    ...sovrascrivi,
  }
}

function costruisci(righe: unknown[]) {
  const prisma = { notification: { findMany: jest.fn().mockResolvedValue(righe) } }
  const service = new NotificationService(prisma as never, {} as never, logger as never)
  return { prisma, service }
}

describe('NotificationService.getUserNotifications', () => {
  it('restituisce read, readAt e createdAt veri per una notifica già letta', async () => {
    const letta = new Date('2026-10-02T09:30:00Z')
    const { service } = costruisci([riga({ isRead: true, readAt: letta })])

    const [n] = await service.getUserNotifications({ userId: 'u-1', tenantId: 't-1' })

    expect(n.isRead()).toBe(true)
    expect(n.getReadAt()).toEqual(letta)
    expect(n.getCreatedAt()).toEqual(new Date('2026-10-01T08:00:00Z'))
    expect(n.toPlainObject()).toMatchObject({
      read: true,
      readAt: letta,
      createdAt: new Date('2026-10-01T08:00:00Z'),
    })
  })

  it('una notifica non letta resta non letta e senza readAt', async () => {
    const { service } = costruisci([riga()])

    const [n] = await service.getUserNotifications({ userId: 'u-1', tenantId: 't-1' })

    expect(n.isRead()).toBe(false)
    expect(n.getReadAt()).toBeUndefined()
  })

  it('mantiene l ordine e i campi della riga', async () => {
    const { service } = costruisci([
      riga({ id: 'a', createdAt: new Date('2026-10-05T00:00:00Z') }),
      riga({ id: 'b', isRead: true, createdAt: new Date('2026-10-03T00:00:00Z') }),
    ])

    const out = await service.getUserNotifications({ userId: 'u-1', tenantId: 't-1' })

    expect(out.map(n => n.getId())).toEqual(['a', 'b'])
    expect(out.map(n => n.isRead())).toEqual([false, true])
    expect(out[0].getActionUrl()).toBe('/fir/1')
    expect(out[0].getSeverity()).toBe('WARNING')
  })
})
