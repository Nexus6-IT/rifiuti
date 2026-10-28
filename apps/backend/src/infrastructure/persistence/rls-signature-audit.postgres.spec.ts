/**
 * RLS pezzo 4, Task 3: l'handler `SignatureAuditHandler` (@OnEvent('FIR_SIGNED')) scrive su
 * `activity_logs` (RLS forzata) col client applicativo `wasteflow_app`. L'evento e' emesso da
 * `ApplySignatureUseCase` con `EventEmitter2.emit` (sincrono, listener NON asincrono) e il
 * listener non e' atteso: il contesto (AsyncLocalStorage) deve propagarsi lo stesso.
 *
 * Qui si riproduce quel percorso con un EventEmitter2 vero e il client app vero. Controllo
 * negativo: fuori dal contesto la riga non viene scritta (l'handler inghiotte l'errore).
 *
 * Eseguire con `npm run test:postgres`.
 */
import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { urlComeRuolo } from '../database/client-come-ruolo'

const urlProprietario =
  process.env.DATABASE_URL ??
  'postgresql://wasteflow:wasteflow_ci@127.0.0.1:55432/wasteflow_ci?schema=public'
process.env.DATABASE_URL = urlComeRuolo(
  'wasteflow_app',
  process.env.DB_APP_PASSWORD ?? 'wasteflow_app_dev',
  urlProprietario
)

import { TenantContext } from '../../core/context/tenant-context'
import { PrismaService, creaPrismaServiceApplicativo } from './prisma.service'
import { SignatureAuditHandler } from '../../application/signatures/signature-audit.handler'

const logger = { setContext() {}, info() {}, warn() {}, error() {}, debug() {} } as never

describe('RLS: signature-audit.handler col ruolo applicativo (Postgres reale)', () => {
  const owner = new PrismaClient({ datasourceUrl: urlProprietario })
  let app: PrismaService
  const run = randomUUID().replace(/-/g, '')
  const sfx = Date.now().toString().slice(-8)
  let tenantId = ''
  let userId = ''

  const evento = () =>
    ({
      userId,
      occurredOn: new Date(),
      payload: {
        tenantId,
        firId: undefined,
        firNumber: `FIR-${run}`,
        role: 'PRODUCER',
        signerFiscalCode: 'RSSMRA80A01H501U',
        signerName: 'Mario Rossi',
        signatureMethod: 'SPID',
        signedAt: new Date(),
        newStatus: 'EMESSO',
      },
    }) as never

  /** Attende che il listener non atteso abbia finito (o rinunci). */
  const attendi = async (cond: () => Promise<boolean>) => {
    for (let i = 0; i < 40; i++) {
      if (await cond()) return true
      await new Promise(r => setTimeout(r, 50))
    }
    return false
  }
  const righe = () => owner.activityLog.count({ where: { tenantId } })

  beforeAll(async () => {
    app = creaPrismaServiceApplicativo()
    await app.onModuleInit()
    tenantId = (
      await owner.tenant.create({
        data: {
          partitaIva: `P${sfx}`.slice(0, 11),
          ragioneSociale: `SigAudit ${run}`,
          codiceFiscale: `SGA${sfx}`.slice(0, 16),
        },
      })
    ).id
    userId = (
      await owner.user.create({
        data: {
          tenantId,
          keycloakId: `kc-sigaudit-${run}`,
          fiscalCode: 'SGDTNT00A00A100Z',
          firstName: 'Prova',
          lastName: 'Audit',
          email: `sigaudit-${run}@example.it`,
          role: 'ADMIN',
        },
      })
    ).id
  })

  afterAll(async () => {
    await owner.activityLog.deleteMany({ where: { tenantId } })
    await owner.user.deleteMany({ where: { tenantId } })
    await owner.tenant.deleteMany({ where: { id: tenantId } })
    await Promise.all([owner.$disconnect(), app.onModuleDestroy()])
  })

  it('FIR_SIGNED emesso nel contesto: la riga di audit viene scritta anche se il listener non e atteso', async () => {
    const emitter = new EventEmitter2()
    const handler = new SignatureAuditHandler(app, logger)
    emitter.on('FIR_SIGNED', e => handler.handleFIRSigned(e)) // come @OnEvent senza `async: true`

    TenantContext.run({ tenantId }, () => {
      emitter.emit('FIR_SIGNED', evento()) // come ApplySignatureUseCase: nessun await
    })

    expect(await attendi(async () => (await righe()) === 1)).toBe(true)
    const riga = await owner.activityLog.findFirstOrThrow({ where: { tenantId } })
    expect(riga.action).toBe('PRODUCER_SIGNATURE_APPLIED')
    expect(riga.userId).toBe(userId)
  })

  it('controllo negativo: fuori dal contesto la RLS rifiuta la scrittura (nessuna riga)', async () => {
    const prima = await righe()
    const handler = new SignatureAuditHandler(app, logger)
    await handler.handleFIRSigned(evento())
    expect(await righe()).toBe(prima)
  })
})
