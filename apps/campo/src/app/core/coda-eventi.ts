import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { ArchivioCoda } from './archivio-coda';
import { SessioneService } from './sessione.service';

export type TipoEventoCampo = 'RITIRO_ESEGUITO' | 'RITIRO_NON_ESEGUITO';
export type StatoEventoCoda = 'DA_INVIARE' | 'CONFERMATO' | 'RIFIUTATO';

export interface DatiEvento {
  /** Obbligatorio per RITIRO_NON_ESEGUITO. */
  motivo?: string;
  nota?: string;
}

/** Cio' che l'autista dichiara: l'identita' (uuid, utente, ora) la aggiunge la coda. */
export interface NuovoEvento {
  ritiroId: string;
  tipo: TipoEventoCampo;
  /** `versione` del ritiro che l'autista aveva davanti. */
  versioneVista: number;
  dati: DatiEvento;
}

/** Un esito nella coda di uscita (e, una volta confermato, nel promemoria della giornata). */
export interface EventoInCoda extends NuovoEvento {
  /** UUID generato qui: chiave di idempotenza lato server. */
  id: string;
  /** `sub` di chi l'ha registrato: la coda e' per utente. */
  utenteId: string;
  /** Orologio del telefono (mai data legale). */
  rilevatoIl: string;
  stato: StatoEventoCoda;
  tentativi: number;
  /** Ultimo errore, in italiano, da mostrare all'autista. */
  errore: string | null;
  esito: 'APPLICATO' | 'DA_RICONCILIARE' | null;
  motivoConflitto: string | null;
}

interface RispostaEvento {
  id: string;
  esito: 'APPLICATO' | 'DA_RICONCILIARE';
  motivoConflitto: string | null;
}

const INTERVALLO_MS = 20_000;
const TIMEOUT_RICHIESTA_MS = 20_000;

/**
 * Coda di uscita degli esiti dal campo.
 *
 * - L'evento si scrive nell'archivio del telefono PRIMA di spedire: se l'app si chiude non si perde.
 * - L'`id` (uuid) e' lo stesso a ogni reinvio: il server risponde identico e non duplica nulla,
 *   quindi dopo un timeout o una risposta persa si puo' reinviare senza paura.
 * - Un solo invio alla volta, in ordine di registrazione. Se la rete manca o il server ha un guasto
 *   passeggero ci si ferma e si riprova (apertura, ritorno della rete, ripresa, ogni 20 secondi).
 * - Un rifiuto definitivo (400/404/409) non si ritenta: l'evento diventa RIFIUTATO e resta visibile
 *   finche' l'autista non lo scarta. Mai un esito sparisce in silenzio.
 * - La coda e' PER UTENTE: si inviano solo gli eventi di chi e' entrato; quelli di un altro utente
 *   restano sul telefono e l'app chiede cosa farne.
 * - Gli eventi CONFERMATI (contengono note) restano solo come promemoria della giornata e spariscono
 *   a fine sessione.
 */
