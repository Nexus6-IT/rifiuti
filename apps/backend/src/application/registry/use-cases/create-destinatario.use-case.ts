/**
 * CreateDestinatario Use Case
 * Creates a new Destinatario entity
 */

import { Inject, Injectable, Optional } from '@nestjs/common'
import { Result } from '../../../core/application/result'
import {
  DestinatarioRepository,
  DESTINATARIO_REPOSITORY,
} from '../../../domain/registry/repositories/destinatario.repository'
import { Destinatario } from '../../../domain/registry/entities/destinatario'
import { PartitaIVA } from '../../../domain/registry/value-objects/partita-iva'
import { Indirizzo } from '../../../domain/registry/value-objects/indirizzo'
import { ReferenceDataService } from '../../reference-data/reference-data.service'

export interface CreateDestinatarioCommand {
  ragioneSociale: string
  partitaIVA: string
  sede: {
    via: string
    civico: string
    cap: string
    citta: string
    provincia: string
    nazione?: string
  }
  numeroAutorizzazione: string
  email?: string
  telefono?: string
  pec?: string
}

@Injectable()
export class CreateDestinatarioUseCase {
  constructor(
    @Inject(DESTINATARIO_REPOSITORY)
    private readonly destinatarioRepository: DestinatarioRepository,
    @Optional() private readonly referenceData?: ReferenceDataService
  ) {}

  async execute(command: CreateDestinatarioCommand): Promise<Result<Destinatario>> {
    try {
      // Check if Partita IVA already exists
      const existingByPIVA = await this.destinatarioRepository.findByPartitaIVA(command.partitaIVA)

      if (existingByPIVA) {
        return Result.fail('Destinatario with this Partita IVA already exists')
      }

      // Check if Numero Autorizzazione already exists
      const existingByNumero = await this.destinatarioRepository.findByNumeroAutorizzazione(
        command.numeroAutorizzazione
      )

      if (existingByNumero) {
        return Result.fail('Destinatario with this Numero Autorizzazione already exists')
      }

      // Valida comune/provincia contro le tabelle ISTAT condivise (se popolate).
      if (this.referenceData) {
        const v = await this.referenceData.validateLocalita(
          command.sede.citta,
          command.sede.provincia
        )
        if (!v.ok) return Result.fail(v.error!)
      }

      // Create value objects
      const partitaIVA = PartitaIVA.create(command.partitaIVA)
      const sede = Indirizzo.create(command.sede)

      // Create Destinatario entity
      const destinatario = Destinatario.create({
        ragioneSociale: command.ragioneSociale,
        partitaIVA,
        sede,
        numeroAutorizzazione: command.numeroAutorizzazione,
        email: command.email,
        telefono: command.telefono,
        pec: command.pec,
      })

      // Save to repository
      await this.destinatarioRepository.save(destinatario)

      return Result.ok(destinatario)
    } catch (error: any) {
      return Result.fail(error.message)
    }
  }
}
