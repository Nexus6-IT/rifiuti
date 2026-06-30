/**
 * UpdateProduttore Use Case
 * Updates an existing Produttore entity
 */

import { Inject, Injectable, Optional } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  ProduttoreRepository,
  PRODUTTORE_REPOSITORY,
} from '../../../domain/registry/repositories/produttore.repository'
import { Produttore } from '../../../domain/registry/entities/produttore'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import { ReferenceDataService } from '../../reference-data/reference-data.service'

export interface UpdateProduttoreCommand {
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
  email?: string
  telefono?: string
  pec?: string
}

@Injectable()
export class UpdateProduttoreUseCase {
  constructor(
    @Inject(PRODUTTORE_REPOSITORY)
    private readonly produttoreRepository: ProduttoreRepository,
    @Optional() private readonly referenceData?: ReferenceDataService
  ) {}

  async execute(command: UpdateProduttoreCommand): Promise<Result<Produttore>> {
    try {
      // Find existing Produttore
      const produttore = await this.produttoreRepository.findById(command.id)

      if (!produttore) {
        return Result.fail('Produttore not found')
      }

      // Update fields using entity methods
      if (command.ragioneSociale) {
        produttore.updateRagioneSociale(command.ragioneSociale)
      }

      if (command.sedeLegale) {
        if (this.referenceData) {
          const v = await this.referenceData.validateLocalita(
            command.sedeLegale.citta,
            command.sedeLegale.provincia
          )
          if (!v.ok) return Result.fail(v.error!)
        }
        produttore.updateSedeLegale(Indirizzo.create(command.sedeLegale))
      }

      // Update contacts if any field is provided
      if (
        command.email !== undefined ||
        command.telefono !== undefined ||
        command.pec !== undefined
      ) {
        produttore.updateContatti(
          command.email !== undefined ? command.email : produttore.email,
          command.telefono !== undefined ? command.telefono : produttore.telefono,
          command.pec !== undefined ? command.pec : produttore.pec
        )
      }

      // Save updated entity
      await this.produttoreRepository.save(produttore)

      return Result.ok(produttore)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
