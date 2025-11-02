/**
 * Emetti FIR Command - CQRS Pattern
 * Comando per emettere un FIR in stato BOZZA
 */

export class EmettiFIRCommand {
  constructor(
    public readonly firId: string,
    public readonly firmaProduttore: {
      firmatario: string
      certificato: string
    },
    public readonly userId: string
  ) {}
}
