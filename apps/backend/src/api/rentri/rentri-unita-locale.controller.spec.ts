import { RentriUnitaLocaleController } from './rentri-unita-locale.controller'
import { RentriUnitaLocaleService } from '../../infrastructure/rentri/rentri-unita-locale.service'
import { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { CreateRentriUnitaLocaleDto } from './dto/create-rentri-unita-locale.dto'

const user: CurrentUserPayload = {
  id: 'user-1',
  email: 'admin@example.com',
  tenantId: 'tenant-1',
  role: 'admin',
  permissions: [],
}

// richiesta senza switch di azienda: l'azienda selezionata coincide con quella del token
const req = { tenantId: user.tenantId, user }

const row = {
  id: 'ul-1',
  numIscrSito: 'OP1234ABC123456-RM1234',
  denominazione: 'Sede principale',
  principale: true,
  attiva: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  codiceBloccoPredefinito: null,
  dimensioneScortaDesiderata: null,
}

describe('RentriUnitaLocaleController', () => {
  let controller: RentriUnitaLocaleController
  let service: jest.Mocked<RentriUnitaLocaleService>

  beforeEach(() => {
    service = {
      listForTenant: jest.fn(),
      findById: jest.fn(),
      getPrincipale: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      setPrincipale: jest.fn(),
      remove: jest.fn(),
    } as unknown as jest.Mocked<RentriUnitaLocaleService>

    controller = new RentriUnitaLocaleController(service)
  })

  it('elenca le unità locali del tenant corrente', async () => {
    service.listForTenant.mockResolvedValue([row])

    const res = await controller.list(req)

    expect(service.listForTenant).toHaveBeenCalledWith('tenant-1')
    expect(res).toEqual({ items: [row] })
  })

  it('crea una nuova unità locale per il tenant corrente', async () => {
    const dto: CreateRentriUnitaLocaleDto = {
      numIscrSito: 'OP1234ABC123456-RM1234',
      denominazione: 'Sede principale',
    }
    service.create.mockResolvedValue(row)

    const res = await controller.create(dto, req)

    expect(service.create).toHaveBeenCalledWith('tenant-1', dto)
    expect(res).toEqual(row)
  })

  it('aggiorna una unità locale del tenant corrente', async () => {
    service.update.mockResolvedValue({ ...row, denominazione: 'Nuovo nome' })

    const res = await controller.update('ul-1', { denominazione: 'Nuovo nome' }, req)

    expect(service.update).toHaveBeenCalledWith('tenant-1', 'ul-1', { denominazione: 'Nuovo nome' })
    expect(res.denominazione).toBe('Nuovo nome')
  })

  it('imposta una unità locale come principale', async () => {
    service.setPrincipale.mockResolvedValue(row)

    const res = await controller.setPrincipale('ul-1', req)

    expect(service.setPrincipale).toHaveBeenCalledWith('tenant-1', 'ul-1')
    expect(res).toEqual(row)
  })

  it('rimuove una unità locale del tenant corrente', async () => {
    await controller.remove('ul-1', req)

    expect(service.remove).toHaveBeenCalledWith('tenant-1', 'ul-1')
  })

  it('propaga il 404 del service quando l’id non appartiene al tenant (mai un 403)', async () => {
    const { NotFoundException } = await import('@nestjs/common')
    service.update.mockRejectedValue(new NotFoundException('Unità locale RENTRI non trovata'))

    await expect(
      controller.update('ul-di-un-altro-tenant', { denominazione: 'X' }, req)
    ).rejects.toBeInstanceOf(NotFoundException)
  })
})
