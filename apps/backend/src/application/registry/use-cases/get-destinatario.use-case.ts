/**
 * GetDestinatario Use Case
 * Gets a single Destinatario by ID
 */

import { Inject, Injectable } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  DestinatarioRepository,
  DESTINATARIO_REPOSITORY,
} from '../../../domain/registry/repositories/destinatario.repository'
import { Destinatario } from '../../../domain/registry/entities/destinatario'

export interface GetDestinatarioCommand {
  id: string
}

@Injectable()
export class GetDestinatarioUseCase {
  constructor(
    @Inject(DESTINATARIO_REPOSITORY)
    private readonly destinatarioRepository: DestinatarioRepository,
  ) {}

  async execute(command: GetDestinatarioCommand): Promise<Result<Destinatario>> {
    try {
      const destinatario = await this.destinatarioRepository.findById(command.id)

      if (!destinatario) {
        return Result.fail('Destinatario not found')
      }

      return Result.ok(destinatario)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
