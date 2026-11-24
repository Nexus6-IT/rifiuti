import { Injectable } from '@angular/core';
import { ArchivioGiroIndexedDb } from './archivio-giro.indexeddb';
import type { GiroVista } from './modelli';

/**
 * Copia del giro tenuta sul telefono. Solo il giro del giorno di UN utente: niente listini ne'
 * dati di fatturazione. Tenere UN solo snapshot (e non uno per utente) e' voluto: sui telefoni
 * condivisi il giro di un altro autista non deve mai restare li'.
 */
export interface SnapshotGiro {
  /** `sub` del token di chi ha scaricato il giro. */
  utenteId: string;
  /** Giorno del giro, 'AAAA-MM-GG' locale. */
  data: string;
  /** Istante dell'ultimo scaricamento riuscito (ISO). */
  aggiornatoIl: string;
  giro: GiroVista;
}

/**
 * Archivio astratto: oggi IndexedDB del browser, domani (Capacitor) SQLite/Preferences nativi
 * sostituendo solo il provider. Le implementazioni usano `implements`, non `extends`.
 */
@Injectable({ providedIn: 'root', useFactory: () => new ArchivioGiroIndexedDb() })
export abstract class ArchivioGiro {
  /** Sostituisce qualunque snapshot precedente. */
  abstract salva(snapshot: SnapshotGiro): Promise<void>;
  abstract leggi(): Promise<SnapshotGiro | null>;
  abstract cancella(): Promise<void>;
}
