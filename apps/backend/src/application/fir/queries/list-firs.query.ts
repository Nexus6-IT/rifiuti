/**
 * List FIRs Query - CQRS Pattern
 * Query per listing FIR con pagination e filtri
 */

import { FIRStato } from '../../../domain/fir/aggregates/fir.aggregate'

export class ListFIRsQuery {
  constructor(
    public readonly tenantId: string,
    public readonly userId: string,
    public readonly filters?: {
      stato?: FIRStato
      cerCode?: string
      dataFrom?: Date
      dataTo?: Date
    },
    public readonly pagination?: {
      page: number
      limit: number
    }
  ) {}
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}
