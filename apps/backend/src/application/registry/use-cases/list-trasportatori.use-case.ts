/**
 * ListTrasportatori Use Case
 * Lists all Trasportatori for a tenant
 */

import { Inject, Injectable } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  TrasportatoreRepository,
  TRASPORTATORE_REPOSITORY,
} from '../../../domain/registry/repositories/trasportatore.repository'
import { Trasportatore } from '../../../domain/registry/entities/trasportatore'

export interface ListTrasportatoriCommand {
  tenantId: string
}

@Injectable()
export class ListTrasportatoriUseCase {
  constructor(
    @Inject(TRASPORTATORE_REPOSITORY)
    private readonly trasportatoreRepository: TrasportatoreRepository,
  ) {}

  async execute(command: ListTrasportatoriCommand): Promise<Result<Trasportatore[]>> {
    try {
      const trasportatori = await this.trasportatoreRepository.findByTenantId(
        command.tenantId,
      )

      return Result.ok(trasportatori)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
