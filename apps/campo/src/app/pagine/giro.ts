import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { GiroService, dataLocaleIso } from '../core/giro.service';
import { SessioneService } from '../core/sessione.service';

@Component({
  selector: 'app-giro',
  imports: [RouterLink],
  template: `
    <header class="testata">
      <div>
        <h1>Giro di oggi</h1>
        @if (giro.corrente(); as g) {
          <p class="sotto">{{ g.autista.nome }} {{ g.autista.cognome }} · {{ g.data }}</p>
        }
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
                </a>
              </li>
            }
          </ol>
        }
        <button type="button" class="secondario" (click)="carica()">Aggiorna</button>
      }
    </main>
  `,
})
export class GiroPagina implements OnInit {
  protected readonly giro = inject(GiroService);
  private readonly sessione = inject(SessioneService);
  private readonly router = inject(Router);
  protected readonly caricamento = signal(false);
  protected readonly errore = signal<string | null>(null);

  ngOnInit(): void {
    this.carica();
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
    this.sessione.esci().subscribe(() => {
      this.giro.svuota();
      void this.router.navigate(['/login']);
    });
  }
}

export function messaggioErrore(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'Nessuna connessione: il giro richiede la rete.';
    const messaggio = (e.error as { message?: unknown } | null)?.message;
    if (typeof messaggio === 'string' && e.status < 500) return messaggio;
  }
  return 'Non riesco a caricare il giro. Riprova tra poco.';
}
