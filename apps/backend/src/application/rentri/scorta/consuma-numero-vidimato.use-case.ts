import { Injectable } from '@nestjs/common'
import {
  RentriScortaRepository,
  NumeroVidimatoRow,
} from '../../../infrastructure/persistence/rentri-scorta.repository'
import { DomainException } from '../../../domain/shared/domain-exception'

/**
 * Consuma atomicamente il prossimo numero FIR pre-vidimato disponibile in
 * scorta (R6) — il punto di aggancio per l'emissione locale del FIR
 * (`EmettiFIRUseCase`, NON ricablato qui: fuori scope di questo task, che
 * costruisce la scorta e la sua API, non il flusso di emissione).
 *
 * Wrapper sottile su {@link RentriScortaRepository.consumaProssimoDisponibile}
 * (dove vive la garanzia di atomicità, v. suo commento di classe): questo
 * use case aggiunge solo il fail-closed applicativo — "nessun numero
 * disponibile" diventa un errore di dominio esplicito, mai un valore
 * inventato o un'emissione silenziosamente senza numero RENTRI.
 */
@Injectable()
export class ConsumaNumeroVidimatoUseCase {
  constructor(private readonly scortaRepo: RentriScortaRepository) {}

  async execute(
    tenantId: string,
    input: { numIscrSito?: string; codiceBlocco?: string; firId: string }
  ): Promise<NumeroVidimatoRow> {
    const numero = await this.scortaRepo.consumaProssimoDisponibile(tenantId, {
      numIscrSito: input.numIscrSito,
      codiceBlocco: input.codiceBlocco,
      firId: input.firId,
    })

    if (!numero) {
      throw DomainException.businessRuleViolation(
        'SCORTA_RENTRI_VUOTA',
        'Nessun numero FIR RENTRI pre-vidimato disponibile: vidima un lotto dalla sezione Blocchi ' +
          'RENTRI o attendi il rifornimento automatico prima di emettere.'
      )
    }

    return numero
  }
}
