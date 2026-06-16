import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AdminTenantContextService } from '../services/admin-tenant-context.service';
import { environment } from '../../../environments/environment';

/**
 * Tenant Interceptor
 *
 * Quando un utente SUPER_ADMIN ha selezionato un tenant tramite il tenant
 * switcher, aggiunge l'header `X-Tenant-ID: <id>` a tutte le richieste dirette
 * verso il backend (`environment.apiUrl`). Per gli utenti non super-admin la
 * selezione resta vuota → nessun header aggiunto (no-op).
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
