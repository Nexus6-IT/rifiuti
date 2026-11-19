import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessioneService } from './sessione.service';

/** Le rotte del giro richiedono una sessione; altrimenti si va al login. */
export const autenticatoGuard: CanActivateFn = () => {
  const sessione = inject(SessioneService);
  return sessione.autenticato() ? true : inject(Router).createUrlTree(['/login']);
};
