import type { ArchivioGiro, SnapshotGiro } from './archivio-giro';

const NOME_DB = 'wasteflow-campo';
const NOME_STORE = 'giro';
const CHIAVE = 'corrente';

/**
 * Archivio su IndexedDB nativo (nessuna dipendenza). Un solo record.
 *
 * - Senza IndexedDB (o `open` in errore) le letture/scritture non lanciano: l'app resta online-only.
 *   La connessione assente NON resta in cache: il tentativo dopo riapre.
 * - Safari iOS chiude la connessione quando l'app va in background: `onclose`/`onversionchange`
 *   azzerano la cache e, se una transazione lancia, si riapre e si ritenta UNA volta.
 * - `cancella` (logout, cambio utente) lancia se anche il secondo tentativo fallisce: i dati
 *   personali restati sul telefono non devono passare in silenzio.
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
    await this.esegui<unknown>('readwrite', (s) => s.clear(), true);
  }

  private apri(): Promise<IDBDatabase | null> {
    this.db ??= new Promise((risolvi) => {
      const fallita = () => {
        this.db = null;
        risolvi(null);
      };
      if (typeof indexedDB === 'undefined' || !indexedDB) return fallita();
      try {
        const rich = indexedDB.open(NOME_DB, 1);
        rich.onupgradeneeded = () => rich.result.createObjectStore(NOME_STORE);
        rich.onsuccess = () => {
          const db = rich.result;
          db.onclose = () => (this.db = null);
          db.onversionchange = () => {
            db.close();
            this.db = null;
          };
          risolvi(db);
        };
        rich.onerror = fallita;
        rich.onblocked = fallita;
      } catch {
        fallita();
      }
    });
    return this.db;
  }

  private async esegui<T>(
    modo: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
    rilancia = false,
  ): Promise<T | undefined> {
    let ultimo: unknown = new Error('IndexedDB non disponibile');
    for (let tentativo = 0; tentativo < 2; tentativo++) {
      const db = await this.apri();
      if (!db) {
        this.db = null; // non resta in cache: la prossima operazione ritenta l'apertura
        return undefined;
      }
      try {
        return await new Promise<T | undefined>((risolvi, rifiuta) => {
          const tx = db.transaction(NOME_STORE, modo);
          const rich = op(tx.objectStore(NOME_STORE));
          tx.oncomplete = () => risolvi(rich.result);
          tx.onerror = () => rifiuta(tx.error ?? new Error('transazione fallita'));
          tx.onabort = () => rifiuta(tx.error ?? new Error('transazione annullata'));
        });
      } catch (e) {
        ultimo = e;
        this.db = null; // connessione forse persa: la prossima volta si riapre
      }
    }
    if (rilancia) throw ultimo;
    return undefined;
  }
}
