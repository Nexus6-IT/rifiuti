/**
 * RENTRISyncLogRepository — de-stubbing del Task 3 (R0)
 *
 * Prima di questa modifica ogni chiamata Prisma era commentata: `save`
 * restituiva l'aggregate senza scrivere nulla, ogni lettura tornava
 * null/[]/0. Questi test verificano il ciclo salva -> rileggi -> ritrova con
 * un doppio di Prisma (la prova contro Postgres vero è nella verifica di
 * integrazione dedicata, fuori da questa suite).
 */
import { RENTRISyncLogRepository } from './rentri-sync-log.repository'
import { RENTRISyncLog } from '../../domain/rentri/rentri-sync-log.aggregate'
import { TenantContext } from '../../core/context/tenant-context'

describe('RENTRISyncLogRepository — persistenza log RENTRI (rentri_sync_logs)', () => {
  let prisma: any
  let repo: RENTRISyncLogRepository

  // Il costruttore non accetta più un tenantId primitivo (rompeva la DI in un
  // contesto multi-tenant, v. commento nel repository): il tenant corrente
  // viene risolto da TenantContext, qui simulato con TenantContext.run come
  // fa già produttore-prisma.repository.spec.ts.
  const perTenant = (fn: () => Promise<void> | void) =>
    TenantContext.run({ tenantId: 'tenant-1' }, fn)

  beforeEach(() => {
    prisma = {
      rENTRISyncLog: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    }
    repo = new RENTRISyncLogRepository(prisma)
  })

  it('createPending scrive la riga su rentri_sync_logs con status PENDING', async () => {
    await repo.createPending({
      id: 'log-1',
      firId: 'fir-1',
      tenantId: 'tenant-1',
      attempt: 1,
      requestPayload: '{"xfir":true}',
    })

    expect(prisma.rENTRISyncLog.upsert).toHaveBeenCalledTimes(1)
    const [{ create }] = prisma.rENTRISyncLog.upsert.mock.calls[0]
    expect(create).toMatchObject({
      id: 'log-1',
      firId: 'fir-1',
      tenantId: 'tenant-1',
      status: 'PENDING',
      attempt: 1,
      requestPayload: '{"xfir":true}',
    })
  })

  it('save del medesimo id con esito finale aggiorna la riga (no violazione PK)', async () => {
    const pending = RENTRISyncLog.createPending({
      id: 'log-1',
      firId: 'fir-1',
      tenantId: 'tenant-1',
      attempt: 1,
      requestPayload: '{}',
    })
    const success = pending.markAsSuccess({
      responsePayload: '{"esito":"ok"}',
      protocolNumber: 'RENTRI-000123',
      durationMs: 250,
    })

    await repo.save(success)

    const [{ where, update }] = prisma.rENTRISyncLog.upsert.mock.calls[0]
    expect(where).toEqual({ id: 'log-1' })
    expect(update).toMatchObject({
      status: 'SUCCESS',
      protocolNumber: 'RENTRI-000123',
      durationMs: 250,
    })
  })

  it('findById rilegge e ricostruisce un log persistito con tutti i campi', async () =>
    perTenant(async () => {
      const syncedAt = new Date('2026-07-26T09:00:00Z')
      prisma.rENTRISyncLog.findFirst.mockResolvedValue({
        id: 'log-1',
        firId: 'fir-1',
        tenantId: 'tenant-1',
        status: 'SUCCESS',
        attempt: 1,
        requestPayload: '{"xfir":true}',
        responsePayload: '{"esito":"ok"}',
        errorMessage: null,
        errorCode: null,
        protocolNumber: 'RENTRI-000123',
        syncedAt,
        durationMs: 250,
        createdAt: new Date('2026-07-26T08:59:00Z'),
      })

      const log = await repo.findById('log-1')

      expect(log).not.toBeNull()
      expect(log!.status).toBe('SUCCESS')
      expect(log!.protocolNumber).toBe('RENTRI-000123')
      expect(log!.responsePayload).toBe('{"esito":"ok"}')
      expect(log!.syncedAt).toEqual(syncedAt)
      expect(log!.durationMs).toBe(250)
    }))

  it('findById cerca solo dentro l’azienda corrente', async () =>
    perTenant(async () => {
      await repo.findById('log-1')

      expect(prisma.rENTRISyncLog.findFirst).toHaveBeenCalledWith({
        where: { id: 'log-1', tenantId: 'tenant-1' },
      })
      // Mai una lookup per solo id: restituirebbe il log di un'altra azienda.
      expect(prisma.rENTRISyncLog.findUnique).not.toHaveBeenCalled()
    }))

  it('findByFIRId filtra per firId e tenant e ordina per data decrescente', async () =>
    perTenant(async () => {
      await repo.findByFIRId('fir-1')

      expect(prisma.rENTRISyncLog.findMany).toHaveBeenCalledWith({
        where: { firId: 'fir-1', tenantId: 'tenant-1' },
        orderBy: { createdAt: 'desc' },
      })
    }))

  it('findById su log inesistente torna null (non uno stub sempre-null indipendente dal dato)', async () =>
    perTenant(async () => {
      prisma.rENTRISyncLog.findFirst.mockResolvedValue(null)

      const log = await repo.findById('non-esiste')

      expect(log).toBeNull()
    }))
})
