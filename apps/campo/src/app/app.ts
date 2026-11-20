import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { GiroService, dataLocaleIso } from './core/giro.service';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  constructor() {
    // Fine giornata / telefono condiviso: la copia di ieri o di un altro utente non resta.
    void inject(GiroService).pulisciObsoleto(dataLocaleIso());
  }
}
