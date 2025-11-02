/**
 * DeleteDestinatario Use Case
 * Deletes a Destinatario entity
 */

import { Inject, Injectable } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  DestinatarioRepository,
  DESTINATARIO_REPOSITORY,
} from '../../../domain/registry/repositories/destinatario.repository'

export interface DeleteDestinatarioCommand {
  id: string
}

@Injectable()
export class DeleteDestinatarioUseCase {
  constructor(
    @Inject(DESTINATARIO_REPOSITORY)
    private readonly destinatarioRepository: DestinatarioRepository,
  ) {}

  async execute(command: DeleteDestinatarioCommand): Promise<Result<void>> {
    try {
      // Check if exists
      const destinatario = await this.destinatarioRepository.findById(command.id)

      if (!destinatario) {
        return Result.fail('Destinatario not found')
      }

      // Delete
      await this.destinatarioRepository.delete(command.id)

      return Result.ok(undefined)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
