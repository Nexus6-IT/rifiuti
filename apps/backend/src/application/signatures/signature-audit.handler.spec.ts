import { SignatureAuditHandler } from './signature-audit.handler'

/**
 * Verifica il fix #12: l'audit della firma usa l'ID utente reale (event.userId),
 * non il codice fiscale del firmatario (dato personale, campo errato).
 */
describe('SignatureAuditHandler', () => {
  let handler: SignatureAuditHandler
  let prisma: any
  let logger: any

  beforeEach(() => {
    prisma = { activityLog: { create: jest.fn().mockResolvedValue({}) } }
    logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
    handler = new SignatureAuditHandler(prisma, logger)
  })

  function signedEvent(overrides: any = {}) {
    return {
      userId: overrides.userId,
      occurredOn: new Date('2026-06-13'),
      payload: {
        tenantId: 'tenant-1',
        firId: 'fir-1',
        firNumber: 'FIR-1',
        role: 'PRODUCER',
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        signatureMethod: 'SPID',
        signedAt: new Date('2026-06-13'),
        newStatus: 'EMESSO',
      },
    } as any
  }

  it('usa event.userId come userId dell\'audit (non il codice fiscale)', async () => {
    await handler.handleFIRSigned(signedEvent({ userId: 'user-123' }))

    const data = prisma.activityLog.create.mock.calls[0][0].data
    expect(data.userId).toBe('user-123')
    // il codice fiscale resta solo nei metadata, non come userId
    expect(data.metadata.signerFiscalCode).toBe('RSSMRA80A01H501U')
  })

  it('ricade sul codice fiscale solo se userId assente (retro-compatibilità)', async () => {
    await handler.handleFIRSigned(signedEvent({ userId: undefined }))

    const data = prisma.activityLog.create.mock.calls[0][0].data
    expect(data.userId).toBe('RSSMRA80A01H501U')
  })
})
