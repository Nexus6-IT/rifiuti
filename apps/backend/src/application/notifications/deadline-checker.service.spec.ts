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
 *  dopo la prima consegna): una notifica dello stesso tipo, PER LO STESSO
 *  TENANT, per la stessa entità (relatedEntityId + relatedEntityType) non va
 *  ripetuta se ne esiste già una creata negli ultimi 7 giorni — altrimenti
 *  lo stato "già scaduto" genererebbe un avviso identico ogni giorno
 *  all'infinito.
 *   6. autorizzazione: notifica esistente creata ieri, STESSO tenant →
 *      nessuna nuova notifica; verifica che il filtro includa tenantId
 *   7. autorizzazione: notifica esistente creata 10 giorni fa → se ne crea una nuova
 *   8. certificato RENTRI: notifica esistente creata ieri, STESSO tenant →
 *      nessuna nuova notifica; verifica che il filtro includa tenantId
 *   9. certificato RENTRI: notifica esistente creata 10 giorni fa → se ne crea una nuova
 *
 *  Correzione di revisione (giro 1): senza `tenantId` nel filtro di dedup,
 *  una notifica di un ALTRO tenant sulla stessa entità sopprimerebbe
 *  l'avviso dovuto a questo tenant — violazione della regola di isolamento
 *  del progetto (ogni query filtra per tenant). I test 6 e 8 sopra ora
 *  asserisco esplicitamente `tenantId` nel `where` di `findFirst`.
 *  10. limite esatto: una notifica creata esattamente NOTIFICATION_DEDUP_GIORNI
 *      giorni fa conta ancora come "recente" (il confronto è `gte`, incluso
 *      il limite) → nessuna nuova notifica.
 *  11. certificato non analizzabile: genera comunque un avviso in
 *      applicazione (nessuna email, nessun template dedicato — quella
 *      decisione resta invariata), perché il canale in-app esiste già e un
 *      certificato illeggibile non deve restare silenzioso.
 */

import { Test, TestingModule } from '@nestjs/testing'
import * as Sentry from '@sentry/node'
import { DeadlineCheckerService } from './deadline-checker.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { TemplateService } from '../../infrastructure/email/template.service'
import { EmailService } from '../../infrastructure/email/email.service'
import { LoggerService } from '../../core/logger/logger.service'
import { calcolaGiorniAllaScadenzaCertificato } from '../../infrastructure/rentri/rentri-certificato-scadenza.util'

jest.mock('../../infrastructure/rentri/rentri-certificato-scadenza.util')
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

const mockCalcolaGiorni = calcolaGiorniAllaScadenzaCertificato as jest.Mock

const mockPrisma = {
  tenant: {
    findMany: jest.fn(),
  },
  autorizzazioneImpianto: {
    findMany: jest.fn(),
  },
  trasportatore: {
    findMany: jest.fn(),
  },
  destinatario: {
    findMany: jest.fn(),
  },
  rentriCredential: {
    findMany: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
  },
  mUDReport: {
    create: jest.fn(),
  },
  notification: {
    create: jest.fn(),
    findFirst: jest.fn(),
  },
} as unknown as PrismaService

