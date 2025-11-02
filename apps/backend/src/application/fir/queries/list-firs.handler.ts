/**
 * List FIRs Query Handler - CQRS Pattern
 * Business logic per listing FIR con pagination
 */

import { FIR } from '../../../domain/fir/aggregates/fir.aggregate'
import { IFIRRepository } from '../../../domain/fir/repositories/fir-repository.interface'
import { Result } from '../../../core/application/result'
import { ListFIRsQuery, PaginatedResult } from './list-firs.query'

export class ListFIRsQueryHandler {
  constructor(private readonly firRepository: IFIRRepository) {}

  async execute(query: ListFIRsQuery): Promise<Result<PaginatedResult<FIR>>> {
    // 1. Get all FIRs for tenant (with filters)
    const allFirs = await this.firRepository.findByTenant(query.tenantId, query.filters)

    // 2. Apply pagination
    const page = query.pagination?.page || 1
    const limit = query.pagination?.limit || 10
    const offset = (page - 1) * limit

    const paginatedFirs = allFirs.slice(offset, offset + limit)

    // 3. Calculate pagination metadata
    const total = allFirs.length
    const totalPages = Math.ceil(total / limit)

    const result: PaginatedResult<FIR> = {
      items: paginatedFirs,
      total,
      page,
      limit,
      totalPages,
    }

    return Result.ok(result)
  }
}
