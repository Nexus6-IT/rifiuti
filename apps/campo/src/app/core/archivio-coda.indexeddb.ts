import type { ArchivioCoda } from './archivio-coda';
import type { EventoInCoda } from './coda-eventi';
import { StoreIdb } from './store-idb';

/**
 * Coda su IndexedDB nativo, in un database SEPARATO da quello del giro: il giro si cancella a fine
 * giornata e al logout, la coda no (gli esiti non inviati devono sopravvivere).
 */
export class ArchivioCodaIndexedDb implements ArchivioCoda {
  private readonly store = new StoreIdb({
    nomeDb: 'wasteflow-campo-coda',
    nomeStore: 'eventi',
    creazione: { keyPath: 'id' },
  });

  async tutti(): Promise<EventoInCoda[]> {
    return (await this.store.esegui<EventoInCoda[]>('readonly', (s) => s.getAll())) ?? [];
  }

  async salva(evento: EventoInCoda): Promise<void> {
    await this.store.esegui<unknown>('readwrite', (s) => s.put(evento), {
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
