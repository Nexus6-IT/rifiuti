import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { ArchivioCoda } from './archivio-coda';
import type { FotoPronta } from './foto';
import type { PosizioneRilevata } from './posizione';
import { SessioneService } from './sessione.service';

export type TipoEventoCampo = 'RITIRO_ESEGUITO' | 'RITIRO_NON_ESEGUITO';
export type StatoEventoCoda = 'DA_INVIARE' | 'CONFERMATO' | 'RIFIUTATO';

export interface DatiEvento {
  /** Obbligatorio per RITIRO_NON_ESEGUITO. */
  motivo?: string;
  nota?: string;
  /** Posizione al momento dell'evento (una lettura, facoltativa). Parte nel corpo dell'evento. */
  posizione?: PosizioneRilevata;
}

export type StatoFotoCoda = 'DA_INVIARE' | 'INVIATA' | 'RIFIUTATA';

/** Una foto dell'esito: viaggia DOPO l'evento, con il suo uuid (idempotenza) e la sua impronta. */
export interface FotoInCoda {
  id: string;
  mimeType: 'image/jpeg';
  dimensioneByte: number;
  sha256: string;
  stato: StatoFotoCoda;
  tentativi: number;
  errore: string | null;
  /** Byte della foto: solo finche' non e' INVIATA o RIFIUTATA (poi si liberano). */
  contenuto: ArrayBuffer | null;
}

/** Cio' che l'autista dichiara: l'identita' (uuid, utente, ora) la aggiunge la coda. */
export interface NuovoEvento {
  ritiroId: string;
  tipo: TipoEventoCampo;
  /** `versione` del ritiro che l'autista aveva davanti. */
  versioneVista: number;
  /** Data del giro e sede che l'autista aveva davanti. */
  dataVista: string;
  sedeVista: string;
  dati: DatiEvento;
  /** Foto gia' compresse (massimo 3), facoltative. */
  foto?: FotoPronta[];
}

/** Un esito nella coda di uscita (e, una volta confermato, nel promemoria della giornata). */
export interface EventoInCoda extends Omit<NuovoEvento, 'foto'> {
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
  /** Assente negli eventi salvati dalla versione precedente dell'app: si legge con `fotoDi`. */
  foto?: FotoInCoda[];
}

/** Le foto di un evento (anche di uno salvato prima che esistessero). */
export const fotoDi = (e: EventoInCoda): FotoInCoda[] => e.foto ?? [];
const haFotoDaInviare = (e: EventoInCoda) => fotoDi(e).some((f) => f.stato === 'DA_INVIARE');

interface RispostaEvento {
  id: string;
  esito: 'APPLICATO' | 'DA_RICONCILIARE';
  motivoConflitto: string | null;
}

