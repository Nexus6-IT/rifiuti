import 'reflect-metadata'
import { ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
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
      update: jest.fn().mockResolvedValue({}),
      elimina: jest.fn().mockResolvedValue(undefined),
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

  it("update: usa l'azienda selezionata e l'utente della richiesta", async () => {
    await controller.update('c1', { versione: 3, description: 'x' } as any, req)
    expect(service.update).toHaveBeenCalledWith('B', 'u1', 'c1', {
      versione: 3,
      description: 'x',
    })
  })

  it('update: converte le date stringa in Date, lascia null e undefined', async () => {
    await controller.update(
      'c1',
      { versione: 1, startDate: '2026-02-01', endDate: null } as any,
      req
    )
    const input = service.update.mock.calls[0][3]
    expect(input.startDate).toEqual(new Date('2026-02-01'))
    expect(input.endDate).toBeNull()
    expect('startDate' in input && input.startDate instanceof Date).toBe(true)
    await controller.update('c1', { versione: 1 } as any, req)
    const senza = service.update.mock.calls[1][3]
    expect(senza.startDate).toBeUndefined()
    expect(senza.endDate).toBeUndefined()
  })

  it('update: startDate null resta null (non diventa 1970)', async () => {
    await controller.update('c1', { versione: 1, startDate: null } as any, req)
    expect(service.update.mock.calls[0][3].startDate).toBeNull()
  })

  it("elimina: usa l'azienda selezionata e passa la versione numerica", async () => {
    await controller.elimina('c1', 4, req)
    expect(service.elimina).toHaveBeenCalledWith('B', 'u1', 'c1', 4)
  })

  it('PATCH :id e DELETE :id hanno @Roles SUPER_ADMIN, ADMIN, OPERATOR', () => {
    const r = new Reflector()
    for (const metodo of ['update', 'elimina'] as const) {
      expect(r.get(ROLES_KEY, ContractController.prototype[metodo])).toEqual([
        'SUPER_ADMIN',
        'ADMIN',
        'OPERATOR',
      ])
    }
  })

  it('senza azienda determinabile: 403, nessuna lettura', async () => {
    await expect(controller.list({ user: { id: 'u1' } })).rejects.toBeInstanceOf(ForbiddenException)
    expect(service.list).not.toHaveBeenCalled()
    await expect(
      controller.update('c1', { versione: 1 } as any, { user: { id: 'u1' } })
    ).rejects.toBeInstanceOf(ForbiddenException)
    await expect(controller.elimina('c1', 1, { user: { id: 'u1' } })).rejects.toBeInstanceOf(
      ForbiddenException
    )
    expect(service.update).not.toHaveBeenCalled()
    expect(service.elimina).not.toHaveBeenCalled()
  })
})
