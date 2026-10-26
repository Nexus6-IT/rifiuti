import { ForbiddenException } from '@nestjs/common'
import { AuditController } from './audit.controller'

/**
 * Verifica che gli endpoint audit (export CSV, statistiche, integrità della
 * catena) siano collegati al repository reale invece di restituire placeholder
 * (blocker #13 TODO_INVENTORY).
 */
describe('AuditController — endpoint collegati al repository', () => {
  let controller: AuditController
  let queryBus: any
  let repo: any
  let roleChangeRepo: any
  // switch di azienda: token su 'tenant-token', azienda selezionata 'tenant-1'
  const req = { tenantId: 'tenant-1', user: { id: 'user-1', tenantId: 'tenant-token' } }

  beforeEach(() => {
    queryBus = { execute: jest.fn() }
    repo = {
      exportToCsv: jest.fn(),
      getStatistics: jest.fn(),
      validateChainIntegrity: jest.fn(),
    }
    roleChangeRepo = {
      findWithFilters: jest.fn(),
    }
    controller = new AuditController(queryBus, repo, roleChangeRepo)
  })

  it('exportAuditTrail invia il CSV prodotto dal repository', async () => {
    repo.exportToCsv.mockResolvedValue('id,timestamp\n1,2026-01-01\n')
    const res: any = { setHeader: jest.fn(), send: jest.fn() }

    await controller.exportAuditTrail(req, res, 'u9', '2026-01-01', '2026-02-01')

    expect(repo.exportToCsv).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      userId: 'u9',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-02-01'),
    })
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv')
    expect(res.send).toHaveBeenCalledWith('id,timestamp\n1,2026-01-01\n')
  })

  it('getAuditStatistics restituisce le statistiche reali del repository', async () => {
    const stats = {
      totalLogs: 10,
      allowedCount: 7,
      deniedCount: 3,
      uniqueUsers: 4,
      topDeniedActions: [{ action: 'fir:delete:all', count: 2 }],
    }
    repo.getStatistics.mockResolvedValue(stats)

    const result = await controller.getAuditStatistics(req)

    expect(repo.getStatistics).toHaveBeenCalledWith('tenant-1', {
      startDate: undefined,
      endDate: undefined,
    })
    expect(result).toEqual({ success: true, data: stats })
  })

  it("validateChainIntegrity propaga l'esito reale della verifica della catena", async () => {
    repo.validateChainIntegrity.mockResolvedValue({
      isValid: false,
      totalLogs: 5,
      firstInvalidLogId: 'log-3',
      error: 'Chain broken at log 3',
    })

    const result = await controller.validateChainIntegrity(req, {})

    expect(repo.validateChainIntegrity).toHaveBeenCalledWith('tenant-1', {
      startDate: undefined,
      endDate: undefined,
    })
    expect(result.data).toEqual({
      isValid: false,
      totalLogs: 5,
      firstInvalidLogId: 'log-3',
      error: 'Chain broken at log 3',
    })
  })

  it('getRoleChanges restituisce lo storico cambi-ruolo dal repository', async () => {
    roleChangeRepo.findWithFilters.mockResolvedValue({
      changes: [
        {
          id: 'rc-1',
          userId: 'u9',
          tenantId: 'tenant-1',
          oldRoleId: 'role-a',
          newRoleId: null,
          changedBy: 'admin-1',
          reason: 'Offboarding',
          timestamp: new Date('2026-01-01'),
          effectiveDate: new Date('2026-01-01'),
          metadata: { roleName: 'OPERATOR' },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
    })

    const result = await controller.getRoleChanges(req, 'u9')

    expect(roleChangeRepo.findWithFilters).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', userId: 'u9', page: 1, pageSize: 50 })
    )
    expect(result.data.changes).toHaveLength(1)
    expect(result.data.changes[0]).toMatchObject({ id: 'rc-1', newRoleId: null })
    expect(result.data.pagination.total).toBe(1)
  })

  it('getAuditTrail: la query usa il tenant selezionato', async () => {
    queryBus.execute.mockResolvedValue({ logs: [], total: 0, page: 1, pageSize: 50 })

    await controller.getAuditTrail(req)

    expect(queryBus.execute.mock.calls[0][0].tenantId).toBe('tenant-1')
  })

  it('reconstructHistoricalPermissions: la query usa il tenant selezionato', async () => {
    queryBus.execute.mockResolvedValue({})

    await controller.reconstructHistoricalPermissions(req, {
      userId: 'u9',
      timestamp: '2026-01-01',
    })

    expect(queryBus.execute.mock.calls[0][0].tenantId).toBe('tenant-1')
  })

  it('senza azienda selezionata: 403 e nessuna lettura', async () => {
    const senza = { user: { id: 'u1' } }

    await expect(controller.getAuditStatistics(senza)).rejects.toBeInstanceOf(ForbiddenException)
    expect(repo.getStatistics).not.toHaveBeenCalled()
  })
})
