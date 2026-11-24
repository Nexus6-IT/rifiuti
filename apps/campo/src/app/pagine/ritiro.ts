import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GiroService, dataLocaleIso } from '../core/giro.service';
import type { RitiroVista } from '../core/modelli';
import { CodaEventi, fotoDi, type DatiEvento, type TipoEventoCampo } from '../core/coda-eventi';
import { ElaboratoreFoto, MAX_FOTO_PER_ESITO, type FotoPronta } from '../core/foto';
import { RilevatorePosizione, type PosizioneRilevata } from '../core/posizione';
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
            @if (e.dati.posizione; as p) {
              <p class="sotto" data-testid="esito-posizione">
                Posizione allegata (± {{ p.accuratezza }} m).
              </p>
            }
            @if (fotoEsito().length > 0) {
              <p class="sotto" data-testid="esito-foto">
                {{ riepilogoFoto() }}
              </p>
              @for (f of fotoRifiutate(); track f.id) {
                <p class="errore" role="alert" data-testid="foto-rifiutata">
                  Una foto non è stata accettata: {{ f.errore }}
                </p>
              }
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
              <fieldset class="allegati" data-testid="allegati">
                <legend>Foto e posizione (facoltative)</legend>
                <p class="sotto" data-testid="informativa">
                  La posizione viene letta una sola volta, adesso, quando tocchi «Aggiungi la mia
                  posizione»: l'app non ti segue durante il giro. Foto e posizione sono visibili
                  all'ufficio insieme all'esito. Non fotografare le persone. Per l'informativa
                  completa chiedi all'ufficio.
                </p>
                <div class="azioni">
                  <button
                    type="button"
                    class="secondario"
                    (click)="scegliFoto.click()"
                    [disabled]="elaboro() || foto().length >= maxFoto"
                    data-testid="aggiungi-foto"
                  >
                    Aggiungi foto ({{ foto().length }}/{{ maxFoto }})
                  </button>
                  <input
                    #scegliFoto
                    type="file"
                    accept="image/*"
                    capture="environment"
                    hidden
                    (change)="aggiungiFoto($event)"
                    data-testid="file-foto"
                  />
                  <button
                    type="button"
                    class="secondario"
                    (click)="rilevaPosizione()"
                    [disabled]="rilevo()"
                    data-testid="aggiungi-posizione"
                  >
                    {{ posizione() ? 'Rileva di nuovo la posizione' : 'Aggiungi la mia posizione' }}
                  </button>
                </div>
                @if (elaboro()) {
                  <p class="sotto" role="status">Preparo la foto…</p>
                }
                @if (rilevo()) {
                  <p class="sotto" role="status">Cerco la posizione…</p>
                }
                @for (f of foto(); track $index) {
                  <p class="sotto" data-testid="foto-pronta">
                    Foto {{ $index + 1 }} ({{ kb(f) }} kB)
                    <button type="button" class="link" (click)="togliFoto($index)">Togli</button>
                  </p>
                }
                @if (posizione(); as p) {
                  <p class="sotto" data-testid="posizione-pronta">
                    Posizione rilevata (± {{ p.accuratezza }} m)
                    <button type="button" class="link" (click)="posizione.set(null)">Togli</button>
                  </p>
                }
                @if (erroreAllegati(); as m) {
                  <p class="errore" role="alert" data-testid="errore-allegati">{{ m }}</p>
                }
              </fieldset>
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
                <button
                  type="button"
                  class="secondario"
                  (click)="annulla()"
                  data-testid="indietro-esito"
                >
                  Indietro
                </button>
              </div>
            }
          }
        </section>
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
  protected readonly modo = signal<TipoEventoCampo | null>(null);
  protected readonly testo = signal('');
  protected readonly errore = signal<string | null>(null);
  protected readonly invio = signal(false);
  private readonly elaboratore = inject(ElaboratoreFoto);
  private readonly rilevatore = inject(RilevatorePosizione);
  protected readonly maxFoto = MAX_FOTO_PER_ESITO;
  protected readonly foto = signal<FotoPronta[]>([]);
  protected readonly posizione = signal<PosizioneRilevata | null>(null);
  protected readonly elaboro = signal(false);
  protected readonly rilevo = signal(false);
  protected readonly erroreAllegati = signal<string | null>(null);
  protected readonly spiega = spiegaConflitto;
  /** L'esito dato a questo ritiro (anche in attesa di invio). */
  protected readonly data = computed(() => this.coda.perRitiro(this.id()));
  protected readonly rifiutato = computed(() => this.coda.rifiutatoPerRitiro(this.id()));
  protected readonly fotoEsito = computed(() => {
    const e = this.data();
    return e ? fotoDi(e) : [];
  });
  protected readonly fotoRifiutate = computed(() =>
    this.fotoEsito().filter((f) => f.stato === 'RIFIUTATA'),
  );
  protected readonly riepilogoFoto = computed(() => {
    const f = this.fotoEsito();
    const inviate = f.filter((x) => x.stato === 'INVIATA').length;
    const attesa = f.filter((x) => x.stato === 'DA_INVIARE').length;
    const base = f.length === 1 ? '1 foto' : `${f.length} foto`;
    if (attesa > 0) return `${base}: ${inviate} inviate, ${attesa} in attesa di invio.`;
    return inviate === f.length ? `${base} inviate all'ufficio.` : `${base}.`;
  });
  protected readonly kb = (f: FotoPronta) => Math.round(f.dimensioneByte / 1024);

  protected scegli(tipo: TipoEventoCampo): void {
    this.modo.set(tipo);
    this.testo.set('');
    this.errore.set(null);
    this.azzeraAllegati();
  }

  protected annulla(): void {
    this.modo.set(null);
    this.errore.set(null);
    this.azzeraAllegati();
  }

  private azzeraAllegati(): void {
    this.foto.set([]);
    this.posizione.set(null);
    this.erroreAllegati.set(null);
  }

  protected async aggiungiFoto(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permette di riscegliere lo stesso file
    if (!file || this.foto().length >= this.maxFoto) return;
    this.erroreAllegati.set(null);
    this.elaboro.set(true);
    try {
      const pronta = await this.elaboratore.prepara(file);
      this.foto.update((l) => [...l, pronta]);
    } catch (e) {
      this.erroreAllegati.set(
        e instanceof Error && e.message ? e.message : 'Non riesco a preparare la foto.',
      );
    } finally {
      this.elaboro.set(false);
    }
  }

  protected togliFoto(i: number): void {
    this.foto.update((l) => l.filter((_, k) => k !== i));
  }

  /** Una sola lettura, adesso, su richiesta esplicita dell'autista. */
  protected async rilevaPosizione(): Promise<void> {
    this.erroreAllegati.set(null);
    this.rilevo.set(true);
    try {
      this.posizione.set(await this.rilevatore.rileva());
    } catch (e) {
      this.erroreAllegati.set(
        e instanceof Error && e.message ? e.message : 'Posizione non disponibile.',
      );
    } finally {
      this.rilevo.set(false);
    }
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
    if (this.elaboro() || this.rilevo()) return;
    this.invio.set(true);
    try {
      const dati: DatiEvento =
        tipo === 'RITIRO_NON_ESEGUITO' ? { motivo: testo } : testo === '' ? {} : { nota: testo };
      const posizione = this.posizione();
      if (posizione) dati.posizione = posizione;
      await this.coda.registra({
        ritiroId: this.id(),
        tipo,
        versioneVista: r.versione,
        dataVista: r.dataPrevista,
        sedeVista: r.produttore.sedeId,
        dati,
        foto: this.foto(),
      });
      this.azzeraAllegati();
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
