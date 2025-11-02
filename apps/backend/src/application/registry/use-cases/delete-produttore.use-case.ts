/**
 * DeleteProduttore Use Case
 * Deletes a Produttore entity
 */

import { Inject, Injectable } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  ProduttoreRepository,
  PRODUTTORE_REPOSITORY,
} from '../../../domain/registry/repositories/produttore.repository'

export interface DeleteProduttoreCommand {
  id: string
}

@Injectable()
export class DeleteProduttoreUseCase {
  constructor(
    @Inject(PRODUTTORE_REPOSITORY)
    private readonly produttoreRepository: ProduttoreRepository,
  ) {}

  async execute(command: DeleteProduttoreCommand): Promise<Result<void>> {
    try {
      // Check if exists
      const produttore = await this.produttoreRepository.findById(command.id)

      if (!produttore) {
        return Result.fail('Produttore not found')
      }

      // Delete
      await this.produttoreRepository.delete(command.id)

      return Result.ok(undefined)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
