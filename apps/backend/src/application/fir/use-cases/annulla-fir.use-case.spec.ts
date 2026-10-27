import { AnnullaFIRUseCase } from './annulla-fir.use-case'
import { AnnullaFIRCommand } from '../commands/annulla-fir.command'
import { FIR, FIRStato } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { FirModificatoNelFrattempoError } from '../../../core/domain/errors'

function creaFir(): FIR {
  return FIR.create({
    produttoreId: 'tenant-producer-123',
    rifiuto: { cerCode: '13 02 05*', quantita: 120, unitaMisura: UnitaMisura.KG },
    trasportatoreId: 'tenant-transporter-456',
    destinatarioId: 'tenant-destination-789',
  })
}

describe('AnnullaFIRUseCase', () => {
  let fir: FIR
  let repository: { findById: jest.Mock; save: jest.Mock }
  let useCase: AnnullaFIRUseCase

  beforeEach(() => {
    fir = creaFir()
    repository = {
      findById: jest.fn().mockResolvedValue(fir),
      save: jest.fn().mockResolvedValue(undefined),
    }
    useCase = new AnnullaFIRUseCase(repository as unknown as IFIRRepository)
  })

  it('annulla il FIR e salva con la verifica della versione letta', async () => {
    const result = await useCase.execute(
      new AnnullaFIRCommand(fir.id, 'Errore di compilazione', 'u1')
    )

    expect(result.isSuccess).toBe(true)
    expect(result.value.stato).toBe(FIRStato.ANNULLATO)
    expect(repository.save).toHaveBeenCalledWith(fir, { verificaVersione: true })
  })

  it('il conflitto di versione risale invariato (409 dal filtro)', async () => {
    const conflitto = new FirModificatoNelFrattempoError(fir.id)
    repository.save.mockRejectedValue(conflitto)

    await expect(
      useCase.execute(new AnnullaFIRCommand(fir.id, 'Errore di compilazione', 'u1'))
    ).rejects.toBe(conflitto)
  })

  it('FIR inesistente: fallisce senza salvare', async () => {
    repository.findById.mockResolvedValue(null)

    const result = await useCase.execute(new AnnullaFIRCommand('x', 'motivo', 'u1'))

    expect(result.isFailure).toBe(true)
    expect(repository.save).not.toHaveBeenCalled()
  })
})
