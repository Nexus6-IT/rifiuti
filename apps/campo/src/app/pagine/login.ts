import { Component } from '@angular/core';

/** Il login e' un normale link: parte anche senza JavaScript e il RelayState riporta qui. */
export const URL_LOGIN_SPID = '/api/v1/auth/spid/login?RelayState=campo';

@Component({
  selector: 'app-login',
  template: `
    <main class="pagina centro">
      <h1>WasteFlow campo</h1>
      <p>Accedi per vedere il tuo giro di oggi.</p>
      <a class="bottone" [href]="url" data-test="accedi">Accedi con SPID / CIE</a>
    </main>
  `,
})
export class LoginPagina {
  protected readonly url = URL_LOGIN_SPID;
}
