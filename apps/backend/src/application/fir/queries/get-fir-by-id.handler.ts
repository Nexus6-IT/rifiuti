/**
 * Get FIR by ID Query Handler - CQRS Pattern
 * Business logic per recupero FIR con autorizzazione
 */

import { FIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { Result } from '../../../core/application/result'
import { FirNonTrovatoError } from '../../../core/domain/errors'
import { GetFIRByIdQuery } from './get-fir-by-id.query'

export class GetFIRByIdQueryHandler {
  constructor(private readonly firRepository: IFIRRepository) {}

  async execute(query: GetFIRByIdQuery): Promise<Result<FIR>> {
    // 1. Retrieve FIR
    const fir = await this.firRepository.findById(query.firId)

    if (!fir) {
      return Result.fail<FIR>(`FIR not found: ${query.firId}`, FirNonTrovatoError.CODICE)
    }

    // 2. Autorizzazione su base TENANT.
    //    L'autorizzazione si fonda sul tenant proprietario del FIR, NON sugli id
    //    delle parti (produttore/trasportatore/destinatario), che sono riferimenti
    //    ai registri e NON tenant. Il repository è già tenant-scoped (RLS), ma
    //    verifichiamo esplicitamente l'appartenenza: un FIR di un altro tenant non
    //    deve rivelare la propria esistenza → trattato come "non trovato" (404).
    if (fir.tenantId !== query.tenantId) {
      return Result.fail<FIR>(`FIR not found: ${query.firId}`, FirNonTrovatoError.CODICE)
    }

    // 3. Return FIR
    return Result.ok<FIR>(fir)
  }
}
