import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { PORTA_PUSH, portaPushBrowser } from './porta-push';
import { SessioneService } from './sessione.service';

const API = '/api/v1/push';
const TIMEOUT_RETE_MS = 10_000;
/** Il logout non deve mai restare appeso alla pulizia delle notifiche. */
const TIMEOUT_LOGOUT_MS = 4_000;

export type StatoPush =
  | 'sconosciuto'
  | 'non-supportato'
  | 'da-installare'
  | 'non-disponibile'
  | 'negato'
  | 'da-attivare'
  | 'attivo';

export interface PreferenzePush {
  giroModificato: boolean;
}

interface Configurazione {
  disponibile: boolean;
  chiavePubblica: string | null;
}

/** Risolve con il risultato o con `null` allo scadere: `serviceWorker.ready` puo' non risolversi mai. */
function entro<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(
    () => null,
  );
}

/**
 * Notifiche push dell'app. L'avviso non porta dati: il telefono mostra un testo generico e l'app
 * rilegge il giro online. La sottoscrizione appartiene al dispositivo, il server la lega all'utente:
 * al logout si toglie dal server e dal browser; se il logout non riesce (offline, sessione scaduta)
 * si toglie almeno dal browser, e il server la scarta da solo al prossimo invio (410).
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly http = inject(HttpClient);
  private readonly porta = inject(PORTA_PUSH, { optional: true }) ?? portaPushBrowser;
  private readonly sessione = inject(SessioneService);

  private chiavePubblica: string | null = null;
  /** Disiscrizione dal browser in corso (cambio utente/logout): chi legge lo stato la aspetta. */
  private pulizia: Promise<unknown> = Promise.resolve();
  private readonly _stato = signal<StatoPush>('sconosciuto');
  private readonly _preferenze = signal<PreferenzePush>({ giroModificato: true });
  private readonly _errore = signal<string | null>(null);
  private readonly _occupato = signal(false);

  readonly stato = this._stato.asReadonly();
  readonly preferenze = this._preferenze.asReadonly();
  readonly errore = this._errore.asReadonly();
  readonly occupato = this._occupato.asReadonly();

  constructor() {
    this.sessione.primaDelLogout(() => this.rimuoviAlLogout());
    this.sessione.allaChiusura((ev) => this.sessioneChiusa(ev.stessoUtente));
  }

  /** Legge cosa offrono browser e server. Chiamata dalla schermata del giro. */
  async inizializza(): Promise<void> {
    this._errore.set(null);
    await this.pulizia;
    if (!this.porta.supportato()) {
      this._stato.set('non-supportato');
      return;
    }
    if (this.porta.richiedeInstallazione()) {
      this._stato.set('da-installare');
      return;
    }
    let config: Configurazione;
    try {
      config = await firstValueFrom(
        this.http.get<Configurazione>(`${API}/configurazione`).pipe(timeout(TIMEOUT_RETE_MS)),
      );
    } catch {
      this._stato.set('non-disponibile');
      return;
    }
    if (!config.disponibile || !config.chiavePubblica) {
      this._stato.set('non-disponibile');
      return;
    }
    this.chiavePubblica = config.chiavePubblica;
    if (this.porta.permesso() === 'denied') {
      this._stato.set('negato');
      return;
    }
    try {
      this._preferenze.set(
        await firstValueFrom(
          this.http.get<PreferenzePush>(`${API}/preferenze`).pipe(timeout(TIMEOUT_RETE_MS)),
        ),
      );
    } catch {
      /* restano i predefiniti */
    }
    const endpoint = this.porta.permesso() === 'granted' ? await this.endpointAttuale() : null;
    if (!endpoint) {
      this._stato.set('da-attivare');
      return;
    }
    // Il dispositivo e' gia' sottoscritto: si riallinea il server (puo' essere passato a un altro utente).
    this._stato.set('attivo');
    try {
      await this.registra(endpoint);
    } catch {
      /* rete assente: il dispositivo resta sottoscritto, si riprova alla prossima apertura */
    }
  }

  /** Da un tocco dell'utente: chiede il permesso, sottoscrive e registra sul server. */
  async attiva(): Promise<void> {
    if (this._occupato() || !this.chiavePubblica) return;
    this._occupato.set(true);
    await this.pulizia;
    this._errore.set(null);
    try {
      const permesso =
        this.porta.permesso() === 'granted' ? 'granted' : await this.porta.chiediPermesso();
      if (permesso === 'denied') {
        this._stato.set('negato');
        return;
      }
      if (permesso !== 'granted') return;
      let endpoint: string;
      try {
        endpoint = await this.porta.sottoscrivi(this.chiavePubblica);
      } catch {
        this._errore.set('Non è stato possibile attivare le notifiche su questo dispositivo.');
        return;
      }
      try {
        await this.registra(endpoint);
        this._stato.set('attivo');
      } catch {
        await entro(this.porta.annullaLocale(), TIMEOUT_LOGOUT_MS);
        this._errore.set('Le notifiche non sono state attivate: riprova fra poco.');
      }
    } finally {
      this._occupato.set(false);
    }
  }

  async disattiva(): Promise<void> {
    if (this._occupato()) return;
    this._occupato.set(true);
    this._errore.set(null);
    try {
      await this.togli();
      this._stato.set('da-attivare');
    } finally {
      this._occupato.set(false);
    }
  }

  async impostaGiroModificato(valore: boolean): Promise<void> {
    this._errore.set(null);
    try {
      this._preferenze.set(
        await firstValueFrom(
          this.http
            .put<PreferenzePush>(`${API}/preferenze`, { giroModificato: valore })
            .pipe(timeout(TIMEOUT_RETE_MS)),
        ),
      );
    } catch {
      this._errore.set('Non è stato possibile salvare la preferenza: riprova fra poco.');
    }
  }

  /** Prima del logout: toglie il dispositivo dal server e dal browser, senza mai bloccare l'uscita. */
  async rimuoviAlLogout(): Promise<void> {
    if (!this.porta.supportato()) return;
    // Un solo tetto per l'intero passo: l'uscita non aspetta piu' di ~4 s in tutto.
    await entro(
      (async () => {
        const endpoint = (await this.porta.endpointAttuale()) ?? null;
        if (endpoint) await this.togli(endpoint);
      })(),
      TIMEOUT_LOGOUT_MS,
    );
  }

  /**
   * Sessione finita o cambio utente: dal browser si toglie subito, il server la scarta con il 410.
   * Un nuovo accesso dello STESSO utente non tocca nulla: il dispositivo resta sottoscritto.
   */
  sessioneChiusa(stessoUtente = false): void {
    if (stessoUtente) return;
    if (this._stato() === 'attivo') this._stato.set('da-attivare');
    if (!this.porta.supportato()) return;
    this.pulizia = entro(this.porta.annullaLocale(), TIMEOUT_LOGOUT_MS);
  }

  private async endpointAttuale(): Promise<string | null> {
    return (await entro(this.porta.endpointAttuale(), TIMEOUT_LOGOUT_MS)) ?? null;
  }

  private async registra(endpoint: string): Promise<void> {
    await firstValueFrom(
      this.http.put<void>(`${API}/sottoscrizione`, { endpoint }).pipe(timeout(TIMEOUT_RETE_MS)),
    );
  }

  /** Server (best effort) e poi browser. */
  private async togli(letto?: string): Promise<void> {
    const endpoint = letto ?? (await this.endpointAttuale());
    if (endpoint) {
      try {
        await firstValueFrom(
          this.http
            .post<void>(`${API}/sottoscrizione/annulla`, { endpoint })
            .pipe(timeout(TIMEOUT_LOGOUT_MS)),
        );
      } catch {
        /* il server la scartera' al prossimo invio (410) */
      }
    }
    await entro(this.porta.annullaLocale(), TIMEOUT_LOGOUT_MS);
  }
}
