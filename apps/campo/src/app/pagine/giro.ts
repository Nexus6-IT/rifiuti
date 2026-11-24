import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { GiroService, dataLocaleIso, nonRaggiungibile } from '../core/giro.service';
import { Notifiche } from '../core/notifiche';
import { CodaEventi } from '../core/coda-eventi';
import { CodaRicevute } from '../core/coda-ricevute';
import { SessioneService } from '../core/sessione.service';
import { StatoCoda, riepilogoDaInviare } from '../core/stato-coda';
import { StatoGiro } from '../core/stato-giro';

@Component({
  selector: 'app-giro',
  imports: [RouterLink, StatoGiro, StatoCoda, Notifiche],
  template: `
    <header class="testata">
      <div>
        <h1>Giro di oggi</h1>
        @if (giro.corrente(); as g) {
          <p class="sotto">{{ g.autista.nome }} {{ g.autista.cognome }} · {{ g.data }}</p>
        }
        <app-stato-giro />
        <app-stato-coda />
      </div>
      <button type="button" class="secondario" (click)="esci()" data-testid="esci">Esci</button>
    </header>
    <main class="pagina">
      @if (caricamento()) {
        <p class="stato" role="status">Caricamento…</p>
      } @else if (errore(); as e) {
        <p class="errore" role="alert" data-testid="errore">{{ e }}</p>
        <button type="button" class="bottone" (click)="carica()">Riprova</button>
      } @else if (giro.corrente(); as g) {
        @if (g.ritiri.length === 0) {
          <p class="stato" data-testid="vuoto">Nessun ritiro programmato per oggi.</p>
        } @else {
          <ol class="elenco" data-testid="elenco">
            @for (r of g.ritiri; track r.id) {
              <li>
                <a [routerLink]="['/ritiro', r.id]" class="scheda" data-testid="ritiro">
                  <span class="fascia">{{ r.fascia ?? 'Orario libero' }}</span>
                  <strong>{{ r.produttore.nome }}</strong>
                  <span>{{ r.produttore.indirizzo }}</span>
                  <span class="sotto">
                    {{ r.cerCode }} · {{ r.descrizione }} · {{ r.quantitaPresunta }} {{ r.unita }}
                  </span>
                  @if (coda.perRitiro(r.id); as e) {
                    <span class="esito-badge" data-testid="badge-esito">
                      {{ e.tipo === 'RITIRO_ESEGUITO' ? 'Eseguito' : 'Non eseguito' }}
                      {{ e.stato === 'DA_INVIARE' ? '· da inviare' : '· inviato' }}
                    </span>
                  }
                </a>
              </li>
            }
          </ol>
        }
        <button type="button" class="secondario" (click)="carica()">Aggiorna</button>
      }
      <app-notifiche />
    </main>
  `,
})
export class GiroPagina {
  protected readonly giro = inject(GiroService);
  private readonly sessione = inject(SessioneService);
  protected readonly coda = inject(CodaEventi);
  private readonly ricevute = inject(CodaRicevute);
  private readonly router = inject(Router);
  protected readonly caricamento = signal(false);
  protected readonly errore = signal<string | null>(null);

  constructor() {
    // Al primo giro e a ogni scarto del giro di ieri (cambio giorno) si ricarica.
    effect(() => {
      this.giro.generazione();
      untracked(() => this.carica());
    });
  }

  protected carica(): void {
    this.caricamento.set(true);
    this.errore.set(null);
    this.giro.carica(dataLocaleIso()).subscribe({
      next: () => this.caricamento.set(false),
      error: (e: unknown) => {
        this.caricamento.set(false);
        this.errore.set(messaggioErrore(e));
      },
    });
  }

  protected esci(): void {
    const n = this.coda.daInviare();
    const foto = this.coda.fotoDaInviare();
    const nr = this.ricevute.daInviare();
    if (n + foto + nr > 0) {
      const cosa = [
        riepilogoDaInviare(n, foto),
        nr > 0 ? `${nr} ${nr === 1 ? 'ricevuta' : 'ricevute'} da inviare` : '',
      ]
        .filter(Boolean)
        .join(' e ');
      if (
        !window.confirm(
          `Hai ${cosa}. Se esci restano sul telefono e partiranno al tuo prossimo accesso. Uscire?`,
        )
      ) {
        return;
      }
    }
    this.sessione.esci().subscribe(() => {
      this.giro.svuota();
      void this.router.navigate(['/login']);
    });
  }
}

export function messaggioErrore(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (nonRaggiungibile(e))
      return 'Nessuna connessione e nessun giro salvato su questo telefono: collegati a internet almeno una volta oggi.';
    const messaggio = (e.error as { message?: unknown } | null)?.message;
    if (typeof messaggio === 'string' && e.status < 500) return messaggio;
  }
  return 'Non riesco a caricare il giro. Riprova tra poco.';
}
