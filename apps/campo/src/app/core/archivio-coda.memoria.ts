import type { ArchivioCoda } from './archivio-coda';
import type { EventoInCoda } from './coda-eventi';

/** Archivio in memoria: per i test. */
export class ArchivioCodaMemoria implements ArchivioCoda {
  private readonly mappa = new Map<string, EventoInCoda>();

  async tutti(): Promise<EventoInCoda[]> {
    return [...this.mappa.values()].map((e) => structuredClone(e));
  }
  async salva(e: EventoInCoda): Promise<void> {
    this.mappa.set(e.id, structuredClone(e));
  }
  async rimuovi(id: string): Promise<void> {
    this.mappa.delete(id);
  }
}
