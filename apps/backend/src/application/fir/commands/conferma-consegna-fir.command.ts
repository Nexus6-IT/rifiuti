/**
 * Conferma Consegna FIR Command - CQRS Pattern
 * Comando per confermare consegna FIR in stato IN_TRANSITO
 *
 * La firma del destinatario NON è più fornita dal chiamante (Task 4,
 * pipeline P3): viene prodotta dal sottosistema crittografico dentro lo
 * use-case. Qui arriva solo il nome da mostrare come firmatario.
 */

export class ConfermaConsegnaFIRCommand {
  constructor(
    public readonly firId: string,
    public readonly pesoEffettivo: number,
    public readonly userId: string,
    public readonly firmatario: string
  ) {}
}
