/**
 * DeadlineCheckerService — test unitari.
 *
 * Copertura:
 *  Task 1 — checkAuthorizationExpirations (avvisi di scadenza delle
 *  autorizzazioni degli impianti, su AutorizzazioneImpianto.dataScadenza):
 *   1. avvisa quando un'autorizzazione scade fra 30 giorni (WARNING)
 *   2. avvisa con severità ERROR e testo "è scaduta" quando è già scaduta
 *   3. non avvisa se i giorni mancanti non sono un intervallo previsto
 *
 *  Task 2 — checkRentriCertificateExpiration (avviso di scadenza del
 *  certificato RENTRI, riusando calcolaGiorniAllaScadenzaCertificato):
 *   4. avvisa quando il certificato scade fra 15 giorni (WARNING)
 *   5. avvisa con severità ERROR e testo sulle trasmissioni ferme quando è
 *      già scaduto
 *
 *  Deduplicazione settimanale (entrambi i task, richiesta dal coordinatore
 *  dopo la prima consegna): una notifica dello stesso tipo per la stessa
 *  entità (relatedEntityId + relatedEntityType) non va ripetuta se ne esiste
 *  già una creata negli ultimi 7 giorni — altrimenti lo stato "già scaduto"
 *  genererebbe un avviso identico ogni giorno all'infinito.
 *   6. autorizzazione: notifica esistente creata ieri → nessuna nuova notifica
 *   7. autorizzazione: notifica esistente creata 10 giorni fa → se ne crea una nuova
 *   8. certificato RENTRI: notifica esistente creata ieri → nessuna nuova notifica
 *   9. certificato RENTRI: notifica esistente creata 10 giorni fa → se ne crea una nuova
 */

import { Test, TestingModule } from '@nestjs/testing'
import { DeadlineCheckerService } from './deadline-checker.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { TemplateService } from '../../infrastructure/email/template.service'
import { EmailService } from '../../infrastructure/email/email.service'
import { LoggerService } from '../../core/logger/logger.service'
import { calcolaGiorniAllaScadenzaCertificato } from '../../infrastructure/rentri/rentri-certificato-scadenza.util'

jest.mock('../../infrastructure/rentri/rentri-certificato-scadenza.util')

const mockCalcolaGiorni = calcolaGiorniAllaScadenzaCertificato as jest.Mock

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
    findFirst: jest.fn(),
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
    // Default: nessuna notifica recente per la stessa entità, così i test
    // esistenti (senza dedup) restano validi senza doverlo mockare ovunque.
    ;(mockPrisma.notification.findFirst as jest.Mock).mockResolvedValue(null)

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

    it('non crea una nuova notifica se una per la stessa autorizzazione esiste già negli ultimi 7 giorni', async () => {
      const ieri = new Date()
      ieri.setDate(ieri.getDate() - 1)
      ;(mockPrisma.autorizzazioneImpianto.findMany as jest.Mock).mockResolvedValue([
        { id: 'a1', tenantId: 't1', estremi: 'AUT/123', dataScadenza: ieri },
      ])
      ;(mockPrisma.notification.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'n-esistente',
        createdAt: ieri,
      })

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'AUTORIZZAZIONE_IN_SCADENZA',
            relatedEntityId: 'a1',
            relatedEntityType: 'AutorizzazioneImpianto',
            createdAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        })
      )
      expect(mockPrisma.notification.create).not.toHaveBeenCalled()
    })

    it("crea una nuova notifica se l'ultima per la stessa autorizzazione risale a più di 7 giorni fa", async () => {
      const ieri = new Date()
      ieri.setDate(ieri.getDate() - 1)
      ;(mockPrisma.autorizzazioneImpianto.findMany as jest.Mock).mockResolvedValue([
        { id: 'a1', tenantId: 't1', estremi: 'AUT/123', dataScadenza: ieri },
      ])
      // Nessun record entro la finestra di 7 giorni (l'ultimo risale a 10
      // giorni fa, quindi la query filtrata da `createdAt: { gte }` non lo
      // trova): la dedup non deve bloccare la creazione.
      ;(mockPrisma.notification.findFirst as jest.Mock).mockResolvedValueOnce(null)

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            relatedEntityId: 'a1',
            relatedEntityType: 'AutorizzazioneImpianto',
            type: 'AUTORIZZAZIONE_IN_SCADENZA',
          }),
        })
      )
    })
  })

  describe('checkRentriCertificateExpiration', () => {
    it('avvisa quando il certificato RENTRI scade fra 15 giorni', async () => {
      mockCalcolaGiorni.mockReturnValue(15)
      ;(mockPrisma.rentriCredential.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 't1', certificatePem: 'PEM-FASULLO' },
      ])

      await service.checkRentriCertificateExpiration()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            type: 'CERTIFICATO_RENTRI_IN_SCADENZA',
            severity: 'WARNING',
          }),
        })
      )
    })

    it('avvisa con severità ERROR quando il certificato RENTRI è già scaduto', async () => {
      mockCalcolaGiorni.mockReturnValue(-2)
      ;(mockPrisma.rentriCredential.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 't1', certificatePem: 'PEM-FASULLO' },
      ])

      await service.checkRentriCertificateExpiration()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            type: 'CERTIFICATO_RENTRI_IN_SCADENZA',
            severity: 'ERROR',
            message: expect.stringContaining('trasmissioni'),
          }),
        })
      )
    })

    it('non avvisa se il certificato non è analizzabile (giorni non calcolabili)', async () => {
      mockCalcolaGiorni.mockReturnValue(null)
      ;(mockPrisma.rentriCredential.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 't1', certificatePem: 'PEM-NON-VALIDO' },
      ])

      await service.checkRentriCertificateExpiration()

      expect(mockPrisma.notification.create).not.toHaveBeenCalled()
    })

    it('non crea una nuova notifica se una per lo stesso certificato esiste già negli ultimi 7 giorni', async () => {
      const ieri = new Date()
      ieri.setDate(ieri.getDate() - 1)
      mockCalcolaGiorni.mockReturnValue(-2)
      ;(mockPrisma.rentriCredential.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 't1', certificatePem: 'PEM-FASULLO' },
      ])
      ;(mockPrisma.notification.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'n-esistente',
        createdAt: ieri,
      })

      await service.checkRentriCertificateExpiration()

      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'CERTIFICATO_RENTRI_IN_SCADENZA',
            relatedEntityId: 't1',
            relatedEntityType: 'RentriCredential',
            createdAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        })
      )
      expect(mockPrisma.notification.create).not.toHaveBeenCalled()
    })

    it("crea una nuova notifica se l'ultima per lo stesso certificato risale a più di 7 giorni fa", async () => {
      mockCalcolaGiorni.mockReturnValue(-2)
      ;(mockPrisma.rentriCredential.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 't1', certificatePem: 'PEM-FASULLO' },
      ])
      ;(mockPrisma.notification.findFirst as jest.Mock).mockResolvedValueOnce(null)

      await service.checkRentriCertificateExpiration()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            relatedEntityId: 't1',
            relatedEntityType: 'RentriCredential',
            type: 'CERTIFICATO_RENTRI_IN_SCADENZA',
          }),
        })
      )
    })
  })
})
