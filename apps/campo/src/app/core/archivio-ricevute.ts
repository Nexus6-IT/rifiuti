import { Injectable } from '@angular/core';
import { ArchivioRicevuteIndexedDb } from './archivio-ricevute.indexeddb';
import type { RicevutaInCoda } from './coda-ricevute';

/**
 * Archivio delle ricevute sul telefono. Come la coda degli esiti: la ricevuta (con l'immagine della
 * firma) si scrive PRIMA di spedire, cosi' non si perde se l'app si chiude. Astratto: con Capacitor
 * basta sostituire il provider.
 */
@Injectable({ providedIn: 'root', useFactory: () => new ArchivioRicevuteIndexedDb() })
export abstract class ArchivioRicevute {
  abstract tutte(): Promise<RicevutaInCoda[]>;
  /** Inserisce o sostituisce per `id`. Lancia se il telefono non puo' scrivere. */
  abstract salva(r: RicevutaInCoda): Promise<void>;
  abstract rimuovi(id: string): Promise<void>;
}
