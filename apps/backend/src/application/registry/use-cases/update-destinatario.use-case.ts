/**
 * UpdateDestinatario Use Case
 * Updates an existing Destinatario entity
 */

import { Inject, Injectable, Optional } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  DestinatarioRepository,
  DESTINATARIO_REPOSITORY,
} from '../../../domain/registry/repositories/destinatario.repository'
import { Destinatario } from '../../../domain/registry/entities/destinatario'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import { ReferenceDataService } from '../../reference-data/reference-data.service'

export interface UpdateDestinatarioCommand {
  id: string
  ragioneSociale?: string
  sede?: {
    via: string
    civico: string
    cap: string
    citta: string
    provincia: string
    nazione?: string
  }
  numeroAutorizzazione?: string
  email?: string
  telefono?: string
  pec?: string
}

@Injectable()
export class UpdateDestinatarioUseCase {
  constructor(
    @Inject(DESTINATARIO_REPOSITORY)
    private readonly destinatarioRepository: DestinatarioRepository,
    @Optional() private readonly referenceData?: ReferenceDataService
  ) {}

  async execute(command: UpdateDestinatarioCommand): Promise<Result<Destinatario>> {
    try {
      // Find existing Destinatario
      const destinatario = await this.destinatarioRepository.findById(command.id)

      if (!destinatario) {
        return Result.fail('Destinatario not found')
      }

      // Check if new Numero Autorizzazione already exists (if changing)
      if (
        command.numeroAutorizzazione &&
        command.numeroAutorizzazione !== destinatario.numeroAutorizzazione
      ) {
        const existing = await this.destinatarioRepository.findByNumeroAutorizzazione(
          command.numeroAutorizzazione
        )

        if (existing) {
          return Result.fail('Another Destinatario with this Numero Autorizzazione already exists')
        }
      }

      // Update fields using entity methods
      if (command.ragioneSociale) {
        destinatario.updateRagioneSociale(command.ragioneSociale)
      }

      if (command.sede) {
        if (this.referenceData) {
          const v = await this.referenceData.validateLocalita(
            command.sede.citta,
            command.sede.provincia
          )
          if (!v.ok) return Result.fail(v.error!)
        }
        destinatario.updateSede(Indirizzo.create(command.sede))
      }

      if (command.numeroAutorizzazione) {
        destinatario.updateNumeroAutorizzazione(command.numeroAutorizzazione)
      }

      // Update contacts if any field is provided
      if (
        command.email !== undefined ||
        command.telefono !== undefined ||
        command.pec !== undefined
      ) {
        destinatario.updateContatti(
          command.email !== undefined ? command.email : destinatario.email,
          command.telefono !== undefined ? command.telefono : destinatario.telefono,
          command.pec !== undefined ? command.pec : destinatario.pec
        )
      }

      // Save updated entity
      await this.destinatarioRepository.save(destinatario)

      return Result.ok(destinatario)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
