/**
 * NotificationEscalationService — RLS pezzo 2b: la scansione delle notifiche non lette di
 * tutte le aziende passa dal client di sistema, ogni escalation gira nel contesto della
 * sua azienda.
 */

import { Test } from '@nestjs/testing'
import { NotificationEscalationService } from './notification-escalation.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { EmailService } from '../../infrastructure/email/email.service'
import { LoggerService } from '../../core/logger/logger.service'
import { TenantContext } from '../../core/context/tenant-context'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

const logger = {
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function notifica(id: string, tenantId: string, severity: 'WARNING' | 'ERROR') {
  return {
    id,
    title: `Titolo ${id}`,
    message: 'messaggio',
    severity,
    actionUrl: null,
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    user: { firstName: 'Op', lastName: 'Eratore', email: `op@${tenantId}.it` },
    tenant: {
      id: tenantId,
      users: [
        { id: `adm-${tenantId}`, firstName: 'Ad', lastName: 'Min', email: `a@${tenantId}.it` },
      ],
    },
  }
}

async function costruisci() {
  const prisma = {
    notification: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
  }
  const sistema = { notification: { findMany: jest.fn().mockResolvedValue([]) } }
  const modulo = await Test.createTestingModule({
    providers: [
      NotificationEscalationService,
      { provide: PrismaService, useValue: prisma },
      { provide: PrismaSistemaService, useValue: sistema },
      { provide: EmailService, useValue: { sendEmail: jest.fn().mockResolvedValue(undefined) } },
      { provide: LoggerService, useValue: logger },
    ],
  }).compile()
  return { service: modulo.get(NotificationEscalationService), prisma, sistema }
}

describe('NotificationEscalationService — client di sistema e contesto per azienda', () => {
  beforeEach(() => jest.clearAllMocks())

  it('checkEscalations: elenco delle notifiche di tutte le aziende dal client di sistema', async () => {
    const { service, sistema } = await costruisci()

    await service.checkEscalations()

    // una scansione per i WARNING e una per gli ERROR
    expect(sistema.notification.findMany).toHaveBeenCalledTimes(2)
  })

  it('checkEscalations: lavoro di ogni azienda nel suo contesto', async () => {
    const { service, prisma, sistema } = await costruisci()
    sistema.notification.findMany.mockImplementation(
      async (args: { where: { severity: string } }) =>
        args.where.severity === 'WARNING'
          ? [notifica('n1', 't1', 'WARNING')]
          : [notifica('n2', 't2', 'ERROR')]
    )
    const flag: Array<string | null> = []
    const creazioni: Array<string | null> = []
    prisma.notification.findFirst.mockImplementation(async () => {
      flag.push(TenantContext.getStoreTenantId())
      return null
    })
    prisma.notification.create.mockImplementation(async () => {
      creazioni.push(TenantContext.getStoreTenantId())
      return {}
    })

    await service.checkEscalations()

    expect(flag).toEqual(['t1', 't2'])
    expect(creazioni).toEqual(['t1', 't2'])
  })
})
