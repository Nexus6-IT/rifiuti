/**
 * Annulla FIR Use Case - Application Layer
 * Business logic per l'annullamento di un FIR (qualsiasi stato tranne CONSEGNATO).
 */

import { FIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { Result } from '../../../core/application/result'
import { AnnullaFIRCommand } from '../commands/annulla-fir.command'

export class AnnullaFIRUseCase {
  constructor(private readonly firRepository: IFIRRepository) {}

  async execute(command: AnnullaFIRCommand): Promise<Result<FIR>> {
    // 1. Retrieve FIR aggregate
    const fir = await this.firRepository.findById(command.firId)
    if (!fir) {
      return Result.fail<FIR>(`FIR not found: ${command.firId}`)
    }

    // 2. Execute domain method (business logic)
    try {
      fir.annulla(command.motivo)
    } catch (error) {
      return Result.fail<FIR>(`Failed to annull FIR: ${error.message}`)
    }

    // 3. Persist changes
    await this.firRepository.save(fir)

    return Result.ok<FIR>(fir)
  }
}
