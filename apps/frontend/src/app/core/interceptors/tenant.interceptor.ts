import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AdminTenantContextService } from '../services/admin-tenant-context.service';
import { environment } from '../../../environments/environment';

/**
 * Tenant Interceptor
 *
 * Quando l'utente ha selezionato una società tramite il tenant switcher
 * (`AdminTenantContextService.set()`), aggiunge l'header `X-Tenant-ID: <id>`
 * a tutte le richieste dirette verso il backend (`environment.apiUrl`).
 *
 * Funziona per QUALUNQUE utente con accesso a più società (SUPER_ADMIN,
 * consulenti, owner multi-azienda). Il backend (`TenantSwitchInterceptor`)
 * è il punto autorevole di validazione: verifica la membership prima di
 * applicare il cambio di contesto.
 *
 * Deve essere registrato DOPO l'auth interceptor in `app.config.ts`.
 */
export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  const tenantContext = inject(AdminTenantContextService);
  const tenantId = tenantContext.selectedTenantId();

  // Nessun tenant selezionato (utente standard o super admin in contesto globale).
  if (!tenantId) {
    return next(req);
  }

  // Aggiungi l'header solo alle richieste verso il backend dell'applicazione.
  if (!req.url.startsWith(environment.apiUrl)) {
    return next(req);
  }

  const tenantRequest = req.clone({
    setHeaders: {
      'X-Tenant-ID': tenantId,
    },
  });

  return next(tenantRequest);
};
