/**
 * Conferma Consegna FIR Command - CQRS Pattern
 * Comando per confermare consegna FIR in stato IN_TRANSITO
 */

export class ConfermaConsegnaFIRCommand {
  constructor(
    public readonly firId: string,
    public readonly pesoEffettivo: number,
    public readonly firmaDestinatario: {
      firmatario: string
      certificato: string
    },
    public readonly userId: string
  ) {}
}
