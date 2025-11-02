/**
 * Get FIR by ID Query Handler - CQRS Pattern
 * Business logic per recupero FIR con autorizzazione
 */

import { FIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { Result } from '../../../core/application/result'
import { GetFIRByIdQuery } from './get-fir-by-id.query'

export class GetFIRByIdQueryHandler {
  constructor(private readonly firRepository: IFIRRepository) {}

  async execute(query: GetFIRByIdQuery): Promise<Result<FIR>> {
    // 1. Retrieve FIR
    const fir = await this.firRepository.findById(query.firId)

    if (!fir) {
      return Result.fail<FIR>(`FIR not found: ${query.firId}`)
    }

    // 2. Check authorization (user must belong to one of the involved tenants)
    const isAuthorized =
      fir.produttoreId === query.tenantId ||
      fir.trasportatoreId === query.tenantId ||
      fir.destinatarioId === query.tenantId

    if (!isAuthorized) {
      return Result.fail<FIR>('User not authorized to access this FIR')
    }

    // 3. Return FIR
    return Result.ok<FIR>(fir)
  }
}
