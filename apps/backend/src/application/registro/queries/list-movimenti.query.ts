/**
 * Query per il listing paginato del registro cronologico C/S.
 */
export class ListMovimentiQuery {
  constructor(
    public readonly tenantId: string,
    public readonly filters?: {
      type?: 'CARICO' | 'SCARICO'
      cerCode?: string
      causale?: string
      dataFrom?: Date
      dataTo?: Date
      firId?: string
    },
    public readonly pagination?: {
      page: number
      limit: number
    }
  ) {}
}

export interface PaginatedMovimenti<T> {
  items: T[]
  total: number
  page: number
  limit: number
  totalPages: number
}
