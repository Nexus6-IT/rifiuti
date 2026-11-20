import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { SessioneService } from '../core/sessione.service';

/**
 * Destinazione del ritorno SPID/CIE (`/campo/accesso#accessToken=...`). Legge i token dal
 * fragment, li salva, cancella il fragment dalla cronologia e va al giro.
 */
@Component({
  selector: 'app-accesso',
  template: '<p class="stato" role="status">Accesso in corso…</p>',
})
export class AccessoPagina {
  constructor() {
    const doc = inject(DOCUMENT);
    const router = inject(Router);
    const ok = inject(SessioneService).accettaRitornoSpid(doc.location.hash);
    doc.defaultView?.history.replaceState(null, '', doc.location.pathname + doc.location.search);
    void router.navigateByUrl(ok ? '/' : '/login', { replaceUrl: true });
  }
}