@Injectable({ providedIn: 'root' })
export class CodaEventi {
  private readonly http = inject(HttpClient);
  private readonly archivio = inject(ArchivioCoda);
  private readonly sessione = inject(SessioneService);
  private readonly _tutti = signal<EventoInCoda[]>([]);
  private readonly _nonSalvato = signal(false);
  private readonly _inInvio = signal(false);
  private catena: Promise<unknown> = Promise.resolve();
  private cicloInCorso: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private avviata = false;
  private readonly alRitornoRete = () => void this.invia();
  private readonly allaRipresa = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void this.invia();
  };

  /** Eventi dell'utente collegato, dal piu' vecchio. */
  readonly miei = computed(() => {
    const io = this.sessione.utenteId();
    return io === null ? [] : this._tutti().filter((e) => e.utenteId === io);
  });
  readonly daInviare = computed(() => this.miei().filter((e) => e.stato === 'DA_INVIARE').length);
  readonly rifiutati = computed(() => this.miei().filter((e) => e.stato === 'RIFIUTATO').length);
  /** Eventi ancora da inviare registrati da un altro utente di questo telefono. */
  readonly diAltriUtenti = computed(() => {
    const io = this.sessione.utenteId();
    return this._tutti().filter((e) => e.utenteId !== io && e.stato === 'DA_INVIARE').length;
  });
  /** `true` se almeno un evento esiste solo in memoria (il telefono non puo' scrivere l'archivio). */
  readonly nonSalvato = this._nonSalvato.asReadonly();
  readonly inInvio = this._inInvio.asReadonly();

  constructor() {
    // Fine sessione / nuovo accesso: via i promemoria confermati, restano gli eventi da inviare.
    this.sessione.allaChiusura(() => void this.pulisciConfermati());
  }

  /** Carica l'archivio, tenta un invio e tiene viva la coda (rete, ripresa, intervallo). */
  async avvia(): Promise<void> {
    await this.carica();
    if (!this.avviata && typeof window !== 'undefined') {
      this.avviata = true;
      window.addEventListener('online', this.alRitornoRete);
      document.addEventListener('visibilitychange', this.allaRipresa);
      this.timer = setInterval(() => {
        if (this.daInviare() > 0) void this.invia();
      }, INTERVALLO_MS);
    }
    void this.invia();
  }

  ferma(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.avviata && typeof window !== 'undefined') {
      window.removeEventListener('online', this.alRitornoRete);
      document.removeEventListener('visibilitychange', this.allaRipresa);
    }
    this.avviata = false;
  }

  /** L'esito dato a un ritiro dall'utente collegato (anche in attesa di invio), se c'e'. */
  perRitiro(ritiroId: string): EventoInCoda | null {
    return this.miei().find((e) => e.ritiroId === ritiroId && e.stato !== 'RIFIUTATO') ?? null;
  }

  /** Il rifiutato piu' recente di un ritiro (per mostrarne il motivo), se non c'e' un esito valido. */
  rifiutatoPerRitiro(ritiroId: string): EventoInCoda | null {
    const r = this.miei().filter((e) => e.ritiroId === ritiroId && e.stato === 'RIFIUTATO');
    return r.length > 0 ? r[r.length - 1] : null;
  }

  /**
   * Registra un esito: lo scrive sul telefono, poi tenta l'invio senza aspettarlo. Un secondo tocco
   * sullo stesso ritiro restituisce l'evento gia' registrato (niente doppioni).
   */
  registra(nuovo: NuovoEvento): Promise<EventoInCoda> {
    const lavoro = this.catena.then(() => this.registraSerializzato(nuovo));
    this.catena = lavoro.catch(() => undefined);
    return lavoro;
  }

  private async registraSerializzato(nuovo: NuovoEvento): Promise<EventoInCoda> {
    const utenteId = this.sessione.utenteId();
    if (!utenteId) throw new Error('Nessuna sessione: accedi per registrare un esito.');
    const esistente = this.perRitiro(nuovo.ritiroId);
    if (esistente) return esistente;
    const evento: EventoInCoda = {
      ...nuovo,
      id: crypto.randomUUID(),
      utenteId,
      rilevatoIl: new Date().toISOString(),
      stato: 'DA_INVIARE',
      tentativi: 0,
      errore: null,
      esito: null,
      motivoConflitto: null,
    };
    await this.scrivi(evento);
    void this.invia();
    return evento;
  }

  /** Spedisce, in ordine, gli eventi dell'utente collegato. Un solo ciclo alla volta. */
  invia(): Promise<void> {
    this.cicloInCorso ??= this.ciclo().finally(() => (this.cicloInCorso = null));
    return this.cicloInCorso;
  }

  /** Toglie dalla coda un evento dell'utente (rifiutato, o da inviare se l'autista cambia idea). */
  async scarta(id: string): Promise<void> {
    const io = this.sessione.utenteId();
    const e = this._tutti().find((x) => x.id === id);
    if (!e || e.utenteId !== io) return;
    await this.togli([id]);
  }

  /** Scarta gli eventi non inviati di altri utenti (decisione esplicita dell'autista). */
  async scartaDiAltriUtenti(): Promise<void> {
    const io = this.sessione.utenteId();
    await this.togli(
      this._tutti()
        .filter((e) => e.utenteId !== io)
        .map((e) => e.id),
    );
  }

  private async ciclo(): Promise<void> {
    this._inInvio.set(true);
    try {
      for (;;) {
        const prossimo = this.miei().find((e) => e.stato === 'DA_INVIARE');
        if (!prossimo) return;
        if (!(await this.spedisci(prossimo))) return;
      }
    } finally {
      this._inInvio.set(false);
    }
  }

  /** Spedisce un evento. `true` se si puo' proseguire con il successivo, `false` se ci si ferma. */
  private async spedisci(e: EventoInCoda): Promise<boolean> {
    try {
      const r = await firstValueFrom(
        this.http
          .post<RispostaEvento>('/api/v1/campo/eventi', {
            id: e.id,
            ritiroId: e.ritiroId,
            tipo: e.tipo,
            versioneVista: e.versioneVista,
            rilevatoIl: e.rilevatoIl,
            dati: e.dati,
          })
          .pipe(timeout(TIMEOUT_RICHIESTA_MS)),
      );
      await this.scrivi({
        ...e,
        stato: 'CONFERMATO',
        errore: null,
        esito: r.esito,
        motivoConflitto: r.motivoConflitto,
      });
      return true;
    } catch (err) {
      const stato = err instanceof HttpErrorResponse ? err.status : 0;
      const messaggio =
        err instanceof HttpErrorResponse ? messaggioServer(err) : 'Il server non risponde.';
      if (stato === 400 || stato === 404 || stato === 409 || stato === 422) {
        await this.scrivi({
          ...e,
          stato: 'RIFIUTATO',
          errore: messaggio ?? 'Il server non ha accettato questo esito.',
        });
        return true;
      }
      // Rete assente, timeout, 401 (sessione finita), 403, 429, 5xx: l'evento resta, si riprova.
      await this.scrivi({ ...e, tentativi: e.tentativi + 1, errore: messaggio });
      return false;
    }
  }

  private async carica(): Promise<void> {
    try {
      const salvati = await this.archivio.tutti();
      const inMemoria = this._tutti().filter((m) => !salvati.some((s) => s.id === m.id));
      this._tutti.set([...salvati, ...inMemoria].sort(perData));
      // Promemoria confermati di un giorno passato: non servono piu' e contengono note.
      const oggi = dataLocale(new Date());
      const vecchi = this._tutti().filter(
        (e) => e.stato === 'CONFERMATO' && dataLocale(new Date(e.rilevatoIl)) !== oggi,
      );
      if (vecchi.length > 0) await this.togli(vecchi.map((e) => e.id));
    } catch {
      /* archivio non leggibile: resta quanto c'e' in memoria */
    }
  }

  /** Aggiorna memoria e archivio; se l'archivio non scrive, l'evento resta solo in memoria. */
  private async scrivi(e: EventoInCoda): Promise<void> {
    this._tutti.update((l) => [...l.filter((x) => x.id !== e.id), e].sort(perData));
    try {
      await this.archivio.salva(e);
    } catch {
      this._nonSalvato.set(true);
    }
  }

  private async togli(ids: string[]): Promise<void> {
    this._tutti.update((l) => l.filter((x) => !ids.includes(x.id)));
    for (const id of ids) {
      try {
        await this.archivio.rimuovi(id);
      } catch {
        /* resta nell'archivio: al prossimo avvio riappare e si puo' scartare di nuovo */
      }
    }
  }

  /** Via i promemoria CONFERMATI (note comprese); gli eventi da inviare o rifiutati restano. */
  private async pulisciConfermati(): Promise<void> {
    const ids = this._tutti()
      .filter((e) => e.stato === 'CONFERMATO')
      .map((e) => e.id);
    if (ids.length > 0) await this.togli(ids);
    try {
      const salvati = await this.archivio.tutti();
      await this.togli(salvati.filter((e) => e.stato === 'CONFERMATO').map((e) => e.id));
    } catch {
      /* archivio non disponibile */
    }
  }
}

function dataLocale(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const perData = (a: EventoInCoda, b: EventoInCoda) =>
  a.rilevatoIl < b.rilevatoIl ? -1 : a.rilevatoIl > b.rilevatoIl ? 1 : a.id < b.id ? -1 : 1;

function messaggioServer(e: HttpErrorResponse): string | null {
  const m = (e.error as { message?: unknown } | null)?.message;
  if (typeof m === 'string' && m && e.status < 500) return m;
  if (Array.isArray(m) && m.length > 0 && e.status < 500) return String(m[0]);
  if (e.status === 0) return 'Nessuna connessione.';
  return null;
}
