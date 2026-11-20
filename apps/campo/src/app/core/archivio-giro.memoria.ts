import type { ArchivioGiro, SnapshotGiro } from './archivio-giro';

/** Archivio in memoria: per i test e come ripiego dove IndexedDB non esiste. */
export class ArchivioGiroMemoria implements ArchivioGiro {
  corrente: SnapshotGiro | null = null;

  async salva(s: SnapshotGiro): Promise<void> {
    this.corrente = structuredClone(s);
  }
  async leggi(): Promise<SnapshotGiro | null> {
    return this.corrente ? structuredClone(this.corrente) : null;
  }
  async cancella(): Promise<void> {
    this.corrente = null;
  }
}
