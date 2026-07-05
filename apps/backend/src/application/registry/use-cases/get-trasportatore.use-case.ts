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
    // Gli errori Prisma (es. P2023 su id non-UUID) NON vengono catturati qui:
    // propagano al filtro globale delle eccezioni che li mappa (400) senza
    // esporre dettagli interni. Catturarli e reinserire error.message nel
    // Result causerebbe information disclosure.
    const trasportatore = await this.trasportatoreRepository.findById(command.id)

    if (!trasportatore) {
      return Result.fail('Trasportatore not found')
    }

    return Result.ok(trasportatore)
  }
}
