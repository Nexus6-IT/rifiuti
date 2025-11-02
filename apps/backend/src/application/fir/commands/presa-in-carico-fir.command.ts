/**
 * Presa In Carico FIR Command - CQRS Pattern
 * Comando per prendere in carico un FIR in stato EMESSO
 */

export class PresaInCaricoFIRCommand {
  constructor(
    public readonly firId: string,
    public readonly firmaTrasportatore: {
      firmatario: string
      certificato: string
    },
    public readonly userId: string
  ) {}
}
