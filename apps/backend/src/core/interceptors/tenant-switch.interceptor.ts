import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common'
import { Observable, from, switchMap } from 'rxjs'
import { Request } from 'express'
import { TenantContext } from '../context/tenant-context'
import { MembershipService } from '../../api/me/membership.service'

/**
 * TenantSwitchInterceptor — validazione header `X-Tenant-ID` per TUTTI gli utenti.
 *
 * Funziona come SECONDO livello di risoluzione del tenant (dopo il
 * `TenantContextMiddleware`):
 *
 *   1. Se l'header `X-Tenant-ID` è assente oppure l'utente non è autenticato
 *      → no-op, la richiesta prosegue col tenant del JWT (impostato dal middleware).
 *
 *   2. Se l'utente è SUPER_ADMIN e il header è presente → il middleware lo ha già
 *      gestito (onora l'header direttamente dal JWT), quindi l'interceptor non
 *      interviene di nuovo (sarebbe ridondante).
 *
 *   3. Se l'utente è un utente normale e l'header è presente → si verifica la
 *      membership via DB (`MembershipService.checkAccess`):
 *        - Autorizzato → il TenantContext viene ri-eseguito con il tenant dell'header
 *          e `req.tenantId` viene aggiornato. Tutte le query dell'handler useranno
 *          il tenant selezionato dall'utente (switch senza nuovo JWT).
 *        - Non autorizzato → fail-closed: l'header viene ignorato silenziosamente,
 *          la richiesta prosegue col tenant primario del JWT. NESSUNA eccezione
 *          viene lanciata (non si rivela informazione sull'esistenza dell'altro tenant).
 *        - Errore nella verifica → fail-closed: ignora l'header, log di avviso.
 *
 * Sicurezza:
 *   - Non è possibile accedere a dati di un tenant non autorizzato forzando
 *     l'header: la validazione è server-side su DB, non basata su claims del client.
 *   - Il SUPER_ADMIN non è gestito qui per evitare doppia logica (il middleware
 *     è già il punto autorevole per il suo bypass).
 *
 * Registrato come APP_INTERCEPTOR globale in `AppModule`. Gira dopo i guard Passport
 * (JWT guard), quindi `req.user` è già disponibile.
 */
@Injectable()
export class TenantSwitchInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantSwitchInterceptor.name)

  constructor(private readonly membership: MembershipService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Funziona solo su richieste HTTP (non su WebSocket/RPC).
    if (context.getType() !== 'http') {
      return next.handle()
    }

    const req = context.switchToHttp().getRequest<Request>()
    const targetTenantId = this.readTenantHeader(req)

    // Nessun header → passthrough immediato.
    if (!targetTenantId) {
      return next.handle()
    }

    const user = (req as any).user

    // Utente non autenticato (rotta pubblica) o SUPER_ADMIN (già gestito dal
    // middleware): passthrough.
    if (!user || user.role === 'SUPER_ADMIN') {
      return next.handle()
    }

    // Tenant primario dell'utente (risolto dal middleware dal JWT).
    const primaryTenantId: string = (req as any).tenantId || user.tenantId || ''

    // Validazione asincrona della membership, poi switch del contesto.
    return from(
      this.membership.checkAccess(user.id, targetTenantId, primaryTenantId).catch((err: Error) => {
        this.logger.warn(
          `Errore verifica membership (utente=${user.id}, target=${targetTenantId}): ${err.message}`
        )
        return false // fail-closed su errore DB
      })
    ).pipe(
      switchMap((isAllowed: boolean) => {
        if (!isAllowed) {
          // Fail-closed: header non autorizzato → prosegui col tenant primario.
          this.logger.warn(
            `Header X-Tenant-ID="${targetTenantId}" rifiutato per utente ${user.id} ` +
              `(non membro). Proseguo con tenant primario "${primaryTenantId}".`
          )
          return next.handle()
        }

        // Accesso autorizzato: sovrapponi il TenantContext con il tenant selezionato
        // e aggiorna req.tenantId (usato dai controller come fonte del tenant effettivo).
        ;(req as any).tenantId = targetTenantId

        return new Observable<unknown>(subscriber => {
          TenantContext.run(
            { tenantId: targetTenantId, userId: user.id, isSuperAdmin: false },
            () => {
              next.handle().subscribe({
                next: v => subscriber.next(v),
                error: e => subscriber.error(e),
                complete: () => subscriber.complete(),
              })
            }
          )
        })
      })
    )
  }

  /**
   * Legge l'header `X-Tenant-ID` (case-insensitive, normalizzato da Express in
   * minuscolo). Gestisce il caso di array (header ripetuto): usa il primo valore.
   * Ritorna `null` se assente o vuoto.
   */
  private readTenantHeader(req: Request): string | null {
    const raw = req.headers['x-tenant-id']
    const value = Array.isArray(raw) ? raw[0] : raw
    const trimmed = typeof value === 'string' ? value.trim() : ''
    return trimmed.length > 0 ? trimmed : null
  }
}
