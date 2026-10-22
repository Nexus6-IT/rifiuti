import { BadRequestException } from '@nestjs/common'
import { RegistroController } from './registro.controller'
import { Result } from '../../core/application/result'
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'

describe('RegistroController.registra — data di registrazione', () => {
  const utente: CurrentUserPayload = {
    id: 'user-1',
    email: 'operatore@example.com',
    tenantId: 'tenant-1',
    role: 'OPERATOR',
    permissions: [],
  }
  const dtoMinimo = {
    type: 'CARICO',
    movementDate: '2026-03-11',
    causale: 'PRODUZIONE_INTERNA',
    cerCode: '20 03 01',
    quantity: 100,
  }

  let useCase: { execute: jest.Mock }
  let controller: RegistroController

  beforeEach(() => {
    useCase = { execute: jest.fn() }
    controller = new RegistroController(useCase as any, {} as any)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it("ignora la data di registrazione del client e usa l'istante di adesso", async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-10T23:30:00Z')) // 00:30 dell'11/03 a Roma
    useCase.execute.mockResolvedValue(Result.ok({ id: 'm1' }))

    await controller.registra(
      { ...dtoMinimo, movementDate: '2026-03-11', registrationDate: '2025-01-01' } as any,
      utente
    )

    const comando = useCase.execute.mock.calls[0][0]
    expect(comando.registrationDate).toEqual(new Date('2026-03-10T23:30:00.000Z'))
    expect(comando.movementDate).toEqual(new Date('2026-03-11'))
  })

  it("senza data di registrazione nel corpo usa comunque l'istante di adesso", async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-12T08:15:00Z'))
    useCase.execute.mockResolvedValue(Result.ok({ id: 'm1' }))

    await controller.registra({ ...dtoMinimo } as any, utente)

    expect(useCase.execute.mock.calls[0][0].registrationDate).toEqual(
      new Date('2026-03-12T08:15:00.000Z')
    )
  })

  it('un fallimento dello use case diventa 400 con il suo messaggio', async () => {
    useCase.execute.mockResolvedValue(Result.fail('Giacenza insufficiente'))

    await expect(controller.registra({ ...dtoMinimo } as any, utente)).rejects.toThrow(
      new BadRequestException('Giacenza insufficiente')
    )
  })
})
