import { Injectable } from '@angular/core';
import { ArchivioCodaIndexedDb } from './archivio-coda.indexeddb';
import type { EventoInCoda } from './coda-eventi';

/**
 * Archivio della coda di uscita sul telefono. Gli eventi (esiti dell'autista) non vanno persi se
 * l'app si chiude prima dell'invio, quindi si scrivono PRIMA di spedire. Astratto come `ArchivioGiro`:
 * con Capacitor basta sostituire il provider. `salva` lancia se il telefono non puo' scrivere.
 */
@Injectable({ providedIn: 'root', useFactory: () => new ArchivioCodaIndexedDb() })
export abstract class ArchivioCoda {
  /** Tutti gli eventi, di tutti gli utenti del telefono. */
  abstract tutti(): Promise<EventoInCoda[]>;
  /** Inserisce o sostituisce per `id`. */
  abstract salva(evento: EventoInCoda): Promise<void>;
  abstract rimuovi(id: string): Promise<void>;
}
