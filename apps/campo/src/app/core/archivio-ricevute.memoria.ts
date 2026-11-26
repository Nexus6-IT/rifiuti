import type { ArchivioRicevute } from './archivio-ricevute';
import type { RicevutaInCoda } from './coda-ricevute';

/** Archivio in memoria: per i test. */
export class ArchivioRicevuteMemoria implements ArchivioRicevute {
  private readonly mappa = new Map<string, RicevutaInCoda>();

  async tutte(): Promise<RicevutaInCoda[]> {
    return [...this.mappa.values()].map((r) => structuredClone(r));
  }
  async salva(r: RicevutaInCoda): Promise<void> {
    this.mappa.set(r.id, structuredClone(r));
  }
  async rimuovi(id: string): Promise<void> {
    this.mappa.delete(id);
  }
}
