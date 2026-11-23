import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { ArchivioRicevute } from './archivio-ricevute';
import { messaggioServer } from './coda-eventi';
import { SessioneService } from './sessione.service';

export type StatoRicevutaCoda = 'DA_INVIARE' | 'CONFERMATO' | 'RIFIUTATO';
export type InvioRicevuta = 'NON_RICHIESTO' | 'NON_ABILITATO' | 'INVIATO' | 'FALLITO';

/** Cio' che l'autista dichiara: l'identita' (uuid, utente, ora) la aggiunge la coda. */
export interface NuovaRicevuta {
  ritiroId: string;
  /** Nome di chi firma. */
  firmatarioNome: string;
  /** Immagine del tratto: PNG in base64 (senza prefisso `data:`). */
  firmaPng: string;
  /** Solo se l'invio al cliente e' acceso e l'autista l'ha chiesto. */
  emailCliente: string | null;
}

/**
 * Una ricevuta nella coda di uscita. `firmaPng` ed `emailCliente` sono dati personali: la firma
 * resta sul telefono finche' la ricevuta non e' arrivata, ANCHE se il server la rifiuta (la firma di
 * un ritiro avvenuto non si perde: si toglie solo quando l'autista scarta a mano); l'email si
 * azzera a ricevuta arrivata o rifiutata.
 */
export interface RicevutaInCoda {
  id: string;
  utenteId: string;
  ritiroId: string;
  firmatarioNome: string;
  firmatoIl: string;
  firmaPng: string | null;
  emailCliente: string | null;
  stato: StatoRicevutaCoda;
  tentativi: number;
  errore: string | null;
  /** Dal server, a ricevuta archiviata. */
  ricevutoIl: string | null;
  pdfSha256: string | null;
  contenutoSha256: string | null;
  invio: InvioRicevuta | null;
  /** `DA_RICONCILIARE`: archiviata, ma il ritiro era cambiato mentre il telefono era offline. */
  esitoServer?: 'REGISTRATA' | 'DA_RICONCILIARE' | null;
}

interface RispostaRicevuta {
  id: string;
  ricevutoIl: string;
  pdfSha256: string;
  contenutoSha256: string;
  invio: InvioRicevuta;
  esito?: 'REGISTRATA' | 'DA_RICONCILIARE';
}

const INTERVALLO_MS = 20_000;
/** Il server genera il PDF e puo' spedire l'email: piu' largo del timeout degli esiti. */
const TIMEOUT_RICHIESTA_MS = 40_000;

/**
 * Coda di uscita delle ricevute di ritiro firmate. Stesse regole della coda degli esiti:
 * scrittura sul telefono PRIMA dell'invio, uuid identico a ogni reinvio (il server non duplica),
 * un invio alla volta in ordine, rifiuto definitivo (400/404/409/413/422) = RIFIUTATA e visibile (la firma resta sul telefono),
 * 403 ferma i tentativi automatici, coda PER UTENTE.
 *
 * La ricevuta e' una firma elettronica SEMPLICE e non sostituisce il FIR: lo dice l'interfaccia e
 * il PDF che genera il server.
 */
@Injectable({ providedIn: 'root' })
export class CodaRicevute {
  private readonly http = inject(HttpClient);
  private readonly archivio = inject(ArchivioRicevute);
  private readonly sessione = inject(SessioneService);
  private readonly _tutte = signal<RicevutaInCoda[]>([]);
  private readonly _nonSalvata = signal(false);
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

  /** Ricevute dell'utente collegato, dalla piu' vecchia. */
  readonly mie = computed(() => {
    const io = this.sessione.utenteId();
    return io === null ? [] : this._tutte().filter((r) => r.utenteId === io);
  });
  readonly daInviare = computed(() => this.mie().filter((r) => r.stato === 'DA_INVIARE').length);
  readonly rifiutate = computed(() => this.mie().filter((r) => r.stato === 'RIFIUTATO').length);
  readonly diAltriUtenti = computed(() => {
    const io = this.sessione.utenteId();
    return this._tutte().filter((r) => r.utenteId !== io && r.stato === 'DA_INVIARE').length;
  });
  readonly nonSalvata = this._nonSalvata.asReadonly();
  readonly inInvio = this._inInvio.asReadonly();
  readonly bloccata = this._bloccata.asReadonly();

