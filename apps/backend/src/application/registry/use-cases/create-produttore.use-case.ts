/**
 * CreateProduttore Use Case
 * Creates a new Produttore entity
 */

import { Inject, Injectable } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  ProduttoreRepository,
  PRODUTTORE_REPOSITORY,
} from '../../../domain/registry/repositories/produttore.repository'
import { Produttore } from '../../../domain/registry/entities/produttore'
import { PartitaIVA } from '../../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'

export interface CreateProduttoreCommand {
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
  email?: string
  telefono?: string
  pec?: string
}

@Injectable()
export class CreateProduttoreUseCase {
  constructor(
    @Inject(PRODUTTORE_REPOSITORY)
    private readonly produttoreRepository: ProduttoreRepository,
  ) {}

  async execute(command: CreateProduttoreCommand): Promise<Result<Produttore>> {
    try {
      // Check if Partita IVA already exists
      const existing = await this.produttoreRepository.findByPartitaIVA(
        command.partitaIVA,
      )

      if (existing) {
        return Result.fail('Produttore with this Partita IVA already exists')
      }

      // Create value objects
      const partitaIVA = PartitaIVA.create(command.partitaIVA)
      const sedeLegale = Indirizzo.create(command.sedeLegale)

      // Create Produttore entity
      const produttore = Produttore.create({
        ragioneSociale: command.ragioneSociale,
        partitaIVA,
        sedeLegale,
        email: command.email,
        telefono: command.telefono,
        pec: command.pec,
      })

      // Save to repository
      await this.produttoreRepository.save(produttore)

      return Result.ok(produttore)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
