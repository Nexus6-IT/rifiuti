/**
 * DeadlineCheckerService — RLS pezzo 2b: scansioni sul client di sistema, lavoro
 * di ogni azienda nel suo contesto.
 *
 * Qui i due client sono mock DISTINTI (nello spec principale condividono le stesse
 * funzioni): un'operazione finita sul client sbagliato fa fallire il test.
 */

import { Test } from '@nestjs/testing'
import { DeadlineCheckerService } from './deadline-checker.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { TemplateService } from '../../infrastructure/email/template.service'
import { EmailService } from '../../infrastructure/email/email.service'
import { LoggerService } from '../../core/logger/logger.service'
import { MudVersionRegistry } from '../mud/export/mud-version.registry'
import { TenantContext } from '../../core/context/tenant-context'
import { calcolaGiorniAllaScadenzaCertificato } from '../../infrastructure/rentri/rentri-certificato-scadenza.util'

jest.mock('../../infrastructure/rentri/rentri-certificato-scadenza.util')
jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))

const mockCalcolaGiorni = calcolaGiorniAllaScadenzaCertificato as jest.Mock

const logger = {
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

function utente(tenantId: string) {
  return {
    id: `u-${tenantId}`,
    tenantId,
    firstName: 'Mario',
    lastName: 'Rossi',
    email: `${tenantId}@esempio.it`,
    role: 'ADMIN',
    tenant: { ragioneSociale: `Azienda ${tenantId}` },
  }
}

/** Costruisce il servizio con due client distinti; la scansione ha un mock per modello. */
async function costruisci() {
  const prisma = {
    mUDReport: { upsert: jest.fn(), findUnique: jest.fn() },
    notification: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    user: { findMany: jest.fn() },
  }
  const sistema = {
    tenant: { findMany: jest.fn().mockResolvedValue([]) },
    autorizzazioneImpianto: { findMany: jest.fn().mockResolvedValue([]) },
    trasportatore: { findMany: jest.fn().mockResolvedValue([]) },
    destinatario: { findMany: jest.fn().mockResolvedValue([]) },
    rentriCredential: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { deleteMany: jest.fn().mockResolvedValue({ count: 3 }) },
  }
  const registry = {
    scadenzaPresentazione: jest.fn().mockReturnValue({ data: '2030-04-30', fonte: 'REGISTRO' }),
  }
  const modulo = await Test.createTestingModule({
    providers: [
      DeadlineCheckerService,
      { provide: PrismaService, useValue: prisma },
      { provide: PrismaSistemaService, useValue: sistema },
      {
        provide: TemplateService,
        useValue: {
          renderMudDeadlineReminder: jest.fn().mockResolvedValue('<html/>'),
          renderAuthorizationExpiration: jest.fn().mockResolvedValue('<html/>'),
        },
      },
      { provide: EmailService, useValue: { sendEmail: jest.fn().mockResolvedValue(undefined) } },
      { provide: LoggerService, useValue: logger },
      { provide: MudVersionRegistry, useValue: registry },
    ],
  }).compile()
  return { service: modulo.get(DeadlineCheckerService), prisma, sistema }
}

describe('DeadlineCheckerService — client di sistema e contesto per azienda', () => {
  beforeEach(() => jest.clearAllMocks())
  afterEach(() => jest.useRealTimers())

  describe('checkMudDeadlines', () => {
    function giornoDiPromemoria() {
      jest.useFakeTimers()
      jest.setSystemTime(new Date(2030, 3, 29)) // 1 giorno prima della scadenza
    }

    it('checkMudDeadlines: elenco delle aziende dal client di sistema', async () => {
      giornoDiPromemoria()
      const { service, sistema } = await costruisci()

      await service.checkMudDeadlines()

      expect(sistema.tenant.findMany).toHaveBeenCalledTimes(1)
    })

    it('checkMudDeadlines: lavoro di ogni azienda nel suo contesto', async () => {
      giornoDiPromemoria()
      const { service, prisma, sistema } = await costruisci()
      sistema.tenant.findMany.mockResolvedValue([
        { id: 't1', ragioneSociale: 'Alfa', mudReports: [], users: [utente('t1')] },
        { id: 't2', ragioneSociale: 'Beta', mudReports: [], users: [utente('t2')] },
      ])
      const visti: Record<string, Array<string | null>> = { upsert: [], create: [] }
      prisma.mUDReport.upsert.mockImplementation(async () => {
        visti.upsert.push(TenantContext.getStoreTenantId())
        return { id: 'm', status: 'DRAFT', reportData: {} }
      })
      prisma.notification.create.mockImplementation(async () => {
        visti.create.push(TenantContext.getStoreTenantId())
        return {}
      })

      await service.checkMudDeadlines()

      expect(visti.upsert).toEqual(['t1', 't2'])
      expect(visti.create).toEqual(['t1', 't2'])
    })
  })

  describe('checkAuthorizationExpirations', () => {
    // Gia scaduta ieri: l'avviso scatta sempre, senza dipendere dall'arrotondamento dei giorni
    function inScadenza(tenantId: string) {
      const ieri = new Date()
      ieri.setDate(ieri.getDate() - 1)
      return { id: `a-${tenantId}`, tenantId, estremi: 'AUT/1', dataScadenza: ieri }
    }

    it('checkAuthorizationExpirations: elenco delle aziende dal client di sistema', async () => {
      const { service, sistema } = await costruisci()

      await service.checkAuthorizationExpirations()

      expect(sistema.autorizzazioneImpianto.findMany).toHaveBeenCalledTimes(1)
      expect(sistema.trasportatore.findMany).toHaveBeenCalledTimes(1)
      expect(sistema.destinatario.findMany).toHaveBeenCalledTimes(1)
    })

    it('checkAuthorizationExpirations: utenti di piu aziende dal client di sistema', async () => {
      const { service, prisma, sistema } = await costruisci()
      sistema.autorizzazioneImpianto.findMany.mockResolvedValue([inScadenza('t1')])

      await service.checkAuthorizationExpirations()

      expect(sistema.user.findMany).toHaveBeenCalledTimes(1)
      expect(prisma.user.findMany).not.toHaveBeenCalled()
    })

    it('checkAuthorizationExpirations: lavoro di ogni azienda nel suo contesto', async () => {
      const { service, prisma, sistema } = await costruisci()
      sistema.autorizzazioneImpianto.findMany.mockResolvedValue([
        inScadenza('t1'),
        inScadenza('t2'),
      ])
      sistema.user.findMany.mockResolvedValue([utente('t1'), utente('t2')])
      const dedup: Array<string | null> = []
      const creazioni: Array<string | null> = []
      prisma.notification.findFirst.mockImplementation(async () => {
        dedup.push(TenantContext.getStoreTenantId())
        return null
      })
      prisma.notification.create.mockImplementation(async () => {
        creazioni.push(TenantContext.getStoreTenantId())
        return {}
      })

      await service.checkAuthorizationExpirations()

      expect(dedup).toEqual(['t1', 't2'])
      expect(creazioni).toEqual(['t1', 't2'])
    })
  })

  describe('checkRentriCertificateExpiration', () => {
    it('checkRentriCertificateExpiration: elenco delle aziende dal client di sistema', async () => {
      const { service, sistema } = await costruisci()

      await service.checkRentriCertificateExpiration()

      expect(sistema.tenant.findMany).toHaveBeenCalledTimes(1)
      expect(sistema.rentriCredential.findMany).toHaveBeenCalledTimes(1)
    })

    it('checkRentriCertificateExpiration: lavoro di ogni azienda nel suo contesto', async () => {
      const { service, prisma, sistema } = await costruisci()
      sistema.tenant.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }])
      sistema.rentriCredential.findMany.mockResolvedValue([
        { tenantId: 't1', certificatePem: 'x' },
        { tenantId: 't2', certificatePem: 'x' },
      ])
      mockCalcolaGiorni.mockReturnValue(15)
      const utentiVisti: Array<string | null> = []
      const creazioni: Array<string | null> = []
      prisma.user.findMany.mockImplementation(async (args: { where: { tenantId: string } }) => {
        utentiVisti.push(TenantContext.getStoreTenantId())
        return [utente(args.where.tenantId)]
      })
      prisma.notification.create.mockImplementation(async () => {
        creazioni.push(TenantContext.getStoreTenantId())
        return {}
      })

      await service.checkRentriCertificateExpiration()

      expect(utentiVisti).toEqual(['t1', 't2'])
      expect(creazioni).toEqual(['t1', 't2'])
    })
  })

  describe('cleanupOldNotifications', () => {
    it('cleanupOldNotifications: pulizia su tutte le aziende dal client di sistema', async () => {
      const { service, sistema } = await costruisci()

      await service.cleanupOldNotifications()

      expect(sistema.notification.deleteMany).toHaveBeenCalledTimes(1)
    })
  })
})
