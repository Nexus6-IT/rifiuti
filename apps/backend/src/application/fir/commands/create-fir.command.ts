/**
 * Create FIR Command - CQRS Pattern
 */

import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'

export class CreateFIRCommand {
  constructor(
    public readonly produttoreId: string,
    public readonly rifiuto: {
      cerCode: string
      quantita: number
      unitaMisura?: UnitaMisura
      statoFisico?: string
      caratteristichePericolo?: string
    },
    public readonly trasportatoreId: string,
    public readonly destinatarioId: string,
    public readonly userId: string // User who creates the FIR
  ) {}
}
