/**
 * DeadlineCheckerService.checkTermineTrasmissioneRegistro (eREGI E0, T3): avviso in applicazione
 * ed email quando il termine mensile di trasmissione del registro RENTRI e' a 5 giorni o meno,
 * o superato. Una notifica per registro e per giorno (Roma), mai doppioni.
 */
import { Test } from '@nestjs/testing'
import { DeadlineCheckerService } from './deadline-checker.service'
import { PrismaService } from '../../infrastructure/database/prisma.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { TemplateService } from '../../infrastructure/email/template.service'
import { EmailService } from '../../infrastructure/email/email.service'
import { LoggerService } from '../../core/logger/logger.service'
import { MudVersionRegistry } from '../mud/export/mud-version.registry'
import { annotazioniPiuVecchieDaTrasmettere } from '../rentri/registro/scadenza-trasmissione-rentri'

jest.mock('@sentry/node', () => ({ captureException: jest.fn() }))
jest.mock('../rentri/registro/scadenza-trasmissione-rentri', () => ({
  ...jest.requireActual('../rentri/registro/scadenza-trasmissione-rentri'),
  annotazioniPiuVecchieDaTrasmettere: jest.fn(),
}))
const piuVecchie = annotazioniPiuVecchieDaTrasmettere as jest.Mock

const prisma = {
  $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  registroRifiuti: { findMany: jest.fn() },
  user: { findMany: jest.fn() },
  notification: { create: jest.fn(), findFirst: jest.fn() },
  tenant: { findFirst: jest.fn() },
}
const sistema = { tenant: { findMany: jest.fn() } }
const template = { renderTermineTrasmissioneRegistro: jest.fn().mockResolvedValue('<html/>') }
const email = { sendEmail: jest.fn().mockResolvedValue(undefined) }
const logger = {
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}

const utente = (id: string, ruolo = 'ADMIN') => ({
  id,
  firstName: 'Mario',
  lastName: id,
  email: `${id}@esempio.it`,
  role: ruolo,
})

