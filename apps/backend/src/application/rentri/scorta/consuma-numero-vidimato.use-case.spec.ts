import { ConsumaNumeroVidimatoUseCase } from './consuma-numero-vidimato.use-case'
import { DomainException } from '../../../domain/shared/domain-exception'

describe('ConsumaNumeroVidimatoUseCase', () => {
  const TENANT = 'tenant-1'

  function build(consumato: unknown) {
    const scortaRepo = { consumaProssimoDisponibile: jest.fn().mockResolvedValue(consumato) }
    return { useCase: new ConsumaNumeroVidimatoUseCase(scortaRepo as any), scortaRepo }
  }

  it('ritorna il numero consumato quando disponibile', async () => {
    const numero = { numeroFir: 'FIR1', qrCodeBytes: 'YmFzZTY0', progressivo: 1 }
    const { useCase, scortaRepo } = build(numero)

    const risultato = await useCase.execute(TENANT, {
      numIscrSito: 'OP1',
      firId: 'fir-1',
    })

    expect(scortaRepo.consumaProssimoDisponibile).toHaveBeenCalledWith(TENANT, {
      numIscrSito: 'OP1',
      codiceBlocco: undefined,
      firId: 'fir-1',
    })
    expect(risultato).toBe(numero)
  })

  it('fail-closed: nessun numero disponibile solleva un errore esplicito, mai un valore inventato', async () => {
    const { useCase } = build(null)

    await expect(useCase.execute(TENANT, { numIscrSito: 'OP1', firId: 'fir-1' })).rejects.toThrow(
      DomainException
    )
  })
})
