/**
 * ListProduttori Use Case
 * Lists all Produttori for a tenant
 */

import { Inject, Injectable } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  ProduttoreRepository,
  PRODUTTORE_REPOSITORY,
} from '../../../domain/registry/repositories/produttore.repository'
import { Produttore } from '../../../domain/registry/entities/produttore'

export interface ListProduttoriCommand {
  tenantId: string
}

@Injectable()
export class ListProduttoriUseCase {
  constructor(
    @Inject(PRODUTTORE_REPOSITORY)
    private readonly produttoreRepository: ProduttoreRepository,
  ) {}

  async execute(command: ListProduttoriCommand): Promise<Result<Produttore[]>> {
    try {
      const produttori = await this.produttoreRepository.findByTenantId(
        command.tenantId,
      )

      return Result.ok(produttori)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
