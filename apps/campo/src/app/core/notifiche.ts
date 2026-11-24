import { Component, inject } from '@angular/core';
import { PushService } from './push.service';

/**
 * Notifiche dell'app: attivazione sul dispositivo e preferenze. L'avviso non contiene dati
 * (nessun cliente, indirizzo o quantita'): dice solo che il giro e' cambiato, poi si apre l'app.
 * Nasconde tutto quando il browser o il server non le offrono.
 */
@Component({
  selector: 'app-notifiche',
  template: `
    @switch (push.stato()) {
      @case ('da-installare') {
        <section class="notifiche" data-testid="notifiche-installa">
          <h2>Notifiche</h2>
          <p class="sotto">
            Su iPhone le notifiche funzionano solo dopo aver aggiunto l'app alla schermata Home
            (Condividi, poi «Aggiungi alla schermata Home»).
          </p>
        </section>
      }
      @case ('negato') {
        <section class="notifiche" data-testid="notifiche-negate">
          <h2>Notifiche</h2>
          <p class="sotto">
            Le notifiche sono bloccate per questa app. Per riceverle, consentile dalle impostazioni
            del browser o del telefono.
          </p>
        </section>
      }
      @case ('di-altro-autista') {
        <section class="notifiche" data-testid="notifiche-altro-autista">
          <h2>Notifiche</h2>
          <p class="sotto">
            Queste notifiche sono già attive per un altro autista su questo telefono. Chiedi al
            collega di disattivarle dal suo accesso, oppure all'ufficio di liberarle: poi riapri
            l'app per attivarle a tuo nome.
          </p>
        </section>
      }
      @case ('da-attivare') {
        <section class="notifiche" data-testid="notifiche-attiva">
          <h2>Notifiche</h2>
          <p class="sotto">
            Ti avvisiamo quando il tuo giro cambia. L'avviso non contiene dati: apri l'app per
            vedere cosa è cambiato.
          </p>
          <button
            type="button"
            class="secondario"
            [disabled]="push.occupato()"
            (click)="push.attiva()"
            data-testid="attiva-notifiche"
          >
            Attiva le notifiche
          </button>
          @if (push.errore(); as e) {
            <p class="errore" role="alert" data-testid="notifiche-errore">{{ e }}</p>
          }
        </section>
      }
      @case ('attivo') {
        <section class="notifiche" data-testid="notifiche-attive">
          <h2>Notifiche</h2>
          <label class="preferenza">
            <input
              type="checkbox"
              [checked]="push.preferenze().giroModificato"
              (change)="cambia($event)"
              data-testid="pref-giro"
            />
            Avvisami quando il mio giro cambia
          </label>
          <button
            type="button"
            class="link"
            [disabled]="push.occupato()"
            (click)="push.disattiva()"
            data-testid="disattiva-notifiche"
          >
            Disattiva le notifiche su questo telefono
          </button>
          @if (push.errore(); as e) {
            <p class="errore" role="alert" data-testid="notifiche-errore">{{ e }}</p>
          }
        </section>
      }
    }
  `,
})
export class Notifiche {
  protected readonly push = inject(PushService);

  constructor() {
    void this.push.inizializza();
  }

  protected cambia(evento: Event): void {
    void this.push.impostaGiroModificato((evento.target as HTMLInputElement).checked);
  }
}
