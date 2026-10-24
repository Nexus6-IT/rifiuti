import { Job, UnrecoverableError } from 'bullmq'
import { AuditLoggingProcessor } from './audit-logging.job'
import { TenantContext } from '../../core/context/tenant-context'

/**
 * Il processor audit-logging lavora nel contesto dell'azienda del job
 * (RLS pezzo 2c): `TenantContext` reale, il contesto è catturato nei repository simulati.
 */
describe('AuditLoggingProcessor - contesto azienda', () => {
  let processor: AuditLoggingProcessor
  let roleRepo: { save: jest.Mock }
  let auditRepo: { save: jest.Mock; getLatestLog: jest.Mock }

  const creaJob = (data: Record<string, unknown>, type = 'role-change') =>
    ({ id: 'job-1', data: { type, data }, attemptsMade: 0 }) as unknown as Job

  const datiRuolo = (tenantId: unknown) => ({
    userId: 'u1',
    tenantId,
    oldRoleId: 'r1',
    newRoleId: 'r2',
    changedBy: 'admin',
    reason: 'test',
  })

  beforeEach(() => {
    delete process.env.CURRENT_TENANT_ID
    roleRepo = { save: jest.fn() }
    auditRepo = { save: jest.fn(), getLatestLog: jest.fn().mockResolvedValue(null) }
    processor = new AuditLoggingProcessor(roleRepo as any, auditRepo as any)
  })

  it('audit-logging: ogni job nel contesto della sua azienda', async () => {
    const visti: Record<string, string | null> = {}
    roleRepo.save.mockImplementation(async (r: any) => {
      await new Promise(res => setTimeout(res, r.tenantId === 'azienda-A' ? 20 : 1))
      visti[r.tenantId] = TenantContext.getStoreTenantId()
    })

    await Promise.all([
      processor.process(creaJob(datiRuolo('azienda-A'))),
      processor.process(creaJob(datiRuolo('azienda-B'))),
    ])

    expect(visti).toEqual({ 'azienda-A': 'azienda-A', 'azienda-B': 'azienda-B' })
  })

  it('audit-logging: anche il permission-check gira nel contesto', async () => {
    let visto: string | null = 'non-chiamato'
    auditRepo.getLatestLog.mockImplementation(async () => {
      await Promise.resolve()
      visto = TenantContext.getStoreTenantId()
      return null
    })

    await processor.process(
      creaJob(
        {
          userId: 'u1',
          tenantId: 'azienda-C',
          actionAttempted: 'read',
          resourceType: 'fir',
          decision: 'ALLOW',
        },
        'permission-check'
      )
    )

    expect(visto).toBe('azienda-C')
  })

  it.each([undefined, '', '   ', null, 42])(
    'audit-logging: job senza tenantId (%p) fallisce in modo definitivo',
    async tenantId => {
      await expect(processor.process(creaJob(datiRuolo(tenantId)))).rejects.toBeInstanceOf(
        UnrecoverableError
      )
      expect(roleRepo.save).not.toHaveBeenCalled()
      expect(auditRepo.save).not.toHaveBeenCalled()
    }
  )

  it('audit-logging: job senza data fallisce in modo definitivo', async () => {
    await expect(
      processor.process({
        id: 'j',
        data: { type: 'role-change' },
        attemptsMade: 0,
      } as unknown as Job)
    ).rejects.toBeInstanceOf(UnrecoverableError)
  })
})