const mockTemplateService = {
  renderAuthorizationExpiration: jest.fn().mockResolvedValue('<html></html>'),
  renderCounterpartyExpiration: jest.fn().mockResolvedValue('<html></html>'),
  renderMudDeadlineReminder: jest.fn().mockResolvedValue('<html></html>'),
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
    ;(mockPrisma.trasportatore.findMany as jest.Mock).mockResolvedValue([])
    ;(mockPrisma.destinatario.findMany as jest.Mock).mockResolvedValue([])
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
            tenantId: 't1',
            type: 'AUTORIZZAZIONE_IN_SCADENZA',
            relatedEntityId: 'a1',
            relatedEntityType: 'AutorizzazioneImpianto',
            createdAt: expect.objectContaining({ gte: expect.any(Date) }),
          }),
        })
      )
      expect(mockPrisma.notification.create).not.toHaveBeenCalled()
    })

    it('la deduplicazione filtra anche per tenantId: non basta stesso tipo e stessa entità', async () => {
      // Regressione del rilievo di revisione: senza `tenantId` nel `where`,
      // una notifica di un ALTRO tenant sulla stessa autorizzazione
      // sopprimerebbe l'avviso dovuto a questo tenant.
      const fra30 = new Date()
      fra30.setDate(fra30.getDate() + 30)
      ;(mockPrisma.autorizzazioneImpianto.findMany as jest.Mock).mockResolvedValue([
        { id: 'a1', tenantId: 't1', estremi: 'AUT/123', dataScadenza: fra30 },
      ])

      await service.checkAuthorizationExpirations()

      const [[argomentiChiamata]] = (mockPrisma.notification.findFirst as jest.Mock).mock.calls
      expect(argomentiChiamata.where).toHaveProperty('tenantId', 't1')
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

    it('decisione esplicita sul limite: una notifica creata esattamente NOTIFICATION_DEDUP_GIORNI giorni fa conta ancora come "recente" (limite incluso)', async () => {
      // Il codice confronta con `createdAt: { gte: sogliaDedup }`: il limite
      // è incluso, quindi una notifica di esattamente 7 giorni fa blocca
      // ancora la creazione di una nuova (finestra di 7 giorni PIENI, non
      // "più di 7 giorni"). Per testarlo in modo deterministico (senza un
      // database Postgres reale che valuti il `gte`) si fissa l'orologio e
      // si fa rispondere al mock esattamente la semantica di `gte`.
      jest.useFakeTimers().setSystemTime(new Date('2026-09-11T10:00:00.000Z'))
      try {
        const fra30 = new Date()
        fra30.setDate(fra30.getDate() + 30)
        ;(mockPrisma.autorizzazioneImpianto.findMany as jest.Mock).mockResolvedValue([
          { id: 'a1', tenantId: 't1', estremi: 'AUT/123', dataScadenza: fra30 },
        ])

        const esattamenteSetteGiorniFa = new Date('2026-09-11T10:00:00.000Z')
        esattamenteSetteGiorniFa.setDate(esattamenteSetteGiorniFa.getDate() - 7)
        ;(mockPrisma.notification.findFirst as jest.Mock).mockImplementationOnce(
          async ({ where }: { where: { createdAt: { gte: Date } } }) => {
            const soglia = where.createdAt.gte
            return esattamenteSetteGiorniFa.getTime() >= soglia.getTime()
              ? { id: 'n-limite', createdAt: esattamenteSetteGiorniFa }
              : null
          }
        )

        await service.checkAuthorizationExpirations()

        expect(mockPrisma.notification.create).not.toHaveBeenCalled()
      } finally {
        jest.useRealTimers()
      }
    })

    // Task 3 dello scadenzario: lo stesso controllo copre anche la scadenza
    // dell'iscrizione dei trasportatori e dell'autorizzazione dei
    // destinatari (dato prima inesistente). Stessa forma delle autorizzazioni
    // impianto, ma con NotificationType e relatedEntityType dedicati — senza
    // questa distinzione la dedup di un tipo sopprimerebbe l'avviso dell'altro
    // a parità di id (v. commento su esisteNotificaRecente).
    it("avvisa quando l'iscrizione di un trasportatore scade fra 30 giorni", async () => {
      const fra30 = new Date()
      fra30.setDate(fra30.getDate() + 30)
      ;(mockPrisma.trasportatore.findMany as jest.Mock).mockResolvedValue([
        { id: 'tr1', tenantId: 't1', numeroIscrizione: 'MI/001234', scadenzaIscrizione: fra30 },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            type: 'TRASPORTATORE_ISCRIZIONE_IN_SCADENZA',
            severity: 'WARNING',
            relatedEntityId: 'tr1',
            relatedEntityType: 'Trasportatore',
          }),
        })
      )
    })

    it("avvisa con severità ERROR quando l'iscrizione di un trasportatore è già scaduta", async () => {
      const ieri = new Date()
      ieri.setDate(ieri.getDate() - 1)
      ;(mockPrisma.trasportatore.findMany as jest.Mock).mockResolvedValue([
        { id: 'tr2', tenantId: 't1', numeroIscrizione: 'MI/009999', scadenzaIscrizione: ieri },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'TRASPORTATORE_ISCRIZIONE_IN_SCADENZA',
            severity: 'ERROR',
            message: expect.stringContaining('è scaduta'),
          }),
        })
      )
    })

    it("avvisa quando l'autorizzazione di un destinatario scade fra 15 giorni", async () => {
      const fra15 = new Date()
      fra15.setDate(fra15.getDate() + 15)
      ;(mockPrisma.destinatario.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'de1',
          tenantId: 't1',
          numeroAutorizzazione: 'NA/AUT/2023/001',
          scadenzaAutorizzazione: fra15,
        },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            type: 'DESTINATARIO_AUTORIZZAZIONE_IN_SCADENZA',
            severity: 'WARNING',
            relatedEntityId: 'de1',
            relatedEntityType: 'Destinatario',
          }),
        })
      )
    })

    it("avvisa con severità ERROR quando l'autorizzazione di un destinatario è già scaduta", async () => {
      const ieri = new Date()
      ieri.setDate(ieri.getDate() - 1)
      ;(mockPrisma.destinatario.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'de2',
          tenantId: 't1',
          numeroAutorizzazione: 'NA/AUT/2023/999',
          scadenzaAutorizzazione: ieri,
        },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'DESTINATARIO_AUTORIZZAZIONE_IN_SCADENZA',
            severity: 'ERROR',
            message: expect.stringContaining('è scaduta'),
          }),
        })
      )
    })

    it('non avvisa per un trasportatore se i giorni mancanti non sono un intervallo previsto', async () => {
      const fra20 = new Date()
      fra20.setDate(fra20.getDate() + 20)
      ;(mockPrisma.trasportatore.findMany as jest.Mock).mockResolvedValue([
        { id: 'tr3', tenantId: 't1', numeroIscrizione: 'MI/000001', scadenzaIscrizione: fra20 },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).not.toHaveBeenCalled()
    })

    it("non invia un link morto: l'autorizzazione impianto non ha una pagina di dettaglio, quindi né la notifica né l'email includono un actionUrl inventato", async () => {
      // Rilievo critico di revisione: `/impianti/autorizzazioni/${id}` non
      // esiste in app.routes.ts (il catch-all reindirizza al cruscotto), e
      // proporre un link che sembra portare da qualche parte ma torna al
      // cruscotto è peggio di nessun link.
      const fra30 = new Date()
      fra30.setDate(fra30.getDate() + 30)
      ;(mockPrisma.autorizzazioneImpianto.findMany as jest.Mock).mockResolvedValue([
        { id: 'a1', tenantId: 't1', estremi: 'AUT/123', dataScadenza: fra30 },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ actionUrl: expect.stringContaining('impianti') }),
        })
      )
      const [[argomentiNotifica]] = (mockPrisma.notification.create as jest.Mock).mock.calls
      expect(argomentiNotifica.data.actionUrl).toBeUndefined()

      expect(mockTemplateService.renderAuthorizationExpiration).toHaveBeenCalledWith(
        expect.objectContaining({ authorizationUrl: undefined })
      )
    })

    it('il certificato RENTRI usa la rotta reale del frontend (rentri/certificato), non /rentri/credenziali che non esiste', async () => {
      // Le due occorrenze in checkRentriCertificateExpiration (illeggibile e
      // in scadenza) puntavano a `/rentri/credenziali`; in app.routes.ts la
      // rotta è `rentri/certificato`.
      mockCalcolaGiorni.mockReturnValue(15)
      ;(mockPrisma.rentriCredential.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 't1', certificatePem: 'PEM-FASULLO' },
      ])

      await service.checkRentriCertificateExpiration()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionUrl: '/rentri/certificato' }),
        })
      )
    })

    it('il ramo "certificato non analizzabile" usa anch\'esso la rotta reale rentri/certificato', async () => {
      mockCalcolaGiorni.mockReturnValue(null)
      ;(mockPrisma.rentriCredential.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 't1', certificatePem: 'PEM-NON-VALIDO' },
      ])

      await service.checkRentriCertificateExpiration()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionUrl: '/rentri/certificato' }),
        })
      )
    })

    it("manda anche l'email quando l'iscrizione di un trasportatore è in scadenza (non solo la notifica in applicazione)", async () => {
      // Rilievo di revisione (importante): a differenza del certificato
      // RENTRI (dove l'email manca perché non esiste un template dedicato),
      // qui il modello e il canale email esistono già e sono usati per le
      // autorizzazioni impianto — non c'è nulla da inventare, quindi
      // l'email va inviata anche per trasportatori/destinatari.
      const fra30 = new Date()
      fra30.setDate(fra30.getDate() + 30)
      ;(mockPrisma.trasportatore.findMany as jest.Mock).mockResolvedValue([
        { id: 'tr1', tenantId: 't1', numeroIscrizione: 'MI/001234', scadenzaIscrizione: fra30 },
      ])

      await service.checkAuthorizationExpirations()

      // Rilievo critico di revisione (giro 2): un trasportatore/destinatario
      // è un soggetto TERZO in anagrafica, non l'azienda del destinatario
      // dell'email — il modello `authorization-expiration` (che parla di
      // "autorizzazione della tua azienda" e di reato ex D.Lgs. 152/2006)
      // è FALSO in questo scenario. Va usato il modello dedicato
      // `renderCounterpartyExpiration`, mai quello delle autorizzazioni
      // impianto.
      expect(mockTemplateService.renderAuthorizationExpiration).not.toHaveBeenCalled()
      expect(mockTemplateService.renderCounterpartyExpiration).toHaveBeenCalledWith(
        expect.objectContaining({
          counterpartyKind: 'trasportatore',
          isExpired: false,
          // Rilievo importante di revisione: l'email è un canale assoluto,
          // un link relativo non è risolvibile da un client di posta —
          // a differenza della notifica in applicazione (v. test dedicato
          // più sotto), che resta correttamente relativa.
          counterpartyUrl: expect.stringMatching(/^https?:\/\/.+\/trasportatori$/),
        })
      )
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: utenteFixture().email })
      )
    })

    it("manda anche l'email quando l'autorizzazione di un destinatario è scaduta, con rotta /destinatari", async () => {
      const ieri = new Date()
      ieri.setDate(ieri.getDate() - 1)
      ;(mockPrisma.destinatario.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'de2',
          tenantId: 't1',
          numeroAutorizzazione: 'NA/AUT/2023/999',
          scadenzaAutorizzazione: ieri,
        },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockTemplateService.renderAuthorizationExpiration).not.toHaveBeenCalled()
      expect(mockTemplateService.renderCounterpartyExpiration).toHaveBeenCalledWith(
        expect.objectContaining({
          counterpartyKind: 'destinatario',
          isExpired: true,
          counterpartyUrl: expect.stringMatching(/^https?:\/\/.+\/destinatari$/),
        })
      )
      expect(mockEmailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: utenteFixture().email })
      )
    })

    it("nella notifica in applicazione (non email) l'actionUrl del trasportatore resta relativo — solo l'email ha bisogno di un URL assoluto", async () => {
      const fra30 = new Date()
      fra30.setDate(fra30.getDate() + 30)
      ;(mockPrisma.trasportatore.findMany as jest.Mock).mockResolvedValue([
        { id: 'tr1', tenantId: 't1', numeroIscrizione: 'MI/001234', scadenzaIscrizione: fra30 },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionUrl: '/trasportatori' }),
        })
      )
    })

    it("nella notifica in applicazione (non email) l'actionUrl del destinatario resta relativo", async () => {
      const ieri = new Date()
      ieri.setDate(ieri.getDate() - 1)
      ;(mockPrisma.destinatario.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'de2',
          tenantId: 't1',
          numeroAutorizzazione: 'NA/AUT/2023/999',
          scadenzaAutorizzazione: ieri,
        },
      ])

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionUrl: '/destinatari' }),
        })
      )
    })

    it('non crea una nuova notifica per lo stesso trasportatore se una esiste già negli ultimi 7 giorni (dedup per tenantId)', async () => {
      const fra30 = new Date()
      fra30.setDate(fra30.getDate() + 30)
      ;(mockPrisma.trasportatore.findMany as jest.Mock).mockResolvedValue([
        { id: 'tr1', tenantId: 't1', numeroIscrizione: 'MI/001234', scadenzaIscrizione: fra30 },
      ])
      ;(mockPrisma.notification.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'n-esistente',
        createdAt: new Date(),
      })

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 't1',
            type: 'TRASPORTATORE_ISCRIZIONE_IN_SCADENZA',
            relatedEntityId: 'tr1',
            relatedEntityType: 'Trasportatore',
          }),
        })
      )
      expect(mockPrisma.notification.create).not.toHaveBeenCalled()
    })

    it('un guasto SMTP non sopprime la notifica in applicazione: la notifica nasce anche se sendEmail fallisce', async () => {
      // Difetto di revisione: la notifica in-app veniva creata DOPO
      // sendEmail, nello stesso try. In un ambiente senza SMTP l'eccezione
      // veniva loggata e la notifica non nasceva mai — l'unico canale che
      // funziona sempre restava silenzioso proprio quando la posta è rotta.
      const fra30 = new Date()
      fra30.setDate(fra30.getDate() + 30)
      ;(mockPrisma.trasportatore.findMany as jest.Mock).mockResolvedValue([
        { id: 'tr1', tenantId: 't1', numeroIscrizione: 'MI/001234', scadenzaIscrizione: fra30 },
      ])
      ;(mockEmailService.sendEmail as jest.Mock).mockRejectedValueOnce(
        new Error('connessione SMTP rifiutata')
      )

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'TRASPORTATORE_ISCRIZIONE_IN_SCADENZA',
            relatedEntityId: 'tr1',
          }),
        })
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invio email'),
        expect.any(Error)
      )
    })

    it("un guasto SMTP non sopprime la notifica in applicazione per un'autorizzazione impianto scaduta", async () => {
      // Stesso difetto del test precedente ma nel ramo AUTORIZZAZIONI
      // IMPIANTO dello stesso metodo checkAuthorizationExpirations, dove la
      // revisione ha trovato sendEmail e notification.create ancora nello
      // stesso try/catch, nello stesso ordine sbagliato — non basta
      // correggere un ramo su tre.
      const ieri = new Date()
      ieri.setDate(ieri.getDate() - 1)
      ;(mockPrisma.autorizzazioneImpianto.findMany as jest.Mock).mockResolvedValue([
        { id: 'a1', tenantId: 't1', estremi: 'AUT/123', dataScadenza: ieri },
      ])
      ;(mockEmailService.sendEmail as jest.Mock).mockRejectedValueOnce(
        new Error('connessione SMTP rifiutata')
      )

      await service.checkAuthorizationExpirations()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'AUTORIZZAZIONE_IN_SCADENZA',
            relatedEntityId: 'a1',
            severity: 'ERROR',
          }),
        })
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invio email'),
        expect.any(Error)
      )
    })
  })

  describe('checkMudDeadlines', () => {
    afterEach(() => {
      jest.useRealTimers()
    })

    it('un guasto SMTP non sopprime la notifica in applicazione per il promemoria MUD', async () => {
      // Terzo ramo con lo stesso difetto: checkMudDeadlines creava la
      // notifica DOPO sendEmail, nello stesso try/catch — correggere solo
      // elaboraScadenzaControparte lasciava in piedi esattamente lo stesso
      // problema qui (SMTP giù + scadenza MUD del 30 aprile = nessun
      // avviso in applicazione).
      jest.useFakeTimers()
      // 1 giorno prima della scadenza MUD (30 aprile): 29 aprile. Non 30
      // giorni prima (31 marzo): quell'intervallo attraversa il cambio d'ora
      // legale di fine marzo, e in un fuso dove l'ora torna indietro fra
      // quella data e il 30 aprile (Auckland, Sydney, Santiago) la differenza
      // di `daysUntilDeadline` non è più 30 giorni esatti in millisecondi ma
      // 30 giorni e un'ora: `Math.ceil` arrotonda a 31 e il metodo esce
      // subito, facendo fallire il test. Un solo giorno di distanza resta
      // dentro un unico offset in qualunque fuso: il test non dipende dal
      // fuso orario di chi lo esegue.
      jest.setSystemTime(new Date(2030, 3, 29))
      ;(mockPrisma.tenant.findMany as jest.Mock).mockResolvedValue([
        {
          id: 't1',
          ragioneSociale: 'Alfa Ambiente Srl',
          mudReports: [],
          users: [utenteFixture()],
        },
      ])
      ;(mockPrisma.mUDReport.create as jest.Mock).mockResolvedValue({
        id: 'mud1',
        status: 'DRAFT',
        reportData: {},
      })
      ;(mockEmailService.sendEmail as jest.Mock).mockRejectedValueOnce(
        new Error('connessione SMTP rifiutata')
      )

      await service.checkMudDeadlines()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'MUD_DEADLINE_APPROACHING',
            tenantId: 't1',
          }),
        })
      )
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Invio email'),
        expect.any(Error)
      )
    })

    it('un errore del job delle scadenze MUD arriva a Bugsink', async () => {
      // 29 aprile: giorno di invio con la scadenza del 30 aprile di domani.
      jest.useFakeTimers().setSystemTime(new Date(2026, 3, 29))
      ;(mockPrisma.tenant.findMany as jest.Mock).mockRejectedValue(new Error('db giù'))

      await expect(service.checkMudDeadlines()).resolves.toBeUndefined()

      expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { job: 'checkMudDeadlines' },
      })
    })

    it("un'azienda non tenuta al MUD non riceve promemoria", async () => {
      // A-W-10: con il flag "MUD non dovuto" non si crea il MUDReport e non partono
      // notifiche né email. Il filtro sta nella query, così l'azienda non arriva al ciclo.
      jest.useFakeTimers().setSystemTime(new Date(2026, 3, 29))
      ;(mockPrisma.tenant.findMany as jest.Mock).mockResolvedValue([])

      await service.checkMudDeadlines()

      expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ mudNonDovuto: false }) })
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

    it('avvisa in applicazione (nessuna email) se il certificato non è analizzabile', async () => {
      // Non c'è un template email per questo caso (decisione presa a monte,
      // non cambiata da questo giro di correzione), ma il canale in-app
      // esiste già: un certificato illeggibile non deve restare silenzioso.
      // `relatedEntityType` è 'RentriCredentialIllegibile', DISTINTO da
      // 'RentriCredential' usato dal ramo "in scadenza" (correzione di
      // revisione, giro 2): stessa entità (`relatedEntityId` = tenantId),
      // ma chiave di deduplicazione diversa per non far collidere le due
      // semantiche.
      mockCalcolaGiorni.mockReturnValue(null)
      ;(mockPrisma.rentriCredential.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 't1', certificatePem: 'PEM-NON-VALIDO' },
      ])

      await service.checkRentriCertificateExpiration()

      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: 't1',
            type: 'CERTIFICATO_RENTRI_IN_SCADENZA',
            severity: 'ERROR',
            relatedEntityId: 't1',
            relatedEntityType: 'RentriCredentialIllegibile',
          }),
        })
      )
      expect(mockEmailService.sendEmail).not.toHaveBeenCalled()
    })

    it('non ripete l\'avviso "certificato non analizzabile" se ne esiste già uno recente', async () => {
      const ieri = new Date()
      ieri.setDate(ieri.getDate() - 1)
      mockCalcolaGiorni.mockReturnValue(null)
      ;(mockPrisma.rentriCredential.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 't1', certificatePem: 'PEM-NON-VALIDO' },
      ])
      ;(mockPrisma.notification.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'n-esistente',
        createdAt: ieri,
      })

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
            tenantId: 't1',
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

    it('non confonde la chiave di dedup del certificato illeggibile con quella del certificato in scadenza (due notifiche distinte)', async () => {
      // Regressione del rilievo di revisione (giro 2): se il ramo
      // "illeggibile" usasse lo stesso `relatedEntityType` del ramo "in
      // scadenza", la dedup basata su
      // `{ tenantId, type, relatedEntityId, relatedEntityType, createdAt }`
      // troverebbe la notifica di ieri (illeggibile) e salterebbe l'avviso
      // legittimo di oggi (in scadenza fra 2 giorni), e viceversa. Simula un
      // mini-database in memoria per `notification.create`/`findFirst` così
      // la seconda chiamata vede davvero cosa ha scritto la prima — un
      // semplice `mockResolvedValueOnce(null)` non lo dimostrerebbe.
      const notificheCreate: Array<{
        tenantId: string
        type: string
        relatedEntityId: string
        relatedEntityType: string
      }> = []

      ;(mockPrisma.notification.create as jest.Mock).mockImplementation(
        async ({ data }: { data: (typeof notificheCreate)[number] }) => {
          notificheCreate.push(data)
          return data
        }
      )
      ;(mockPrisma.notification.findFirst as jest.Mock).mockImplementation(
        async ({
          where,
        }: {
          where: {
            tenantId: string
            type: string
            relatedEntityId: string
            relatedEntityType: string
          }
        }) =>
          notificheCreate.find(
            n =>
              n.tenantId === where.tenantId &&
              n.type === where.type &&
              n.relatedEntityId === where.relatedEntityId &&
              n.relatedEntityType === where.relatedEntityType
          ) ?? null
      )
      ;(mockPrisma.rentriCredential.findMany as jest.Mock).mockResolvedValue([
        { tenantId: 't1', certificatePem: 'PEM-QUALSIASI' },
      ])

      // Giorno T: il certificato non è analizzabile.
      mockCalcolaGiorni.mockReturnValue(null)
      await service.checkRentriCertificateExpiration()

      // Giorno T+2: il certificato è stato corretto ed è a 15 giorni dalla
      // scadenza (un intervallo di avviso previsto).
      mockCalcolaGiorni.mockReturnValue(15)
      await service.checkRentriCertificateExpiration()

      expect(notificheCreate).toHaveLength(2)
      expect(notificheCreate[0].relatedEntityType).not.toBe(notificheCreate[1].relatedEntityType)
    })
  })
})
