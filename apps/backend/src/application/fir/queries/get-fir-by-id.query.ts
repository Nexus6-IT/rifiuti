/**
 * Get FIR by ID Query - CQRS Pattern
 * Query handler per recupero FIR singolo
 */

export class GetFIRByIdQuery {
  constructor(
    public readonly firId: string,
    public readonly userId: string,
    public readonly tenantId: string
  ) {}
}
