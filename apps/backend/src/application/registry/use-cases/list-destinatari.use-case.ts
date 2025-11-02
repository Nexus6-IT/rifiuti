/**
 * ListDestinatari Use Case
 * Lists all Destinatari for a tenant
 */

import { Inject, Injectable } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  DestinatarioRepository,
  DESTINATARIO_REPOSITORY,
} from '../../../domain/registry/repositories/destinatario.repository'
import { Destinatario } from '../../../domain/registry/entities/destinatario'

export interface ListDestinatariCommand {
  tenantId: string
}

@Injectable()
export class ListDestinatariUseCase {
  constructor(
    @Inject(DESTINATARIO_REPOSITORY)
    private readonly destinatarioRepository: DestinatarioRepository,
  ) {}

  async execute(command: ListDestinatariCommand): Promise<Result<Destinatario[]>> {
    try {
      const destinatari = await this.destinatarioRepository.findByTenantId(
        command.tenantId,
      )

      return Result.ok(destinatari)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
