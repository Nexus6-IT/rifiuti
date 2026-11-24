import { Injectable } from '@angular/core';

/** Posizione al momento dell'evento: UNA lettura, mai una serie. */
export interface PosizioneRilevata {
  lat: number;
  lon: number;
  /** Raggio di incertezza, in metri. */
  accuratezza: number;
}

export class PosizioneNonDisponibile extends Error {}

/**
 * Una sola lettura della posizione, quando l'autista la chiede (in primo piano, col permesso del
 * browser). NON esiste `watchPosition` ne' una lettura in background: niente tracciamento continuo
 * (art. 4 Statuto dei lavoratori, GDPR). Astratta per i test.
 */
@Injectable({ providedIn: 'root', useFactory: () => new RilevatorePosizioneBrowser() })
export abstract class RilevatorePosizione {
  abstract rileva(): Promise<PosizioneRilevata>;
}

export class RilevatorePosizioneBrowser implements RilevatorePosizione {
  rileva(): Promise<PosizioneRilevata> {
    const geo = typeof navigator === 'undefined' ? undefined : navigator.geolocation;
    if (!geo) {
      return Promise.reject(new PosizioneNonDisponibile('Questo telefono non ha la posizione.'));
    }
    return new Promise((ok, ko) =>
      geo.getCurrentPosition(
        (p) =>
          ok({ lat: p.coords.latitude, lon: p.coords.longitude, accuratezza: p.coords.accuracy }),
        (e) =>
          ko(
            new PosizioneNonDisponibile(
              e.code === e.PERMISSION_DENIED
                ? 'Permesso di posizione negato: puoi inviare l’esito senza.'
                : e.code === e.TIMEOUT
                  ? 'Posizione non trovata in tempo: riprova all’aperto o invia senza.'
                  : 'Posizione non disponibile: puoi inviare l’esito senza.',
            ),
          ),
        // Lettura fresca (maximumAge 0): la posizione e' quella di adesso, non una vecchia in cache.
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
      ),
    );
  }
}
