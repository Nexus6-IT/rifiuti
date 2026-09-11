/**
 * DeadlineCheckerService — test unitari.
 *
 * Copertura:
 *  Task 1 — checkAuthorizationExpirations (avvisi di scadenza delle
 *  autorizzazioni degli impianti, su AutorizzazioneImpianto.dataScadenza):
 *   1. avvisa quando un'autorizzazione scade fra 30 giorni (WARNING)
 *   2. avvisa con severità ERROR e testo "è scaduta" quando è già scaduta
 *   3. non avvisa se i giorni mancanti non sono un intervallo previsto
 */

import { Test, TestingModule } from '@nestjs/testing'
import { DeadlineCheckerService } from './deadline-checker.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { TemplateService } from '../../infrastructure/email/template.service'
import { EmailService } from '../../infrastructure/email/email.service'
import { LoggerService } from '../../core/logger/logger.service'

const mockPrisma = {
  tenant: {
    findMany: jest.fn(),
  },
  autorizzazioneImpianto: {
    findMany: jest.fn(),
  },
  rentriCredential: {
    findMany: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
  notification: {
    create: jest.fn(),
  },
} as unknown as PrismaService

const mockTemplateService = {
  renderAuthorizationExpiration: jest.fn().mockResolvedValue('<html></html>'),
} as unknown as TemplateService

const mockEmailService = {
  sendEmail: jest.fn().mockResolvedValue(undefined),
} as unknown as EmailService

const mockLogger = {
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as LoggerService

function utenteFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    tenantId: 't1',
    firstName: 'Mario',
    lastName: 'Rossi',
    email: 'mario.rossi@alfa-ambiente.it',
    role: 'ADMIN',
    tenant: { ragioneSociale: 'Alfa Ambiente Srl' },
    ...overrides,
  }
}

describe('DeadlineCheckerService', () => {
  let service: DeadlineCheckerService

  beforeEach(async () => {
    jest.clearAllMocks()
    ;(mockPrisma.user.findMany as jest.Mock).mockResolvedValue([utenteFixture()])
    ;(mockPrisma.tenant.findMany as jest.Mock).mockResolvedValue([{ id: 't1' }])
    ;(mockPrisma.autorizzazioneImpianto.findMany as jest.Mock).mockResolvedValue([])
    ;(mockPrisma.rentriCredential.findMany as jest.Mock).mockResolvedValue([])

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeadlineCheckerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: TemplateService, useValue: mockTemplateService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile()

    service = module.get<DeadlineCheckerService>(DeadlineCheckerService)
  })

  describe('checkAuthorizationExpirations', () => {
    it('avvisa quando un autorizzazione scade fra 30 giorni', async () => {
      const fra30 = new Date()
      fra30.setDate(fra30.getDate() + 30)
      ;(mockPrisma.autorizzazioneImpianto.findMany as jest.Mock).mockResolvedValue([
        { id: 'a1', tenantId: 't1', estremi: 'AUT/123', dataScadenza: fra30 },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            type: 'AUTORIZZAZIONE_IN_SCADENZA',
            severity: 'WARNING',
          }),
        })
      )
    })

    it('avvisa con severità ERROR e testo "è scaduta" quando un autorizzazione è già scaduta', async () => {
      const ieri = new Date()
      ieri.setDate(ieri.getDate() - 1)
      ;(mockPrisma.autorizzazioneImpianto.findMany as jest.Mock).mockResolvedValue([
        { id: 'a2', tenantId: 't1', estremi: 'AUT/999', dataScadenza: ieri },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            type: 'AUTORIZZAZIONE_IN_SCADENZA',
            severity: 'ERROR',
            message: expect.stringContaining('è scaduta'),
          }),
        })
      )
    })

    it('non avvisa se i giorni mancanti non sono un intervallo previsto', async () => {
      const fra20 = new Date()
      fra20.setDate(fra20.getDate() + 20)
      ;(mockPrisma.autorizzazioneImpianto.findMany as jest.Mock).mockResolvedValue([
        { id: 'a3', tenantId: 't1', estremi: 'AUT/555', dataScadenza: fra20 },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).not.toHaveBeenCalled()
    })
  })
})
