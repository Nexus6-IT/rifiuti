/**
 * UpdateTrasportatore Use Case
 * Updates an existing Trasportatore entity
 */

import { Inject, Injectable } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  TrasportatoreRepository,
  TRASPORTATORE_REPOSITORY,
} from '../../../domain/registry/repositories/trasportatore.repository'
import { Trasportatore } from '../../../domain/registry/entities/trasportatore'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'

export interface UpdateTrasportatoreCommand {
  id: string
  ragioneSociale?: string
  sedeLegale?: {
    via: string
    civico: string
    cap: string
    citta: string
    provincia: string
    nazione?: string
  }
  numeroIscrizione?: string
  email?: string
  telefono?: string
  pec?: string
}

@Injectable()
export class UpdateTrasportatoreUseCase {
  constructor(
    @Inject(TRASPORTATORE_REPOSITORY)
    private readonly trasportatoreRepository: TrasportatoreRepository,
  ) {}

  async execute(command: UpdateTrasportatoreCommand): Promise<Result<Trasportatore>> {
    try {
      // Find existing Trasportatore
      const trasportatore = await this.trasportatoreRepository.findById(command.id)

      if (!trasportatore) {
        return Result.fail('Trasportatore not found')
      }

      // Check if new Numero Iscrizione already exists (if changing)
      if (command.numeroIscrizione && command.numeroIscrizione !== trasportatore.numeroIscrizione) {
        const existing = await this.trasportatoreRepository.findByNumeroIscrizione(
          command.numeroIscrizione,
        )

        if (existing) {
          return Result.fail('Another Trasportatore with this Numero Iscrizione already exists')
        }
      }

      // Update fields using entity methods
      if (command.ragioneSociale) {
        trasportatore.updateRagioneSociale(command.ragioneSociale)
      }

      if (command.sedeLegale) {
        trasportatore.updateSedeLegale(Indirizzo.create(command.sedeLegale))
      }

      if (command.numeroIscrizione) {
        trasportatore.updateNumeroIscrizione(command.numeroIscrizione)
      }

      // Update contacts if any field is provided
      if (command.email !== undefined || command.telefono !== undefined || command.pec !== undefined) {
        trasportatore.updateContatti(
          command.email !== undefined ? command.email : trasportatore.email,
          command.telefono !== undefined ? command.telefono : trasportatore.telefono,
          command.pec !== undefined ? command.pec : trasportatore.pec,
        )
      }

      // Save updated entity
      await this.trasportatoreRepository.save(trasportatore)

      return Result.ok(trasportatore)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
