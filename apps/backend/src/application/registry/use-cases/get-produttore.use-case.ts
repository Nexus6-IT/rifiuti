/**
 * GetProduttore Use Case
 * Gets a single Produttore by ID
 */

import { Inject, Injectable } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  ProduttoreRepository,
  PRODUTTORE_REPOSITORY,
} from '../../../domain/registry/repositories/produttore.repository'
import { Produttore } from '../../../domain/registry/entities/produttore'

export interface GetProduttoreCommand {
  id: string
}

@Injectable()
export class GetProduttoreUseCase {
  constructor(
    @Inject(PRODUTTORE_REPOSITORY)
    private readonly produttoreRepository: ProduttoreRepository
  ) {}

  async execute(command: GetProduttoreCommand): Promise<Result<Produttore>> {
    try {
      const produttore = await this.produttoreRepository.findById(command.id)

      if (!produttore) {
        return Result.fail('Produttore not found')
      }

      return Result.ok(produttore)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
