import { ForbiddenException } from '@nestjs/common'
import { ContractController } from './contract.controller'

/**
 * ContractController riceveva già l'azienda attiva dal `CurrentUser` di `auth/decorators` (il valore
 * selezionato, non quello del token): questi test sono una guardia contro regressioni, non la
 * prova di un difetto trovato.
 */
describe('ContractController — azienda selezionata', () => {
  // switch di azienda: il token resta sul tenant A, l'azienda selezionata è B
  const req = { tenantId: 'B', user: { id: 'u1', tenantId: 'A', role: 'ADMIN' } }
  let service: Record<string, jest.Mock>
  let controller: ContractController

  beforeEach(() => {
    service = {
      create: jest.fn().mockResolvedValue({}),
      list: jest.fn().mockResolvedValue([]),
      getAutoFillForFir: jest.fn().mockResolvedValue(null),
      nextContractNumber: jest.fn().mockResolvedValue('CTR-2026-1'),
      getById: jest.fn().mockResolvedValue({}),
      changeStatus: jest.fn().mockResolvedValue({}),
    }
    controller = new ContractController(service as any)
  })

  it("create: usa l'azienda selezionata", async () => {
    await controller.create({ startDate: '2026-01-01' } as any, req)
    expect(service.create.mock.calls[0][0]).toBe('B')
  })

  it("list: usa l'azienda selezionata", async () => {
    await controller.list(req, 'ACTIVE' as any)
    expect(service.list).toHaveBeenCalledWith('B', 'ACTIVE')
  })

  it("autoFill: usa l'azienda selezionata", async () => {
    await controller.autoFill(req, 'p1', '15 01 01')
    expect(service.getAutoFillForFir).toHaveBeenCalledWith('B', 'p1', '15 01 01')
  })

  it("nextNumber: usa l'azienda selezionata", async () => {
    await controller.nextNumber(req)
    expect(service.nextContractNumber).toHaveBeenCalledWith('B')
  })

  it("getById: usa l'azienda selezionata", async () => {
    await controller.getById('c1', req)
    expect(service.getById).toHaveBeenCalledWith('B', 'c1')
  })

  it("changeStatus: usa l'azienda selezionata", async () => {
    await controller.changeStatus('c1', { status: 'ACTIVE' } as any, req)
    expect(service.changeStatus).toHaveBeenCalledWith('B', 'c1', 'ACTIVE')
  })

  it('senza azienda determinabile: 403, nessuna lettura', async () => {
    await expect(controller.list({ user: { id: 'u1' } })).rejects.toBeInstanceOf(ForbiddenException)
    expect(service.list).not.toHaveBeenCalled()
  })
})
