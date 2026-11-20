import type { ArchivioGiro, SnapshotGiro } from './archivio-giro';

const NOME_DB = 'wasteflow-campo';
const NOME_STORE = 'giro';
const CHIAVE = 'corrente';

/**
 * Archivio su IndexedDB nativo (nessuna dipendenza). Un solo record. Se IndexedDB non c'e' o
 * fallisce (navigazione privata) le operazioni non lanciano: l'app resta solo online.
 */
export class ArchivioGiroIndexedDb implements ArchivioGiro {
  private db: Promise<IDBDatabase | null> | null = null;

  async salva(snapshot: SnapshotGiro): Promise<void> {
    await this.esegui<unknown>('readwrite', (s) => s.put(snapshot, CHIAVE));
  }

  async leggi(): Promise<SnapshotGiro | null> {
    const r = await this.esegui<SnapshotGiro | undefined>('readonly', (s) => s.get(CHIAVE));
    return r ?? null;
  }

  async cancella(): Promise<void> {
    await this.esegui<unknown>('readwrite', (s) => s.clear());
  }

  private apri(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((risolvi) => {
      if (typeof indexedDB === 'undefined') return risolvi(null);
      try {
        const rich = indexedDB.open(NOME_DB, 1);
        rich.onupgradeneeded = () => rich.result.createObjectStore(NOME_STORE);
        rich.onsuccess = () => risolvi(rich.result);
        rich.onerror = () => risolvi(null);
        rich.onblocked = () => risolvi(null);
      } catch {
        risolvi(null);
      }
    });
    return this.db;
  }

  private async esegui<T>(
    modo: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | undefined> {
    const db = await this.apri();
    if (!db) return undefined;
    return new Promise<T | undefined>((risolvi) => {
      try {
        const tx = db.transaction(NOME_STORE, modo);
        const rich = op(tx.objectStore(NOME_STORE));
        tx.oncomplete = () => risolvi(rich.result);
        tx.onerror = () => risolvi(undefined);
        tx.onabort = () => risolvi(undefined);
      } catch {
        risolvi(undefined);
      }
    });
  }
}
