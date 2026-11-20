import { Component, inject } from '@angular/core';
import { CodaEventi } from './coda-eventi';
import { StatoRete } from './stato-rete';

/** Testo italiano del motivo per cui un esito e' finito «da riconciliare» in ufficio. */
export function spiegaConflitto(motivo: string | null): string {
  switch (motivo) {
    case 'RITIRO_ANNULLATO':
      return 'il ritiro era stato annullato in ufficio';
    case 'RITIRO_MODIFICATO':
      return 'il ritiro era stato modificato in ufficio';
    case 'RITIRO_RIASSEGNATO':
      return 'il ritiro non è più assegnato a te';
    case 'RITIRO_STATO_CAMBIATO':
      return 'il ritiro era già stato chiuso in ufficio';
    case 'RITIRO_CON_FIR':
      return 'il ritiro ha già un FIR';
    default:
      return 'serve un controllo';
  }
}

/**
 * Stato della coda di uscita: quanti esiti aspettano la rete, quelli non accettati dal server,
 * quelli di un altro utente rimasti sul telefono.
 */
@Component({
  selector: 'app-stato-coda',
  template: `
    @if (coda.daInviare() > 0) {
      <p class="avviso-offline" role="status" data-testid="da-inviare">
        {{
          coda.daInviare() === 1 ? '1 esito da inviare' : coda.daInviare() + ' esiti da inviare'
        }}.
        @if (!rete.online()) {
          Sei offline: partiranno appena torna la rete (tieni aperta l'app).
        }
        <button type="button" class="link" (click)="coda.invia()" data-testid="invia-ora">
          Invia ora
        </button>
      </p>
    }
    @if (coda.rifiutati() > 0) {
      <p class="errore" role="alert" data-testid="rifiutati">
        {{
          coda.rifiutati() === 1
            ? '1 esito non è stato accettato dal server.'
            : coda.rifiutati() + ' esiti non sono stati accettati dal server.'
        }}
        Aprilo dal ritiro per vedere il motivo.
      </p>
    }
    @if (coda.nonSalvato()) {
      <p class="errore" role="alert" data-testid="non-salvato">
        Questo telefono non riesce a salvare gli esiti: tieni aperta l'app finché non sono inviati.
      </p>
    }
    @if (coda.diAltriUtenti() > 0) {
      <p class="avviso-offline" role="status" data-testid="altri-utenti">
        Sul telefono ci sono {{ coda.diAltriUtenti() }} esiti non inviati di un altro utente.
        Partiranno quando quell'utente rientra.
        <button type="button" class="link" (click)="scarta()" data-testid="scarta-altri">
          Scartali
        </button>
      </p>
    }
  `,
})
export class StatoCoda {
  protected readonly coda = inject(CodaEventi);
  protected readonly rete = inject(StatoRete);

  protected scarta(): void {
    if (
      window.confirm(
        'Scartare gli esiti non inviati di un altro utente? Non potranno più essere inviati.',
      )
    ) {
      void this.coda.scartaDiAltriUtenti();
    }
  }
}
