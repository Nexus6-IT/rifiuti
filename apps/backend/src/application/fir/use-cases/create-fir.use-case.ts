/**
 * Create FIR Use Case - Application Layer
 * Business logic orchestration
 */

import { FIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { ICERRepository } from '../../../domain/cer/repositories/cer-repository.interface'
import { Result } from '../../../core/application/result'
import { CreateFIRCommand } from '../commands/create-fir.command'

export class CreateFIRUseCase {
  constructor(
    private readonly firRepository: IFIRRepository,
    private readonly cerRepository: ICERRepository
  ) {}

  async execute(command: CreateFIRCommand): Promise<Result<FIR>> {
    // 1. Validate CER code exists
    const cerExists = await this.cerRepository.exists(command.rifiuto.cerCode)
    if (!cerExists) {
      return Result.fail<FIR>(`CER code not found: ${command.rifiuto.cerCode}`)
    }

    // 2. Validate tenant IDs (in real implementation, check they exist in DB)
    if (!command.produttoreId || !command.trasportatoreId || !command.destinatarioId) {
      return Result.fail<FIR>('Produttore, Trasportatore and Destinatario are required')
    }

    // 3. Create FIR aggregate
    try {
      const fir = FIR.create({
        produttoreId: command.produttoreId,
        rifiuto: command.rifiuto,
        trasportatoreId: command.trasportatoreId,
        destinatarioId: command.destinatarioId,
      })

      // 4. Persist FIR
      await this.firRepository.save(fir)

      // 5. Return success
      return Result.ok<FIR>(fir)
    } catch (error) {
      return Result.fail<FIR>(`Failed to create FIR: ${error.message}`)
    }
  }
}
