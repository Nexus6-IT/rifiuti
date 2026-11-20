/**
 * Accesso minimo a UN object store di IndexedDB nativo (nessuna dipendenza), con la gestione delle
 * connessioni persa che serve su Safari iOS:
 *
 * - senza IndexedDB (o `open` in errore/bloccato) le operazioni non lanciano e la mancata apertura
 *   NON resta in cache: la prossima operazione riprova;
 * - `onclose`/`onversionchange` azzerano la cache, ma SOLO se la connessione che si chiude e' ancora
 *   quella in cache (la chiusura ritardata di una vecchia non deve buttare la nuova);
 * - se una transazione lancia, la connessione scartata viene CHIUSA, poi si riapre e si ritenta UNA
 *   volta;
 * - `rilancia` (usato dalle cancellazioni di dati personali): se anche il secondo tentativo fallisce
 *   l'errore esce, e se e' indicata `chiavePulizia` la cancellazione fallita viene ricordata in
 *   localStorage e ritentata prima della prossima operazione (non passa in silenzio).
 */
export interface OpzioniStoreIdb {
  nomeDb: string;
  nomeStore: string;
  /** Opzioni di `createObjectStore` (es. `{ keyPath: 'id' }`). */
  creazione?: IDBObjectStoreParameters;
  /** Chiave localStorage che ricorda una cancellazione completa non riuscita. */
  chiavePulizia?: string;
}

export class StoreIdb {
  private connessione: Promise<IDBDatabase | null> | null = null;
  private dbCorrente: IDBDatabase | null = null;

  constructor(private readonly opz: OpzioniStoreIdb) {}

  async esegui<T>(
    modo: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
    rilancia = false,
  ): Promise<T | undefined> {
    await this.ritentaPulizia();
    return this.eseguiGrezzo(modo, op, rilancia);
  }

  /** Svuota lo store. Lancia se non riesce, ricordando la pulizia da rifare (se configurato). */
  async svuota(): Promise<void> {
    try {
      await this.eseguiGrezzo<unknown>('readwrite', (s) => s.clear(), true);
      this.segnaPulizia(false);
    } catch (e) {
      this.segnaPulizia(true);
      throw e;
    }
  }

  private async ritentaPulizia(): Promise<void> {
    const k = this.opz.chiavePulizia;
    if (!k) return;
    let pendente = false;
    try {
      pendente = localStorage.getItem(k) === '1';
    } catch {
      return;
    }
    if (!pendente) return;
    try {
      await this.eseguiGrezzo<unknown>('readwrite', (s) => s.clear(), true);
      this.segnaPulizia(false);
    } catch {
      /* resta pendente: ci riprova la prossima volta */
    }
  }

  private segnaPulizia(pendente: boolean): void {
    const k = this.opz.chiavePulizia;
    if (!k) return;
    try {
      if (pendente) localStorage.setItem(k, '1');
      else localStorage.removeItem(k);
    } catch {
      /* archivio non disponibile */
    }
  }

  private apri(): Promise<IDBDatabase | null> {
    if (this.connessione) return this.connessione;
    let questa: Promise<IDBDatabase | null> | undefined;
    const scarta = () => {
      if (questa !== undefined && this.connessione === questa) this.connessione = null;
    };
    questa = new Promise<IDBDatabase | null>((risolvi) => {
      const fallita = () => {
        scarta();
        risolvi(null);
      };
      if (typeof indexedDB === 'undefined' || !indexedDB) return fallita();
      try {
        const rich = indexedDB.open(this.opz.nomeDb, 1);
        rich.onupgradeneeded = () =>
          rich.result.createObjectStore(this.opz.nomeStore, this.opz.creazione);
        rich.onsuccess = () => {
          const db = rich.result;
          this.dbCorrente = db;
          db.onclose = () => {
            if (this.dbCorrente === db) {
              this.dbCorrente = null;
              scarta();
            }
          };
          db.onversionchange = () => {
            db.close();
            if (this.dbCorrente === db) {
              this.dbCorrente = null;
              scarta();
            }
          };
          risolvi(db);
        };
        rich.onerror = fallita;
        rich.onblocked = fallita;
      } catch {
        fallita();
      }
    });
    this.connessione = questa;
    return questa;
  }

  /** Scarta la connessione data (se e' quella in cache) e la chiude. */
  private scartaConnessione(db: IDBDatabase): void {
    try {
      db.close();
    } catch {
      /* gia' chiusa */
    }
    if (this.dbCorrente === db) {
      this.dbCorrente = null;
      this.connessione = null;
    }
  }

  private async eseguiGrezzo<T>(
    modo: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
    rilancia: boolean,
  ): Promise<T | undefined> {
    let ultimo: unknown = new Error('IndexedDB non disponibile');
    for (let tentativo = 0; tentativo < 2; tentativo++) {
      const db = await this.apri();
      if (!db) {
        this.connessione = null; // non resta in cache: la prossima operazione ritenta l'apertura
        return undefined;
      }
      try {
        return await new Promise<T | undefined>((risolvi, rifiuta) => {
          const tx = db.transaction(this.opz.nomeStore, modo);
          const rich = op(tx.objectStore(this.opz.nomeStore));
          tx.oncomplete = () => risolvi(rich.result);
          tx.onerror = () => rifiuta(tx.error ?? new Error('transazione fallita'));
          tx.onabort = () => rifiuta(tx.error ?? new Error('transazione annullata'));
        });
      } catch (e) {
        ultimo = e;
        this.scartaConnessione(db); // connessione forse persa: chiusa, la prossima volta si riapre
      }
    }
    if (rilancia) throw ultimo;
    return undefined;
  }
}
