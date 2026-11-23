import { HttpClient } from '@angular/common/http';
import {
  AfterViewInit,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, of, timeout } from 'rxjs';
import { CodaRicevute } from '../core/coda-ricevute';
import { FirmaPng, disegna } from '../core/firma-png';
import { GiroService, dataLocaleIso } from '../core/giro.service';
import type { RitiroVista } from '../core/modelli';
import { StatoCoda } from '../core/stato-coda';
import { StatoGiro } from '../core/stato-giro';
import { ALTEZZA_TELA, LARGHEZZA_TELA, TrattoFirma } from '../core/tratto-firma';

/** Limite del PNG accettato dal server (128 KiB), in base64 sono ~4/3. */
const LIMITE_BASE64 = Math.ceil((131_072 * 4) / 3);

/**
 * Ricevuta di ritiro: il cliente firma con il dito sullo schermo dell'autista.
 *
 * Testo onesto sul valore: e' una firma elettronica SEMPLICE (immagine del tratto, nome, ora), una
 * prova commerciale. Non e' una firma qualificata e la ricevuta non sostituisce il FIR. Il PDF lo
 * genera il server dai dati del ritiro; qui non si mostra nulla di piu' di quanto l'autista ha gia'.
 */
@Component({
  selector: 'app-ricevuta',
  imports: [RouterLink, StatoGiro, StatoCoda],
  template: `
    <header class="testata">
      <a [routerLink]="['/ritiro', id()]" class="indietro" data-testid="indietro">‹ Ritiro</a>
    </header>
    <main class="pagina">
      <app-stato-giro />
      <app-stato-coda />
      @if (ritiro(); as r) {
        <h1>Ricevuta di ritiro</h1>
        <p class="sotto" data-testid="riepilogo">
          {{ r.produttore.nome }} · {{ r.cerCode }} · {{ r.descrizione }} · quantità presunta
          {{ r.quantitaPresunta }} {{ r.unita }}
        </p>
        <p class="avviso-valore" data-testid="avviso-valore">
          <strong>Non sostituisce il FIR.</strong> Questa è una firma elettronica semplice: il
          cliente firma con il dito, l'app salva l'immagine del tratto con il nome e l'ora, e il
          sistema genera un PDF con la sua impronta. Non è una firma qualificata. Serve come prova
          del ritiro in caso di contestazioni.
        </p>

        @if (salvata(); as s) {
          <section class="esito" data-testid="ricevuta-salvata" role="status">
            <h2>Ricevuta registrata</h2>
            <p data-testid="stato-ricevuta">
              @if (s.stato === 'DA_INVIARE') {
                Salvata sul telefono, in attesa di invio all'ufficio.
              } @else if (s.stato === 'CONFERMATO') {
                Inviata all'ufficio e archiviata.
                @if (s.esitoServer === 'DA_RICONCILIARE') {
                  Il ritiro era cambiato in ufficio: la ricevuta è stata conservata e l'ufficio la
                  verificherà.
                }
                @switch (s.invio) {
                  @case ('INVIATO') {
                    Copia spedita al cliente.
                  }
                  @case ('FALLITO') {
                    La copia al cliente non è partita: l'ufficio può rispedirla.
                  }
                  @case ('NON_ABILITATO') {
                    L'invio al cliente non è attivo.
                  }
                }
              } @else {
                Non accettata dal server: {{ s.errore }}
              }
            </p>
            @if (s.contenutoSha256) {
              <p class="sotto" data-testid="impronta">
                Impronta del contenuto firmato: {{ s.contenutoSha256.slice(0, 16) }}…
              </p>
            }
            <div class="azioni">
              <a [routerLink]="['/ritiro', id()]" class="bottone">Torna al ritiro</a>
              <button type="button" class="secondario" (click)="nuova()" data-testid="nuova">
                Un'altra ricevuta
              </button>
            </div>
          </section>
        } @else {
          <section class="esito" aria-labelledby="titolo-firma">
            <h2 id="titolo-firma">Firma di chi consegna il rifiuto</h2>
            <label for="nome-firmatario">Nome e cognome di chi firma</label>
            <input
              id="nome-firmatario"
              type="text"
              class="campo"
              autocomplete="off"
              maxlength="120"
              [value]="nome()"
              (input)="nome.set($any($event.target).value)"
              data-testid="nome-firmatario"
            />
            <p class="sotto">Firma qui sotto con il dito.</p>
            <canvas
              #tela
              class="tela-firma"
              [attr.width]="larghezza"
              [attr.height]="altezza"
              (pointerdown)="inizia($event)"
              (pointermove)="muovi($event)"
              (pointerup)="fine($event)"
              (pointercancel)="fine($event)"
              (pointerleave)="fine($event)"
              aria-label="Area di firma"
              data-testid="tela-firma"
            ></canvas>
            <div class="azioni">
              <button type="button" class="link" (click)="cancella()" data-testid="cancella-firma">
                Cancella la firma
              </button>
            </div>
            @if (invioEmail()) {
              <label for="email-cliente">Email del cliente (facoltativa)</label>
              <input
                id="email-cliente"
                type="email"
                class="campo"
                autocomplete="off"
                maxlength="254"
                [value]="email()"
                (input)="email.set($any($event.target).value)"
                data-testid="email-cliente"
              />
              <p class="sotto">
                Se la compili, il sistema spedisce al cliente una copia del PDF. L'indirizzo non
                viene conservato.
              </p>
            }
            @if (errore(); as m) {
              <p class="errore" role="alert" data-testid="errore-firma">{{ m }}</p>
            }
            <div class="azioni">
              <button
                type="button"
                class="bottone"
                (click)="conferma(r)"
                [disabled]="invio()"
                data-testid="conferma-firma"
              >
                Conferma e salva la ricevuta
              </button>
            </div>
          </section>
        }
      } @else if (caricamento()) {
        <p class="stato" role="status">Caricamento…</p>
      } @else {
        <p class="errore" role="alert" data-testid="non-trovato">
          Ritiro non trovato nel giro di oggi.
        </p>
      }
    </main>
  `,
})
export class RicevutaPagina implements OnInit, AfterViewInit {
  readonly id = input.required<string>();
  private readonly giro = inject(GiroService);
  private readonly coda = inject(CodaRicevute);
  private readonly png = inject(FirmaPng);
  private readonly http = inject(HttpClient);
  private readonly tela = viewChild<ElementRef<HTMLCanvasElement>>('tela');
  protected readonly larghezza = LARGHEZZA_TELA;
  protected readonly altezza = ALTEZZA_TELA;
  protected readonly caricamento = signal(false);
  protected readonly nome = signal('');
  protected readonly email = signal('');
  protected readonly errore = signal<string | null>(null);
  protected readonly invio = signal(false);
  protected readonly invioEmail = signal(false);
  private readonly appenaRegistrata = signal<string | null>(null);
  private readonly tratto = new TrattoFirma();
  private penna = false;