describe('checkTermineTrasmissioneRegistro', () => {
  let service: DeadlineCheckerService

  beforeEach(async () => {
    jest.clearAllMocks()
    jest.useFakeTimers().setSystemTime(new Date('2026-02-24T08:00:00Z')) // termine 28/02: 4 giorni
    sistema.tenant.findMany.mockResolvedValue([{ id: 't1', ragioneSociale: 'Alfa Srl' }])
    prisma.registroRifiuti.findMany.mockResolvedValue([{ id: 'r1', descrizione: 'Sede Milano' }])
    prisma.user.findMany.mockResolvedValue([utente('u1'), utente('u2', 'OPERATOR')])
    prisma.notification.findFirst.mockResolvedValue(null)
    prisma.notification.create.mockResolvedValue({})
    piuVecchie.mockResolvedValue(new Map([['r1', new Date('2026-01-10T10:00:00Z')]]))
    const modulo = await Test.createTestingModule({
      providers: [
        DeadlineCheckerService,
        MudVersionRegistry,
        { provide: PrismaService, useValue: prisma },
        { provide: PrismaSistemaService, useValue: sistema },
        { provide: TemplateService, useValue: template },
        { provide: EmailService, useValue: email },
        { provide: LoggerService, useValue: logger },
      ],
    }).compile()
    service = modulo.get(DeadlineCheckerService)
  })
  afterEach(() => jest.useRealTimers())

  it('a 4 giorni dal termine: notifica WARNING e email a ogni admin/operatore', async () => {
    await service.checkTermineTrasmissioneRegistro()
    expect(prisma.notification.create).toHaveBeenCalledTimes(2)
    const dati = prisma.notification.create.mock.calls[0][0].data
    expect(dati).toMatchObject({
      tenantId: 't1',
      userId: 'u1',
      type: 'TRASMISSIONE_REGISTRO_IN_SCADENZA',
      severity: 'WARNING',
      relatedEntityId: 'r1',
      relatedEntityType: 'RegistroRifiuti',
    })
    expect(dati.message).toContain('28/02/2026')
    expect(email.sendEmail).toHaveBeenCalledTimes(2)
    expect(template.renderTermineTrasmissioneRegistro).toHaveBeenCalledWith(
      expect.objectContaining({
        termine: '28/02/2026',
        isExpired: false,
        daysRemaining: 4,
        meseAnnotazioni: '01/2026',
        registroDescrizione: 'Sede Milano',
        companyName: 'Alfa Srl',
      })
    )
  })

  it('i destinatari sono solo ADMIN e OPERATOR dell’azienda', async () => {
    await service.checkTermineTrasmissioneRegistro()
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 't1', role: { in: ['ADMIN', 'OPERATOR'] } },
      })
    )
  })

  it('a più di 5 giorni dal termine: nessun avviso', async () => {
    jest.setSystemTime(new Date('2026-02-20T08:00:00Z')) // 8 giorni
    await service.checkTermineTrasmissioneRegistro()
    expect(prisma.notification.create).not.toHaveBeenCalled()
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('esattamente a 5 giorni: avviso', async () => {
    jest.setSystemTime(new Date('2026-02-23T08:00:00Z'))
    await service.checkTermineTrasmissioneRegistro()
    expect(prisma.notification.create).toHaveBeenCalledTimes(2)
  })

  it('termine superato: ERROR, testo di scadenza, giorni di ritardo', async () => {
    jest.setSystemTime(new Date('2026-03-03T08:00:00Z'))
    await service.checkTermineTrasmissioneRegistro()
    const dati = prisma.notification.create.mock.calls[0][0].data
    expect(dati.severity).toBe('ERROR')
    expect(dati.message).toContain('superato')
    expect(template.renderTermineTrasmissioneRegistro).toHaveBeenCalledWith(
      expect.objectContaining({ isExpired: true, daysOverdue: 3 })
    )
  })

  it('una sola notifica per registro e giorno: se esiste già oggi, salta (filtro su tenant e giorno di Roma)', async () => {
    prisma.notification.findFirst.mockResolvedValue({ id: 'gia' })
    await service.checkTermineTrasmissioneRegistro()
    expect(prisma.notification.create).not.toHaveBeenCalled()
    expect(email.sendEmail).not.toHaveBeenCalled()
    const where = prisma.notification.findFirst.mock.calls[0][0].where
    expect(where).toMatchObject({
      tenantId: 't1',
      type: 'TRASMISSIONE_REGISTRO_IN_SCADENZA',
      relatedEntityId: 'r1',
      userId: 'u1',
    })
    // mezzanotte di Roma del 24/02/2026 = 23:00 UTC del 23/02
    expect(where.createdAt.gte).toEqual(new Date('2026-02-23T23:00:00Z'))
  })

  it('la dedup è per utente: chi ha già l’avviso di oggi non lo riceve, gli altri sì', async () => {
    prisma.notification.findFirst.mockImplementation(async (a: { where: { userId: string } }) =>
      a.where.userId === 'u1' ? { id: 'gia' } : null
    )
    await service.checkTermineTrasmissioneRegistro()
    expect(prisma.notification.create).toHaveBeenCalledTimes(1)
    expect(prisma.notification.create.mock.calls[0][0].data.userId).toBe('u2')
    expect(email.sendEmail).toHaveBeenCalledTimes(1)
  })

  it('nessuna annotazione da trasmettere: nessun avviso', async () => {
    piuVecchie.mockResolvedValue(new Map())
    await service.checkTermineTrasmissioneRegistro()
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })

  it('un registro ciascuno: avvisa solo quelli in scadenza', async () => {
    prisma.registroRifiuti.findMany.mockResolvedValue([
      { id: 'r1', descrizione: 'A' },
      { id: 'r2', descrizione: 'B' },
    ])
    piuVecchie.mockResolvedValue(
      new Map([
        ['r1', new Date('2026-01-10T10:00:00Z')], // termine 28/02: avvisa
        ['r2', new Date('2026-02-10T10:00:00Z')], // termine 31/03: no
      ])
    )
    await service.checkTermineTrasmissioneRegistro()
    const registri = prisma.notification.create.mock.calls.map(c => c[0].data.relatedEntityId)
    expect(new Set(registri)).toEqual(new Set(['r1']))
  })

  it('il guasto dell’email non toglie la notifica in applicazione e non ferma gli altri', async () => {
    email.sendEmail.mockRejectedValueOnce(new Error('smtp giù'))
    await service.checkTermineTrasmissioneRegistro()
    expect(prisma.notification.create).toHaveBeenCalledTimes(2)
    expect(email.sendEmail).toHaveBeenCalledTimes(2)
  })

  it('un’azienda in errore non ferma le altre', async () => {
    sistema.tenant.findMany.mockResolvedValue([
      { id: 't0', ragioneSociale: 'Rotta' },
      { id: 't1', ragioneSociale: 'Alfa Srl' },
    ])
    prisma.registroRifiuti.findMany
      .mockRejectedValueOnce(new Error('db'))
      .mockResolvedValue([{ id: 'r1', descrizione: 'Sede Milano' }])
    await service.checkTermineTrasmissioneRegistro()
    expect(prisma.notification.create).toHaveBeenCalledTimes(2)
  })

  it('l’elenco delle aziende è limitato a quelle con un registro collegato a RENTRI', async () => {
    await service.checkTermineTrasmissioneRegistro()
    expect(JSON.stringify(sistema.tenant.findMany.mock.calls[0][0].where)).toContain(
      'identificativoRentri'
    )
  })
})
