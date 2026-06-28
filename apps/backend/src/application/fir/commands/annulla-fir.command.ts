/**
 * Annulla FIR Command - CQRS Pattern
 * Comando per annullare un FIR non ancora consegnato.
 */

export class AnnullaFIRCommand {
  constructor(
    public readonly firId: string,
    public readonly motivo: string,
    public readonly userId: string
  ) {}
}
