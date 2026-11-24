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
    case 'ESITO_GIA_REGISTRATO':
      return "per questo ritiro c'era già un esito";
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
    @if (coda.daInviare() > 0 || coda.fotoDaInviare() > 0) {
      <p class="avviso-offline" role="status" data-testid="da-inviare">
        {{ riepilogo() }}.
        @if (!rete.online()) {
          Sei offline: partiranno appena torna la rete (tieni aperta l'app).
        }
        <button type="button" class="link" (click)="coda.invia()" data-testid="invia-ora">
          Invia ora
        </button>
      </p>
    }
    @if (coda.bloccata(); as b) {
      <p class="errore" role="alert" data-testid="bloccata">
        Gli esiti non partono: {{ b }} Contatta l'ufficio, poi tocca «Invia ora».
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
        {{
          coda.diAltriUtenti() === 1
            ? "Sul telefono c'è 1 esito non inviato di un altro utente."
            : 'Sul telefono ci sono ' +
              coda.diAltriUtenti() +
              ' esiti non inviati di un altro utente.'
        }}
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

  /** «N esiti da inviare», «N foto da inviare» o entrambi (foto di esiti gia' confermati). */
  protected riepilogo(): string {
    return riepilogoDaInviare(this.coda.daInviare(), this.coda.fotoDaInviare());
  }

  protected scarta(): void {
    if (
      window.confirm(
        "Scartare gli esiti non inviati di un altro utente? Andranno persi e l'ufficio non li riceverà mai.",
      )
    ) {
      void this.coda.scartaDiAltriUtenti();
    }
  }
}

/** Testo di cio' che aspetta la rete: esiti e foto (le foto partono dopo il loro esito). */
export function riepilogoDaInviare(esiti: number, foto: number): string {
  const parti: string[] = [];
  if (esiti > 0) parti.push(esiti === 1 ? '1 esito da inviare' : `${esiti} esiti da inviare`);
  if (foto > 0) parti.push(`${foto} foto da inviare`);
  return parti.join(' e ');
}
