/**
 * CreateTrasportatore Use Case
 * Creates a new Trasportatore entity
 */

import { Inject, Injectable, Optional } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  TrasportatoreRepository,
  TRASPORTATORE_REPOSITORY,
} from '../../../domain/registry/repositories/trasportatore.repository'
import { Trasportatore } from '../../../domain/registry/entities/trasportatore'
import { PartitaIVA } from '../../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import { ReferenceDataService } from '../../reference-data/reference-data.service'

export interface CreateTrasportatoreCommand {
  ragioneSociale: string
  partitaIVA: string
  sedeLegale: {
    via: string
    civico: string
    cap: string
    citta: string
    provincia: string
    nazione?: string
  }
  numeroIscrizione: string
  email?: string
  telefono?: string
  pec?: string
}

@Injectable()
export class CreateTrasportatoreUseCase {
  constructor(
    @Inject(TRASPORTATORE_REPOSITORY)
    private readonly trasportatoreRepository: TrasportatoreRepository,
    @Optional() private readonly referenceData?: ReferenceDataService,
  ) {}

  async execute(command: CreateTrasportatoreCommand): Promise<Result<Trasportatore>> {
    try {
      // Check if Partita IVA already exists
      const existingByPIVA = await this.trasportatoreRepository.findByPartitaIVA(
        command.partitaIVA,
      )

      if (existingByPIVA) {
        return Result.fail('Trasportatore with this Partita IVA already exists')
      }

      // Check if Numero Iscrizione already exists
      const existingByNumero = await this.trasportatoreRepository.findByNumeroIscrizione(
        command.numeroIscrizione,
      )

      if (existingByNumero) {
        return Result.fail('Trasportatore with this Numero Iscrizione already exists')
      }

      // Valida comune/provincia contro le tabelle ISTAT condivise (se popolate).
      if (this.referenceData) {
        const v = await this.referenceData.validateLocalita(
          command.sedeLegale.citta,
          command.sedeLegale.provincia,
        )
        if (!v.ok) return Result.fail(v.error!)
      }

      // Create value objects
      const partitaIVA = PartitaIVA.create(command.partitaIVA)
      const sedeLegale = Indirizzo.create(command.sedeLegale)

      // Create Trasportatore entity
      const trasportatore = Trasportatore.create({
        ragioneSociale: command.ragioneSociale,
        partitaIVA,
        sedeLegale,
        numeroIscrizione: command.numeroIscrizione,
        email: command.email,
        telefono: command.telefono,
        pec: command.pec,
      })

      // Save to repository
      await this.trasportatoreRepository.save(trasportatore)

      return Result.ok(trasportatore)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
