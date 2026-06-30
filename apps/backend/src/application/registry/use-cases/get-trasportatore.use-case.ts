/**
 * GetTrasportatore Use Case
 * Gets a single Trasportatore by ID
 */

import { Inject, Injectable } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  TrasportatoreRepository,
  TRASPORTATORE_REPOSITORY,
} from '../../../domain/registry/repositories/trasportatore.repository'
import { Trasportatore } from '../../../domain/registry/entities/trasportatore'

export interface GetTrasportatoreCommand {
  id: string
}

@Injectable()
export class GetTrasportatoreUseCase {
  constructor(
    @Inject(TRASPORTATORE_REPOSITORY)
    private readonly trasportatoreRepository: TrasportatoreRepository
  ) {}

  async execute(command: GetTrasportatoreCommand): Promise<Result<Trasportatore>> {
    try {
      const trasportatore = await this.trasportatoreRepository.findById(command.id)

      if (!trasportatore) {
        return Result.fail('Trasportatore not found')
      }

      return Result.ok(trasportatore)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