  constructor() {
    // Fine sessione / nuovo accesso: via i promemoria confermati; restano da inviare e rifiutate.
    this.sessione.allaChiusura(() => void this.pulisciConfermate());
  }

  async avvia(): Promise<void> {
    await this.carica();
    if (!this.avviata && typeof window !== 'undefined') {
      this.avviata = true;
      window.addEventListener('online', this.alRitornoRete);
      document.addEventListener('visibilitychange', this.allaRipresa);
      this.timer = setInterval(() => {
        if (this.daInviare() > 0) void this.inviaAuto();
      }, INTERVALLO_MS);
    }
    this._bloccata.set(null);
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

  /** Le ricevute dell'utente collegato per un ritiro (anche in attesa di invio), dalla piu' vecchia. */
  perRitiro(ritiroId: string): RicevutaInCoda[] {
    return this.mie().filter((r) => r.ritiroId === ritiroId);
  }

  /** Scrive la ricevuta sul telefono, poi tenta l'invio senza aspettarlo. */
  registra(nuova: NuovaRicevuta): Promise<RicevutaInCoda> {
    const lavoro = this.catena.then(() => this.registraSerializzata(nuova));
    this.catena = lavoro.catch(() => undefined);
    return lavoro;
  }

  private async registraSerializzata(nuova: NuovaRicevuta): Promise<RicevutaInCoda> {
    const utenteId = this.sessione.utenteId();
    if (!utenteId) throw new Error('Nessuna sessione: accedi per registrare una ricevuta.');
    const ricevuta: RicevutaInCoda = {
      id: crypto.randomUUID(),
      utenteId,
      ritiroId: nuova.ritiroId,
      firmatarioNome: nuova.firmatarioNome,
      firmatoIl: new Date().toISOString(),
      firmaPng: nuova.firmaPng,
      emailCliente: nuova.emailCliente,
      stato: 'DA_INVIARE',
      tentativi: 0,
      errore: null,
      ricevutoIl: null,
      pdfSha256: null,
      contenutoSha256: null,
      invio: null,
    };
    await this.scrivi(ricevuta);
    void this.inviaAuto();
    return ricevuta;
  }

  private inviaAuto(): Promise<void> {
    return this._bloccata() ? Promise.resolve() : this.invia();
  }

  /** Invio voluto dall'autista («Invia ora») o all'avvio: riprova anche dopo un 403. */
  invia(): Promise<void> {
    this._bloccata.set(null);
    this.cicloInCorso ??= this.ciclo().finally(() => (this.cicloInCorso = null));
    return this.cicloInCorso;
  }

  /** Toglie dalla coda una ricevuta dell'utente (rifiutata, o da inviare se l'autista cambia idea). */
  async scarta(id: string): Promise<void> {
    const io = this.sessione.utenteId();
    const r = this._tutte().find((x) => x.id === id);
    if (!r || r.utenteId !== io) return;
    await this.togli([id]);
  }

  async scartaDiAltriUtenti(): Promise<void> {
    const io = this.sessione.utenteId();
    await this.togli(
      this._tutte()
        .filter((r) => r.utenteId !== io)
        .map((r) => r.id),
    );
  }

  private async ciclo(): Promise<void> {
    this._inInvio.set(true);
    try {
      for (;;) {
        const prossima = this.mie().find((r) => r.stato === 'DA_INVIARE');
        if (!prossima) return;
        if (!(await this.spedisci(prossima))) return;
      }
    } finally {
      this._inInvio.set(false);
    }
  }

  /** `true` se si puo' proseguire con la successiva, `false` se ci si ferma. */
  private async spedisci(r: RicevutaInCoda): Promise<boolean> {
    if (r.utenteId !== this.sessione.utenteId() || r.firmaPng === null) return false;
    try {
      const risp = await firstValueFrom(
        this.http
          .post<RispostaRicevuta>('/api/v1/campo/ricevute', {
            id: r.id,
            ritiroId: r.ritiroId,
            firmatarioNome: r.firmatarioNome,
            firmatoIl: r.firmatoIl,
            firmaPng: r.firmaPng,
            ...(r.emailCliente ? { emailCliente: r.emailCliente } : {}),
          })
          .pipe(timeout(TIMEOUT_RICHIESTA_MS)),
      );
      // Arrivata: la firma e l'indirizzo email non servono piu' sul telefono.
      await this.scrivi({
        ...r,
        stato: 'CONFERMATO',
        firmaPng: null,
        emailCliente: null,
        errore: null,
        ricevutoIl: risp.ricevutoIl,
        pdfSha256: risp.pdfSha256,
        contenutoSha256: risp.contenutoSha256,
        invio: risp.invio,
        esitoServer: risp.esito ?? 'REGISTRATA',
      });
      return true;
    } catch (err) {
      const stato = err instanceof HttpErrorResponse ? err.status : 0;
      const messaggio =
        err instanceof HttpErrorResponse ? messaggioServer(err) : 'Il server non risponde.';
      if (stato === 400 || stato === 404 || stato === 409 || stato === 413 || stato === 422) {
        await this.scrivi({
          ...r,
          stato: 'RIFIUTATO',
          // La firma resta: si libera solo quando l'autista scarta a mano (o rifa la ricevuta).
          emailCliente: null,
          errore: messaggio ?? 'Il server non ha accettato questa ricevuta.',
        });
        return true;
      }
      if (stato === 403) {
        this._bloccata.set(messaggio ?? "Accesso non consentito: contatta l'ufficio.");
      }
      // Rete assente, timeout, 401, 403, 429, 5xx: la ricevuta resta, si riprova.
      await this.scrivi({ ...r, tentativi: r.tentativi + 1, errore: messaggio });
      return false;
    }
  }

  private async carica(): Promise<void> {
    try {
      const salvate = await this.archivio.tutte();
      const inMemoria = this._tutte().filter((m) => !salvate.some((s) => s.id === m.id));
      this._tutte.set([...salvate, ...inMemoria].sort(perData));
      const oggi = dataLocale(new Date());
      const vecchie = this._tutte().filter(
        (r) => r.stato === 'CONFERMATO' && dataLocale(new Date(r.firmatoIl)) !== oggi,
      );
      if (vecchie.length > 0) await this.togli(vecchie.map((r) => r.id));
    } catch {
      /* archivio non leggibile: resta quanto c'e' in memoria */
    }
  }

  private async scrivi(r: RicevutaInCoda): Promise<void> {
    this._tutte.update((l) => [...l.filter((x) => x.id !== r.id), r].sort(perData));
    try {
      await this.archivio.salva(r);
    } catch {
      this._nonSalvata.set(true);
    }
  }

  private async togli(ids: string[]): Promise<void> {
    this._tutte.update((l) => l.filter((x) => !ids.includes(x.id)));
    for (const id of ids) {
      try {
        await this.archivio.rimuovi(id);
      } catch {
        /* resta nell'archivio: al prossimo avvio riappare e si puo' scartare di nuovo */
      }
    }
  }

  private async pulisciConfermate(): Promise<void> {
    const ids = this._tutte()
      .filter((r) => r.stato === 'CONFERMATO')
      .map((r) => r.id);
    if (ids.length > 0) await this.togli(ids);
    try {
      const salvate = await this.archivio.tutte();
      await this.togli(salvate.filter((r) => r.stato === 'CONFERMATO').map((r) => r.id));
    } catch {
      /* archivio non disponibile */
    }
  }
}

function dataLocale(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const perData = (a: RicevutaInCoda, b: RicevutaInCoda) =>
  a.firmatoIl < b.firmatoIl ? -1 : a.firmatoIl > b.firmatoIl ? 1 : a.id < b.id ? -1 : 1;