const INTERVALLO_MS = 20_000;
const TIMEOUT_RICHIESTA_MS = 20_000;
const TIMEOUT_FOTO_MS = 60_000;
/** Una foto con impronta non corrispondente puo' essere un guasto di rete: si ritenta prima di arrendersi. */
const TENTATIVI_HASH = 3;

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
 * - Le FOTO partono dopo l'evento (che deve esistere sul server), una alla volta, con il loro uuid:
 *   stessa idempotenza. Un rifiuto definitivo (troppo grande, tipo, limite, impronta) segna la foto
 *   RIFIUTATA senza fermare le altre. I byte stanno nell'archivio finche' la foto non e' arrivata.
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
  private readonly _bloccata = signal<string | null>(null);
  private catena: Promise<unknown> = Promise.resolve();
  private cicloInCorso: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private avviata = false;
  private readonly alRitornoRete = () => void this.inviaAuto();
  private readonly allaRipresa = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden')
      void this.inviaAuto();
  };

  /** Eventi dell'utente collegato, dal piu' vecchio. */
  readonly miei = computed(() => {
    const io = this.sessione.utenteId();
    return io === null ? [] : this._tutti().filter((e) => e.utenteId === io);
  });
  readonly daInviare = computed(() => this.miei().filter((e) => e.stato === 'DA_INVIARE').length);
  /** Foto accettate in coda ma non ancora arrivate al server (di eventi non rifiutati). */
  readonly fotoDaInviare = computed(
    () =>
      this.miei()
        .filter((e) => e.stato !== 'RIFIUTATO')
        .flatMap(fotoDi)
        .filter((f) => f.stato === 'DA_INVIARE').length,
  );
  readonly fotoRifiutate = computed(
    () =>
      this.miei()
        .flatMap(fotoDi)
        .filter((f) => f.stato === 'RIFIUTATA').length,
  );
  readonly rifiutati = computed(() => this.miei().filter((e) => e.stato === 'RIFIUTATO').length);
  /** Eventi ancora da inviare registrati da un altro utente di questo telefono. */
  readonly diAltriUtenti = computed(() => {
    const io = this.sessione.utenteId();
    return this._tutti().filter(
      (e) => e.utenteId !== io && (e.stato === 'DA_INVIARE' || haFotoDaInviare(e)),
    ).length;
  });
  /** `true` se almeno un evento esiste solo in memoria (il telefono non puo' scrivere l'archivio). */
  readonly nonSalvato = this._nonSalvato.asReadonly();
  readonly inInvio = this._inInvio.asReadonly();
  /** Messaggio del 403 che ha fermato i tentativi automatici (es. autista non collegato), o null. */
  readonly bloccata = this._bloccata.asReadonly();

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
        if (this.daInviare() > 0 || this.fotoDaInviare() > 0) void this.inviaAuto();
      }, INTERVALLO_MS);
    }
    this._bloccata.set(null); // nuovo avvio/accesso: un tentativo si fa
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
    const { foto, ...resto } = nuovo;
    const evento: EventoInCoda = {
      ...resto,
      foto: (foto ?? []).map((f) => ({
        id: crypto.randomUUID(),
        mimeType: f.mimeType,
        dimensioneByte: f.dimensioneByte,
        sha256: f.sha256,
        stato: 'DA_INVIARE' as const,
        tentativi: 0,
        errore: null,
        contenuto: f.contenuto,
      })),
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
    void this.inviaAuto();
    return evento;
  }

  /** Tentativo automatico (rete, ripresa, intervallo): si ferma se il server ha risposto 403. */
  private inviaAuto(): Promise<void> {
    return this._bloccata() ? Promise.resolve() : this.invia();
  }

  /** Invio voluto dall'autista («Invia ora») o all'avvio: riprova anche dopo un 403. */
  invia(): Promise<void> {
    this._bloccata.set(null);
    return this.avviaCiclo();
  }

  /** Spedisce, in ordine, gli eventi dell'utente collegato. Un solo ciclo alla volta. */
  private avviaCiclo(): Promise<void> {
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
        if (prossimo) {
          if (!(await this.spedisci(prossimo))) return;
          continue;
        }
        // Prima tutti gli esiti, poi le foto: una foto ha senso solo se l'evento e' sul server.
        const conFoto = this.miei().find((e) => e.stato === 'CONFERMATO' && haFotoDaInviare(e));
        if (!conFoto) return;
        if (!(await this.spedisciFoto(conFoto))) return;
      }
    } finally {
      this._inInvio.set(false);
    }
  }

  /** Spedisce un evento. `true` se si puo' proseguire con il successivo, `false` se ci si ferma. */
  private async spedisci(e: EventoInCoda): Promise<boolean> {
    // Difesa in profondita': il token inviato e' quello corrente, l'evento deve essere suo.
    if (e.utenteId !== this.sessione.utenteId()) return false;
    try {
      const r = await firstValueFrom(
        this.http
          .post<RispostaEvento>('/api/v1/campo/eventi', {
            id: e.id,
            ritiroId: e.ritiroId,
            tipo: e.tipo,
            versioneVista: e.versioneVista,
            dataVista: e.dataVista,
            sedeVista: e.sedeVista,
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
      if (stato === 403) {
        // Permanente finche' l'ufficio non interviene: niente martellamento ogni 20 s.
        this._bloccata.set(messaggio ?? "Accesso non consentito: contatta l'ufficio.");
      }
      // Rete assente, timeout, 401 (sessione finita), 403, 429, 5xx: l'evento resta, si riprova.
      await this.scrivi({ ...e, tentativi: e.tentativi + 1, errore: messaggio });
      return false;
    }
  }

  /** Spedisce la prossima foto di un evento CONFERMATO. `true` se si puo' proseguire. */
  private async spedisciFoto(e: EventoInCoda): Promise<boolean> {
    if (e.utenteId !== this.sessione.utenteId()) return false;
    const foto = fotoDi(e).find((f) => f.stato === 'DA_INVIARE');
    if (!foto) return true;
    const aggiorna = (nuova: FotoInCoda) =>
      this.scrivi({ ...e, foto: fotoDi(e).map((f) => (f.id === nuova.id ? nuova : f)) });
    if (!foto.contenuto) {
      // Byte persi (non dovrebbe succedere): inutile ritentare.
      await aggiorna({ ...foto, stato: 'RIFIUTATA', errore: 'La foto non è più sul telefono.' });
      return true;
    }
    const corpo = new FormData();
    corpo.append('id', foto.id);
    corpo.append('sha256', foto.sha256);
    corpo.append('foto', new Blob([foto.contenuto], { type: foto.mimeType }), 'foto.jpg');
    try {
      await firstValueFrom(
        this.http.post(`/api/v1/campo/eventi/${e.id}/foto`, corpo).pipe(timeout(TIMEOUT_FOTO_MS)),
      );
      await aggiorna({ ...foto, stato: 'INVIATA', errore: null, contenuto: null });
      return true;
    } catch (err) {
      const stato = err instanceof HttpErrorResponse ? err.status : 0;
      const messaggio =
        err instanceof HttpErrorResponse ? messaggioServer(err) : 'Il server non risponde.';
      const marcatore = (err as { error?: { error?: unknown } } | null)?.error?.error;
      const hashDaRitentare =
        stato === 422 &&
        marcatore === 'FOTO_HASH_NON_CORRISPONDENTE' &&
        foto.tentativi + 1 < TENTATIVI_HASH;
      if (!hashDaRitentare && [400, 404, 409, 413, 415, 422].includes(stato)) {
        await aggiorna({
          ...foto,
          stato: 'RIFIUTATA',
          tentativi: foto.tentativi + 1,
          errore: messaggio ?? 'Il server non ha accettato questa foto.',
          contenuto: null,
        });
        return true;
      }
      if (stato === 403) {
        this._bloccata.set(messaggio ?? "Accesso non consentito: contatta l'ufficio.");
      }
      await aggiorna({ ...foto, tentativi: foto.tentativi + 1, errore: messaggio });
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
        (e) =>
          e.stato === 'CONFERMATO' &&
          !haFotoDaInviare(e) &&
          dataLocale(new Date(e.rilevatoIl)) !== oggi,
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
    // Le foto non ancora arrivate restano (sono l'unica copia): le togliera' il loro invio.
    const ids = this._tutti()
      .filter((e) => e.stato === 'CONFERMATO' && !haFotoDaInviare(e))
      .map((e) => e.id);
    if (ids.length > 0) await this.togli(ids);
    try {
      const salvati = await this.archivio.tutti();
      await this.togli(
        salvati.filter((e) => e.stato === 'CONFERMATO' && !haFotoDaInviare(e)).map((e) => e.id),
      );
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

export function messaggioServer(e: HttpErrorResponse): string | null {
  const m = (e.error as { message?: unknown } | null)?.message;
  if (typeof m === 'string' && m && e.status < 500) return m;
  if (Array.isArray(m) && m.length > 0 && e.status < 500) return String(m[0]);
  if (e.status === 0) return 'Nessuna connessione.';
  return null;
}
