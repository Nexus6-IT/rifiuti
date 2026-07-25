/**
 * Emetti FIR Command - CQRS Pattern
 * Comando per emettere un FIR in stato BOZZA
 *
 * La firma del produttore NON è più fornita dal chiamante (Task 4, pipeline
 * P3): viene prodotta dal sottosistema crittografico dentro lo use-case. Qui
 * arriva solo il nome da mostrare come firmatario (tracciabilità di chi ha
 * eseguito l'operazione), risolto dal controller dal JWT dell'utente.
 */

export class EmettiFIRCommand {
  constructor(
    public readonly firId: string,
    public readonly userId: string,
    public readonly firmatario: string
  ) {}
}
