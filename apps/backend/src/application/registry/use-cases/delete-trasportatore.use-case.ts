/**
 * DeleteTrasportatore Use Case
 * Deletes a Trasportatore entity
 */

import { Inject, Injectable } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  TrasportatoreRepository,
  TRASPORTATORE_REPOSITORY,
} from '../../../domain/registry/repositories/trasportatore.repository'

export interface DeleteTrasportatoreCommand {
  id: string
}

@Injectable()
export class DeleteTrasportatoreUseCase {
  constructor(
    @Inject(TRASPORTATORE_REPOSITORY)
    private readonly trasportatoreRepository: TrasportatoreRepository,
  ) {}

  async execute(command: DeleteTrasportatoreCommand): Promise<Result<void>> {
    try {
      // Check if exists
      const trasportatore = await this.trasportatoreRepository.findById(command.id)

      if (!trasportatore) {
        return Result.fail('Trasportatore not found')
      }

      // Delete
      await this.trasportatoreRepository.delete(command.id)

      return Result.ok(undefined)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