  /** La ricevuta appena registrata in questa schermata, con il suo stato che evolve. */
  protected readonly salvata = computed(() => {
    const id = this.appenaRegistrata();
    return id === null ? null : (this.coda.mie().find((r) => r.id === id) ?? null);
  });

  protected ritiro(): RitiroVista | undefined {
    return this.giro.ritiro(this.id());
  }

  ngOnInit(): void {
    if (!this.giro.corrente()) {
      this.caricamento.set(true);
      this.giro.carica(dataLocaleIso()).subscribe({
        next: () => this.caricamento.set(false),
        error: () => this.caricamento.set(false),
      });
    }
    // L'invio al cliente e' spento per default: offline o in errore il campo email non compare.
    this.http
      .get<{ invioEmail?: boolean }>('/api/v1/campo/ricevute/configurazione')
      .pipe(
        timeout(8000),
        catchError(() => of({ invioEmail: false })),
      )
      .subscribe((c) => this.invioEmail.set(c.invioEmail === true));
  }

  ngAfterViewInit(): void {
    this.ridisegna();
  }

  // --- tela ---------------------------------------------------------------------------------

  private punto(e: PointerEvent) {
    const el = this.tela()?.nativeElement;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return {
      x: ((e.clientX - r.left) * LARGHEZZA_TELA) / r.width,
      y: ((e.clientY - r.top) * ALTEZZA_TELA) / r.height,
    };
  }

  protected inizia(e: PointerEvent): void {
    const p = this.punto(e);
    if (!p) return;
    e.preventDefault();
    try {
      this.tela()?.nativeElement.setPointerCapture(e.pointerId);
    } catch {
      /* puntatore gia' rilasciato */
    }
    this.penna = true;
    this.tratto.inizia(p);
    this.errore.set(null);
    this.ridisegna();
  }

  protected muovi(e: PointerEvent): void {
    if (!this.penna) return;
    const p = this.punto(e);
    if (!p) return;
    e.preventDefault();
    this.tratto.aggiungi(p);
    this.ridisegna();
  }

  protected fine(e: PointerEvent): void {
    if (!this.penna) return;
    e.preventDefault();
    this.penna = false;
    this.tratto.termina();
    this.ridisegna();
  }

  protected cancella(): void {
    this.tratto.pulisci();
    this.penna = false;
    this.ridisegna();
  }

  private ridisegna(): void {
    const ctx = this.tela()?.nativeElement.getContext?.('2d');
    if (ctx) disegna(ctx, this.tratto, false);
  }

  // --- conferma -----------------------------------------------------------------------------

  protected async conferma(r: RitiroVista): Promise<void> {
    if (this.invio()) return;
    const nome = this.nome().replace(/\s+/g, ' ').trim();
    if (nome.length < 2 || !/\p{L}/u.test(nome)) {
      this.errore.set('Scrivi il nome e cognome di chi firma.');
      return;
    }
    if (!this.tratto.sufficiente()) {
      this.errore.set('La firma manca o è troppo breve: firma sullo schermo con il dito.');
      return;
    }
    const email = this.invioEmail() ? this.email().trim() : '';
    if (email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      this.errore.set("L'indirizzo email non sembra valido.");
      return;
    }
    const firma = this.png.esporta(this.tratto);
    if (firma === null || firma.length > LIMITE_BASE64) {
      this.errore.set('Questo telefono non riesce a salvare la firma. Riprova.');
      return;
    }
    this.invio.set(true);
    try {
      const reg = await this.coda.registra({
        ritiroId: r.id,
        firmatarioNome: nome,
        firmaPng: firma,
        emailCliente: email === '' ? null : email,
      });
      this.appenaRegistrata.set(reg.id);
      this.errore.set(null);
    } catch {
      this.errore.set('Non riesco a registrare la ricevuta: riprova.');
    } finally {
      this.invio.set(false);
    }
  }

  protected nuova(): void {
    this.appenaRegistrata.set(null);
    this.tratto.pulisci();
    this.nome.set('');
    this.email.set('');
    this.errore.set(null);
    // La tela torna nel DOM al prossimo ciclo di rendering.
    queueMicrotask(() => setTimeout(() => this.ridisegna(), 0));
  }
}
