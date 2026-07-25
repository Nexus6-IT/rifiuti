/**
 * Presa In Carico FIR Command - CQRS Pattern
 * Comando per prendere in carico un FIR in stato EMESSO
 *
 * La firma del trasportatore NON è più fornita dal chiamante (Task 4,
 * pipeline P3): viene prodotta dal sottosistema crittografico dentro lo
 * use-case. Qui arriva solo il nome da mostrare come firmatario.
 */

export class PresaInCaricoFIRCommand {
  constructor(
    public readonly firId: string,
    public readonly userId: string,
    public readonly firmatario: string
  ) {}
}
