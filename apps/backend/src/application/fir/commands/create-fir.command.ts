/**
 * Create FIR Command - CQRS Pattern
 */

import { UnitaMisura } from '../../../domain/fir/value-objects/quantita'
import { TipoTratta, TipoOperazioneRifiuto } from '../../../domain/fir/aggregates/fir.aggregate'

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
      /** Campo 2 FIR: stato fisico del rifiuto. */
      statoFisico?: string
      /** Campo 2 FIR: caratteristiche HP (multi-valore), comma-separated. */
      caratteristichePericolo?: string
      /** Campo 2 FIR: numero di colli. */
      numeroColli?: number
      descrizione?: string
      categoria?: string
      tipoOperazione?: TipoOperazioneRifiuto
      /** Campo 3 FIR: codice operazione R/D specifico (es. "R1", "D13"). */
      codiceOperazione?: string
    },
    public readonly trasportatoreId: string,
    public readonly destinatarioId: string,
    public readonly userId: string,
    public readonly tenantId: string,
    public readonly trasportatoriAggiuntivi: TrasportatoreAggiuntivoInput[] = [],
    /** Campo 17 FIR: annotazioni libere. */
    public readonly annotazioni?: string
  ) {}
}
