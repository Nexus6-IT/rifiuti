import { Component } from '@angular/core';
import { generaNonceAccesso } from '../core/nonce-accesso';

/**
 * Il login e' un normale link: parte anche senza JavaScript e il RelayState riporta qui.
 * `campo.<nonce>`: il nonce e' ricordato nel browser e deve tornare nel fragment (anti login-CSRF).
 */
export const URL_LOGIN_SPID = '/api/v1/auth/spid/login?RelayState=campo';

@Component({
  selector: 'app-login',
  template: `
    <main class="pagina centro">
      <h1>WasteFlow campo</h1>
      <p>Accedi per vedere il tuo giro di oggi.</p>
      @if (url) {
        <a class="bottone" [href]="url" data-testid="accedi">Accedi con SPID / CIE</a>
      } @else {
        <p class="errore" role="alert" data-testid="no-storage">
          Questo browser non permette di salvare l'accesso (navigazione privata?). Apri l'app in una
          finestra normale.
        </p>
      }
    </main>
  `,
})
export class LoginPagina {
  private readonly nonce = generaNonceAccesso();
  protected readonly url = this.nonce ? `${URL_LOGIN_SPID}.${this.nonce}` : null;
}
