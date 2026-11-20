import type { ArchivioGiro, SnapshotGiro } from './archivio-giro';
import { StoreIdb } from './store-idb';

const CHIAVE = 'corrente';

/**
 * Archivio su IndexedDB nativo (nessuna dipendenza). Un solo record. La gestione delle connessioni
 * (iOS, chiusure, cancellazione non riuscita da ritentare) sta in `StoreIdb`.
 */
export class ArchivioGiroIndexedDb implements ArchivioGiro {
  private readonly store = new StoreIdb({
    nomeDb: 'wasteflow-campo',
    nomeStore: 'giro',
    chiavePulizia: 'wasteflow.campo.pulizia-giro-pendente',
  });

  async salva(snapshot: SnapshotGiro): Promise<void> {
    await this.store.esegui<unknown>('readwrite', (s) => s.put(snapshot, CHIAVE));
  }

  async leggi(): Promise<SnapshotGiro | null> {
    const r = await this.store.esegui<SnapshotGiro | undefined>('readonly', (s) => s.get(CHIAVE));
    return r ?? null;
  }

  async cancella(): Promise<void> {
    await this.store.svuota();
  }
}
