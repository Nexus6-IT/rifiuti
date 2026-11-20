import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { GiroService, dataLocaleIso } from './core/giro.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  private readonly giro = inject(GiroService);
  private readonly router = inject(Router);

  constructor() {
    // Fine giornata / telefono condiviso: la copia di ieri o di un altro utente non resta.
    void this.giro.pulisciObsoleto(dataLocaleIso());
    // Una PWA ripresa dal background non ricostruisce App: si ricontrolla il giorno alla ripresa.
    document.addEventListener('visibilitychange', () => this.allaRipresa());
    window.addEventListener('pageshow', () => this.allaRipresa());
  }

  private ripresaInCorso = false;

  /**
   * `pageshow` e `visibilitychange` arrivano spesso insieme (e a volte piu' volte): un solo controllo
   * alla volta, altrimenti il giro verrebbe scartato e ricaricato due volte.
   */
  private allaRipresa(): void {
    if (this.ripresaInCorso) return;
    this.ripresaInCorso = true;
    void this.giro
      .controllaGiorno(dataLocaleIso())
      .then((cambiato) => {
        // Dal dettaglio di un ritiro di ieri si torna al giro, che si ricarica da se'.
        if (cambiato) void this.router.navigateByUrl('/');
      })
      .finally(() => (this.ripresaInCorso = false));
  }
}
