/**
 * Create FIR Command - CQRS Pattern
 */

import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { TipoTratta } from '../../../domain/fir/aggregates/fir.aggregate'

/** Trasportatore aggiuntivo (tratta intermodale) richiesto alla creazione del FIR. */
export interface TrasportatoreAggiuntivoInput {
  trasportatoreId: string
  tipoTratta: TipoTratta
  ordine: number
}

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
    public readonly userId: string, // User who creates the FIR
    public readonly tenantId: string, // Tenant proprietario del FIR
    public readonly trasportatoriAggiuntivi: TrasportatoreAggiuntivoInput[] = []
  ) {}
}
