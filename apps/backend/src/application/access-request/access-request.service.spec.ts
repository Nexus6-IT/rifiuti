/**
 * AccessRequestService — test unitari.
 *
 * Copertura:
 *  1. submit() persiste la richiesta (stato PENDING) e NON crea tenant/utente
 *  2. submit() invia la notifica admin quando è configurato un destinatario
 *  3. submit() non fallisce se l'invio email fallisce (best-effort)
 *  4. submit() salta la notifica se non c'è alcun destinatario configurato
 *  5. list()/updateStatus() delegano correttamente a Prisma
 */

import { Test, TestingModule } from '@nestjs/testing'
import { AccessRequestStatus } from '@prisma/client'
import { AccessRequestService } from './access-request.service'
import { PrismaService } from '../../infrastructure/persistence/prisma.service'
import { EmailService } from '../../infrastructure/email/email.service'
import { LoggerService } from '../../core/logger/logger.service'
import { AccessRequestDto } from '../../api/access-request/dto/access-request.dto'

const mockPrisma = {
  accessRequest: {
    create: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
} as unknown as PrismaService

const mockEmail = {
  sendEmail: jest.fn(),
} as unknown as EmailService

const mockLogger = {
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as unknown as LoggerService

function makeDto(overrides: Partial<AccessRequestDto> = {}): AccessRequestDto {
  return {
    ragioneSociale: 'Alfa Ambiente Srl',
    partitaIva: '01234567890',
    firstName: 'Mario',
    lastName: 'Rossi',
    email: 'mario.rossi@alfa-ambiente.it',
    phone: '0290000000',
    message: 'Vorremmo provare la piattaforma',
    privacyAccepted: true,
    ...overrides,
  } as AccessRequestDto
}

function makeRequestFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req-uuid-1234',
    createdAt: new Date(),
    updatedAt: new Date(),
    ragioneSociale: 'Alfa Ambiente Srl',
    partitaIva: '01234567890',
    firstName: 'Mario',
    lastName: 'Rossi',
    email: 'mario.rossi@alfa-ambiente.it',
    phone: '0290000000',
    message: 'Vorremmo provare la piattaforma',
    status: AccessRequestStatus.PENDING,
    handledNote: null,
    ...overrides,
  }
}

describe('AccessRequestService', () => {
  let service: AccessRequestService
  const OLD_ENV = process.env

  beforeEach(async () => {
    jest.clearAllMocks()
    process.env = { ...OLD_ENV }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessRequestService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EmailService, useValue: mockEmail },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile()

    service = module.get<AccessRequestService>(AccessRequestService)
  })

  afterAll(() => {
    process.env = OLD_ENV
  })

  it('persiste la richiesta (PENDING) e restituisce requestId + message', async () => {
    process.env.ACCESS_REQUEST_NOTIFY_EMAIL = 'commerciale@wasteflow.it'
    const fixture = makeRequestFixture()
    ;(mockPrisma.accessRequest.create as jest.Mock).mockResolvedValueOnce(fixture)
    ;(mockEmail.sendEmail as jest.Mock).mockResolvedValueOnce(undefined)

    const result = await service.submit(makeDto())

    expect(result.requestId).toBe('req-uuid-1234')
    expect(result.message).toContain('Richiesta ricevuta')
    expect(mockPrisma.accessRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: AccessRequestStatus.PENDING }),
      })
    )
  })

  it('invia la notifica admin quando ACCESS_REQUEST_NOTIFY_EMAIL è impostata', async () => {
    process.env.ACCESS_REQUEST_NOTIFY_EMAIL = 'commerciale@wasteflow.it'
    ;(mockPrisma.accessRequest.create as jest.Mock).mockResolvedValueOnce(makeRequestFixture())
    ;(mockEmail.sendEmail as jest.Mock).mockResolvedValueOnce(undefined)

    await service.submit(makeDto())

    expect(mockEmail.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'commerciale@wasteflow.it' })
    )
  })

  it('non fallisce se la notifica email fallisce (best-effort)', async () => {
    process.env.ACCESS_REQUEST_NOTIFY_EMAIL = 'commerciale@wasteflow.it'
    ;(mockPrisma.accessRequest.create as jest.Mock).mockResolvedValueOnce(makeRequestFixture())
    ;(mockEmail.sendEmail as jest.Mock).mockRejectedValueOnce(new Error('SMTP down'))

    const result = await service.submit(makeDto())

    expect(result.requestId).toBe('req-uuid-1234')
    expect(mockLogger.warn).toHaveBeenCalled()
  })

  it("salta la notifica se non c'è alcun destinatario configurato", async () => {
    delete process.env.ACCESS_REQUEST_NOTIFY_EMAIL
    delete process.env.EMAIL_FROM
    ;(mockPrisma.accessRequest.create as jest.Mock).mockResolvedValueOnce(makeRequestFixture())

    await service.submit(makeDto())

    expect(mockEmail.sendEmail).not.toHaveBeenCalled()
  })

  it('list() filtra per stato e ordina per createdAt desc', async () => {
    ;(mockPrisma.accessRequest.findMany as jest.Mock).mockResolvedValueOnce([])

    await service.list(AccessRequestStatus.PENDING)

    expect(mockPrisma.accessRequest.findMany).toHaveBeenCalledWith({
      where: { status: AccessRequestStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('updateStatus() aggiorna stato e nota', async () => {
    ;(mockPrisma.accessRequest.update as jest.Mock).mockResolvedValueOnce(makeRequestFixture())

    await service.updateStatus('req-uuid-1234', AccessRequestStatus.CONTACTED, 'chiamato')

    expect(mockPrisma.accessRequest.update).toHaveBeenCalledWith({
      where: { id: 'req-uuid-1234' },
      data: { status: AccessRequestStatus.CONTACTED, handledNote: 'chiamato' },
    })
  })
})
