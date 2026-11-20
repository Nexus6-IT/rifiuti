import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, from, tap, throwError } from 'rxjs';
import { ArchivioGiro } from './archivio-giro';
import type { GiroVista, RitiroVista } from './modelli';
import { SessioneService } from './sessione.service';

/** Data locale 'AAAA-MM-GG' (il giro e' del giorno di calendario dell'autista, non UTC). */
export function dataLocaleIso(d: Date = new Date()): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const gg = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${gg}`;
}

/**
 * Server non raggiungibile: nessuna rete (status 0) oppure 502/503/504. Con il service worker
 * attivo una richiesta caduta per mancanza di rete arriva alla pagina come 504 sintetico
 * («Gateway Timeout» generato da ngsw), non come status 0.
 */
export function nonRaggiungibile(e: HttpErrorResponse): boolean {
  return e.status === 0 || (e.status >= 502 && e.status <= 504);
}

/**
 * Proiezione per lo snapshot: SOLO i campi che l'app mostra. Un campo personale aggiunto in futuro
 * al backend non deve finire sul telefono senza una scelta esplicita qui.
 */
export function proiettaPerSnapshot(g: GiroVista): GiroVista {
  const r = (x: RitiroVista): RitiroVista => ({
    id: x.id,
    dataPrevista: x.dataPrevista,
    fascia: x.fascia,
    ordineGiro: x.ordineGiro,
    produttore: {
      id: x.produttore.id,
      nome: x.produttore.nome,
      sedeId: x.produttore.sedeId,
      indirizzo: x.produttore.indirizzo,
    },
    trasportatore: { id: x.trasportatore.id, nome: x.trasportatore.nome },
    destinatario: {
      id: x.destinatario.id,
      nome: x.destinatario.nome,
      sedeId: x.destinatario.sedeId,
    },
    automezzo: x.automezzo ? { id: x.automezzo.id, targa: x.automezzo.targa } : null,
    autista: x.autista ? { id: x.autista.id, nome: x.autista.nome } : null,
    cerCode: x.cerCode,
    descrizione: x.descrizione,
    quantitaPresunta: x.quantitaPresunta,
    unita: x.unita,
    stato: x.stato,
    statoVisibile: x.statoVisibile,
    motivo: x.motivo,
    fir: x.fir ? { id: x.fir.id, numero: x.fir.numero, status: x.fir.status } : null,
    versione: x.versione,
    ...(x.annotazioni !== undefined ? { annotazioni: x.annotazioni } : {}),
  });
  return {
    data: g.data,
    autista: { id: g.autista.id, nome: g.autista.nome, cognome: g.autista.cognome },
    ritiri: g.ritiri.map(r),
  };
}

/**
 * Giro del giorno. In rete lo scarica e ne tiene una copia (snapshot) nell'archivio del telefono;
 * senza rete (o server irraggiungibile) ripiega sulla copia, ma solo se e' dello stesso utente e dello stesso
 * giorno. La copia viene cancellata a fine giornata, al logout e al cambio utente. Il service
 * worker non vede mai i dati: stanno solo qui.
 */
@Injectable({ providedIn: 'root' })
export class GiroService {
  private readonly http = inject(HttpClient);
  private readonly archivio = inject(ArchivioGiro);
  private readonly sessione = inject(SessioneService);
  private readonly _corrente = signal<GiroVista | null>(null);
  private readonly _aggiornatoIl = signal<string | null>(null);
  private readonly _daArchivio = signal(false);
  readonly corrente = this._corrente.asReadonly();
  /** Istante (ISO) dell'ultimo scaricamento riuscito dei dati mostrati. */
  readonly aggiornatoIl = this._aggiornatoIl.asReadonly();
  /** `true` se i dati mostrati vengono dalla copia sul telefono, non dalla rete. */
  readonly daArchivio = this._daArchivio.asReadonly();
  private readonly _generazione = signal(0);
  /** Cresce quando il giro in memoria e' stato scartato (cambio giorno): la pagina lo ricarica. */
  readonly generazione = this._generazione.asReadonly();
  private pulizia: Promise<void> = Promise.resolve();

  constructor() {
    // Fine sessione o cambio utente: la memoria non deve tenere il giro del precedente.
    this.sessione.allaChiusura(() => this.azzeraMemoria());
  }

  carica(data: string): Observable<GiroVista> {
    return this.http
      .get<GiroVista>('/api/v1/campo/giro', { params: new HttpParams().set('data', data) })
      .pipe(
        tap((g) => {
          const adesso = new Date().toISOString();
          this.impostaFresco(g, adesso);
          const utenteId = this.sessione.utenteId();
          if (utenteId) {
            // Dopo l'eventuale pulizia di avvio (che altrimenti potrebbe cancellare questo snapshot).
            // Un errore di proiezione o di scrittura non deve rompere la visualizzazione del giro.
            void this.pulizia
              .then(() =>
                this.archivio.salva({
                  utenteId,
                  data,
                  aggiornatoIl: adesso,
                  giro: proiettaPerSnapshot(g),
                }),
              )
              .catch(() => undefined);
          }
        }),
        catchError((e: unknown) =>
          e instanceof HttpErrorResponse && nonRaggiungibile(e)
            ? from(this.ripristina(data, e))
            : throwError(() => e),
        ),
      );
  }

  impostaFresco(giro: GiroVista, aggiornatoIl: string): void {
    this._corrente.set(giro);
    this._aggiornatoIl.set(aggiornatoIl);
    this._daArchivio.set(false);
  }

  impostaDaArchivio(giro: GiroVista, aggiornatoIl: string): void {
    this._corrente.set(giro);
    this._aggiornatoIl.set(aggiornatoIl);
    this._daArchivio.set(true);
  }

  ritiro(id: string): RitiroVista | undefined {
    return this._corrente()?.ritiri.find((r) => r.id === id);
  }

  /** Logout: svuota memoria e copia sul telefono. */
  svuota(): void {
    this.azzeraMemoria();
    void this.archivio.cancella().catch(() => undefined);
  }

  /** All'avvio: cancella la copia di ieri o di un altro utente (telefoni condivisi). */
  pulisciObsoleto(oggi: string): Promise<void> {
    this.pulizia = this.pulisciObsoletoInterno(oggi);
    return this.pulizia;
  }

  /**
   * Ripresa dal background: se il giorno e' cambiato scarta giro in memoria e snapshot e chiede
   * il ricaricamento (`generazione`). Ritorna `true` se ha scartato qualcosa.
   */
  async controllaGiorno(oggi: string): Promise<boolean> {
    const vecchio = this._corrente() !== null && this._corrente()?.data !== oggi;
    await this.pulisciObsoleto(oggi);
    if (vecchio) {
      this.azzeraMemoria();
      this._generazione.update((n) => n + 1);
    }
    return vecchio;
  }

  private azzeraMemoria(): void {
    this._corrente.set(null);
    this._aggiornatoIl.set(null);
    this._daArchivio.set(false);
  }

  private async pulisciObsoletoInterno(oggi: string): Promise<void> {
    try {
      const s = await this.archivio.leggi();
      if (s && !this.valido(s.utenteId, s.data, oggi)) await this.archivio.cancella();
    } catch {
      /* archivio non disponibile */
    }
  }

  private async ripristina(data: string, erroreRete: HttpErrorResponse): Promise<GiroVista> {
    try {
      const s = await this.archivio.leggi();
      if (s) {
        if (this.valido(s.utenteId, s.data, data)) {
          this.impostaDaArchivio(s.giro, s.aggiornatoIl);
          return s.giro;
        }
        await this.archivio.cancella();
      }
    } catch {
      /* archivio non disponibile: resta l'errore di rete */
    }
    // Senza copia (es. navigazione privata) ma col giro di oggi gia' in memoria: lo si tiene.
    const inMemoria = this._corrente();
    if (inMemoria && inMemoria.data === data) {
      this._daArchivio.set(true);
      return inMemoria;
    }
    throw erroreRete;
  }

  private valido(utenteId: string, dataSnapshot: string, oggi: string): boolean {
    const io = this.sessione.utenteId();
    return io !== null && io === utenteId && dataSnapshot === oggi;
  }
}
