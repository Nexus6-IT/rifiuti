import { Test } from '@nestjs/testing'
import { ConflictException } from '@nestjs/common'

import { SystemHealthController } from './system-health.controller'
import { SystemHealthService } from '../../application/admin/system-health/system-health.service'
import { JobActionsService } from '../../application/admin/system-health/job-actions.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'

const UTENTE: CurrentUserPayload = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'super@ignicraft.com',
  tenantId: '22222222-2222-2222-2222-222222222222',
  role: 'SUPER_ADMIN',
  permissions: [],
}

describe('SystemHealthController', () => {
  let controller: SystemHealthController
  let systemHealth: { stato: jest.Mock; invalidaCache: jest.Mock }
  let jobActions: { avvia: jest.Mock; storico: jest.Mock }

  beforeEach(async () => {
    systemHealth = {
      stato: jest.fn().mockResolvedValue({ generatedAt: 'x' }),
      invalidaCache: jest.fn(),
    }
    jobActions = {
      avvia: jest.fn().mockResolvedValue({ stato: 'avviato' }),
      storico: jest.fn().mockResolvedValue([]),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [SystemHealthController],
      providers: [
        { provide: SystemHealthService, useValue: systemHealth },
        { provide: JobActionsService, useValue: jobActions },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = moduleRef.get(SystemHealthController)
  })

  it('e riservato al SUPER_ADMIN: la pagina espone aggregati di tutte le aziende', () => {
    // Non ADMIN (che vede solo la propria azienda altrove): i dati qui sono
    // di piattaforma, e darli a un ADMIN sarebbe una fuga fra tenant.
    const ruoli = Reflect.getMetadata('roles', SystemHealthController)

    expect(ruoli).toEqual(['SUPER_ADMIN'])
    expect(Roles).toBeDefined()
  })

  it('restituisce lo stato del sistema', async () => {
    await expect(controller.stato()).resolves.toEqual({ generatedAt: 'x' })
  })

  it('avvia il job passando l identita di chi ha premuto il pulsante', async () => {
    await controller.avviaJob('codifiche-rentri', UTENTE)

    expect(jobActions.avvia).toHaveBeenCalledWith('codifiche-rentri', {
      id: UTENTE.id,
      email: UTENTE.email,
      tenantId: UTENTE.tenantId,
    })
  })

  it('invalida la cache dopo un avvio, cosi l effetto si vede al prossimo caricamento', async () => {
    await controller.avviaJob('codifiche-rentri', UTENTE)

    expect(systemHealth.invalidaCache).toHaveBeenCalled()
  })

  it('non invalida la cache se l avvio e stato rifiutato', async () => {
    jobActions.avvia.mockRejectedValue(new ConflictException('gia in corso'))

    await expect(controller.avviaJob('codifiche-rentri', UTENTE)).rejects.toBeInstanceOf(
      ConflictException
    )
    expect(systemHealth.invalidaCache).not.toHaveBeenCalled()
  })

  it('usa 50 come limite dello storico quando il parametro non e un numero', async () => {
    await controller.storico('non-un-numero')

    expect(jobActions.storico).toHaveBeenCalledWith(50)
  })

  it('rispetta il limite richiesto quando e valido', async () => {
    await controller.storico('10')

    expect(jobActions.storico).toHaveBeenCalledWith(10)
  })
})
