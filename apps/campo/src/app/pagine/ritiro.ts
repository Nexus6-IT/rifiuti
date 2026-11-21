import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GiroService, dataLocaleIso } from '../core/giro.service';
import type { RitiroVista } from '../core/modelli';
import { CodaEventi, type TipoEventoCampo } from '../core/coda-eventi';
import { CodaRicevute } from '../core/coda-ricevute';
import { StatoCoda, spiegaConflitto } from '../core/stato-coda';
import { StatoGiro } from '../core/stato-giro';

/** Dettaglio di un ritiro del giro (`id` dal percorso, `withComponentInputBinding`). */
@Component({
  selector: 'app-ritiro',
  imports: [RouterLink, StatoGiro, StatoCoda],
  template: `
    <header class="testata">
      <a routerLink="/" class="indietro" data-testid="indietro">‹ Giro</a>
    </header>
    <main class="pagina">
      <app-stato-giro />
      <app-stato-coda />
      @if (ritiro(); as r) {
        <h1>{{ r.produttore.nome }}</h1>
        <dl class="dettaglio" data-testid="dettaglio">
          <dt>Indirizzo</dt>
          <dd>{{ r.produttore.indirizzo }}</dd>
          <dt>Fascia</dt>
          <dd>{{ r.fascia ?? 'Orario libero' }}</dd>
          <dt>Rifiuto</dt>
          <dd>{{ r.cerCode }} · {{ r.descrizione }}</dd>
          <dt>Quantità presunta</dt>
          <dd>{{ r.quantitaPresunta }} {{ r.unita }}</dd>
          <dt>Destinatario</dt>
          <dd>{{ r.destinatario.nome }}</dd>
          @if (r.automezzo) {
            <dt>Automezzo</dt>
            <dd>{{ r.automezzo.targa }}</dd>
          }
          @if (r.fir) {
            <dt>FIR</dt>
            <dd>{{ r.fir.numero ?? 'bozza' }} ({{ r.fir.status }})</dd>
          }
          @if (r.annotazioni) {
            <dt>Note</dt>
            <dd>{{ r.annotazioni }}</dd>
          }
        </dl>
        <section class="esito" aria-labelledby="titolo-esito" data-testid="esito">
          <h2 id="titolo-esito">Esito del ritiro</h2>
          @if (data(); as e) {
            <p data-testid="esito-stato" [class.errore]="e.stato === 'DA_INVIARE' && !!e.errore">
              {{ e.tipo === 'RITIRO_ESEGUITO' ? 'Ritiro eseguito' : 'Ritiro non eseguito' }}:
              @switch (e.stato) {
                @case ('DA_INVIARE') {
                  salvato sul telefono, in attesa di invio.
                }
                @case ('CONFERMATO') {
                  @if (e.esito === 'DA_RICONCILIARE') {
                    inviato. L'ufficio deve verificarlo: {{ spiega(e.motivoConflitto) }}.
                  } @else {
                    inviato all'ufficio.
                  }
                }
              }
            </p>
            @if (e.stato === 'DA_INVIARE' && e.errore) {
              <p class="sotto" data-testid="esito-errore">{{ e.errore }}</p>
            }
          } @else if (r.stato !== 'PROGRAMMATO') {
            <p class="sotto">Questo ritiro non è più da fare.</p>
          } @else {
            @if (rifiutato(); as x) {
              <p class="errore" role="alert" data-testid="esito-rifiutato">
                Il server non ha accettato il tuo ultimo esito: {{ x.errore }}
                <button type="button" class="link" (click)="scartaRifiutato(x.id)">Scarta</button>
              </p>
            }
            @if (modo() === null) {
              <div class="azioni">
                <button
                  type="button"
                  class="bottone"
                  (click)="scegli('RITIRO_ESEGUITO')"
                  data-testid="eseguito"
                >
                  Ritiro eseguito
                </button>
                <button
                  type="button"
                  class="secondario"
                  (click)="scegli('RITIRO_NON_ESEGUITO')"
                  data-testid="non-eseguito"
                >
                  Non eseguito
                </button>
              </div>
            } @else {
              <label for="testo-esito">
                {{
                  modo() === 'RITIRO_NON_ESEGUITO' ? 'Motivo (obbligatorio)' : 'Nota (facoltativa)'
                }}
              </label>
              <textarea
                id="testo-esito"
                rows="3"
                maxlength="500"
                [value]="testo()"
                (input)="testo.set($any($event.target).value)"
                data-testid="testo-esito"
              ></textarea>
              @if (errore(); as m) {
                <p class="errore" role="alert" data-testid="esito-errore-form">{{ m }}</p>
              }
              <div class="azioni">
                <button
                  type="button"
                  class="bottone"
                  (click)="conferma(r)"
                  [disabled]="invio()"
                  data-testid="conferma-esito"
                >
                  Conferma
                </button>
                <button type="button" class="secondario" (click)="annulla()">Indietro</button>
              </div>
            }
          }
        </section>
        @if (r.stato === 'PROGRAMMATO' && data()?.tipo !== 'RITIRO_NON_ESEGUITO') {
          <section class="esito" aria-labelledby="titolo-ricevuta" data-testid="ricevuta">
            <h2 id="titolo-ricevuta">Ricevuta di ritiro</h2>
            <p class="sotto">
              Il cliente firma sullo schermo. Non sostituisce il FIR e non è una firma qualificata.
            </p>
            @for (v of ricevute(); track v.id) {
              <p data-testid="ricevuta-stato" [class.errore]="v.stato === 'RIFIUTATO'">
                Ricevuta firmata da {{ v.firmatarioNome }}:
                @switch (v.stato) {
                  @case ('DA_INVIARE') {
                    salvata sul telefono, in attesa di invio.
                  }
                  @case ('CONFERMATO') {
                    inviata all'ufficio.
                  }
                  @case ('RIFIUTATO') {
                    non accettata dal server: {{ v.errore }}
                    <button type="button" class="link" (click)="scartaRicevuta(v.id)">
                      Scarta
                    </button>
                  }
                }
              </p>
            }
            <div class="azioni">
              <a
                [routerLink]="['/ritiro', r.id, 'ricevuta']"
                class="secondario"
                data-testid="apri-ricevuta"
              >
                {{ ricevute().length === 0 ? 'Fai firmare la ricevuta' : 'Un’altra ricevuta' }}
              </a>
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
export class RitiroPagina implements OnInit {
  readonly id = input.required<string>();
  private readonly giro = inject(GiroService);
  protected readonly caricamento = signal(false);
  private readonly coda = inject(CodaEventi);
  private readonly codaRicevute = inject(CodaRicevute);
  protected readonly modo = signal<TipoEventoCampo | null>(null);
  protected readonly testo = signal('');
  protected readonly errore = signal<string | null>(null);
  protected readonly invio = signal(false);
  protected readonly spiega = spiegaConflitto;
  /** L'esito dato a questo ritiro (anche in attesa di invio). */
  protected readonly data = computed(() => this.coda.perRitiro(this.id()));
  protected readonly rifiutato = computed(() => this.coda.rifiutatoPerRitiro(this.id()));
  /** Le ricevute firmate per questo ritiro (anche in attesa di invio). */
  protected readonly ricevute = computed(() => this.codaRicevute.perRitiro(this.id()));

  protected scegli(tipo: TipoEventoCampo): void {
    this.modo.set(tipo);
    this.testo.set('');
    this.errore.set(null);
  }

  protected annulla(): void {
    this.modo.set(null);
    this.errore.set(null);
  }

  protected scartaRicevuta(id: string): void {
    void this.codaRicevute.scarta(id);
  }

  protected scartaRifiutato(id: string): void {
    void this.coda.scarta(id);
  }

  protected async conferma(r: RitiroVista): Promise<void> {
    const tipo = this.modo();
    if (tipo === null || this.invio()) return;
    const testo = this.testo().trim();
    if (tipo === 'RITIRO_NON_ESEGUITO' && testo === '') {
      this.errore.set('Scrivi il motivo per cui il ritiro non è stato eseguito.');
      return;
    }
    if (testo.length > 500) {
      this.errore.set('Il testo è troppo lungo (massimo 500 caratteri).');
      return;
    }
    this.invio.set(true);
    try {
      await this.coda.registra({
        ritiroId: this.id(),
        tipo,
        versioneVista: r.versione,
        dataVista: r.dataPrevista,
        sedeVista: r.produttore.sedeId,
        dati:
          tipo === 'RITIRO_NON_ESEGUITO' ? { motivo: testo } : testo === '' ? {} : { nota: testo },
      });
      this.modo.set(null);
      this.errore.set(null);
    } catch {
      this.errore.set("Non riesco a registrare l'esito: riprova.");
    } finally {
      this.invio.set(false);
    }
  }

  protected ritiro(): RitiroVista | undefined {
    return this.giro.ritiro(this.id());
  }

  /** Apertura diretta del link (giro non ancora in memoria): lo si ricarica. */
  ngOnInit(): void {
    if (this.giro.corrente()) return;
    this.caricamento.set(true);
    this.giro.carica(dataLocaleIso()).subscribe({
      next: () => this.caricamento.set(false),
      error: () => this.caricamento.set(false),
    });
  }
}
