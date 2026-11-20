import { Component, OnInit, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GiroService, dataLocaleIso } from '../core/giro.service';
import type { RitiroVista } from '../core/modelli';
import { StatoGiro } from '../core/stato-giro';

/** Dettaglio di un ritiro del giro (`id` dal percorso, `withComponentInputBinding`). */
@Component({
  selector: 'app-ritiro',
  imports: [RouterLink, StatoGiro],
  template: `
    <header class="testata">
      <a routerLink="/" class="indietro" data-testid="indietro">‹ Giro</a>
    </header>
    <main class="pagina">
      <app-stato-giro />
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
