import { Component, inject } from '@angular/core';
import { formattaAggiornamento } from './formato';
import { GiroService } from './giro.service';
import { StatoRete } from './stato-rete';

/** Ultimo aggiornamento sempre visibile; banner «Offline» quando i dati sono quelli salvati. */
@Component({
  selector: 'app-stato-giro',
  template: `
    @if (giro.aggiornatoIl(); as iso) {
      <p class="sotto" data-testid="aggiornato">Aggiornato il {{ formatta(iso) }}</p>
    }
    @if (giro.daArchivio() || !rete.online()) {
      <p class="avviso-offline" role="status" data-testid="offline">
        Offline:
        {{ giro.daArchivio() ? 'stai vedendo il giro salvato sul telefono' : 'senza rete' }}. I dati
        potrebbero non essere aggiornati.
      </p>
    }
  `,
})
export class StatoGiro {
  protected readonly giro = inject(GiroService);
  protected readonly rete = inject(StatoRete);
  protected readonly formatta = formattaAggiornamento;
}
