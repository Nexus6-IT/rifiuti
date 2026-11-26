import type { ArchivioRicevute } from './archivio-ricevute';
import type { RicevutaInCoda } from './coda-ricevute';
import { StoreIdb } from './store-idb';

/** Ricevute su IndexedDB nativo, in un database SEPARATO da giro ed esiti. */
export class ArchivioRicevuteIndexedDb implements ArchivioRicevute {
  private readonly store = new StoreIdb({
    nomeDb: 'wasteflow-campo-ricevute',
    nomeStore: 'ricevute',
    creazione: { keyPath: 'id' },
  });

  async tutte(): Promise<RicevutaInCoda[]> {
    return (await this.store.esegui<RicevutaInCoda[]>('readonly', (s) => s.getAll())) ?? [];
  }

  async salva(r: RicevutaInCoda): Promise<void> {
    await this.store.esegui<unknown>('readwrite', (s) => s.put(r), {
      rilancia: true,
      richiediDb: true,
    });
  }

  async rimuovi(id: string): Promise<void> {
    await this.store.esegui<unknown>('readwrite', (s) => s.delete(id), {
      rilancia: true,
      richiediDb: true,
    });
  }
}
