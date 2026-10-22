import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  ForbiddenException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Observable, from, switchMap, throwError } from 'rxjs'
import { Request } from 'express'
import { TenantContext } from '../context/tenant-context'
import { MembershipService } from '../../api/me/membership.service'
import { CONSENTI_SELEZIONE_NON_VALIDA } from '../decorators/consenti-selezione-non-valida.decorator'

/**
 * Risposta per un'azienda selezionata che l'utente non può usare. Identica per un'azienda
 * inesistente e per una non autorizzata (nessuna enumerazione), e per un errore della
 * verifica (il dettaglio interno non arriva al client).
 */
export const AZIENDA_SELEZIONATA_NON_ACCESSIBILE = {
  message: "L'azienda selezionata non è più accessibile: selezionane un'altra.",
  error: 'AZIENDA_SELEZIONATA_NON_ACCESSIBILE',
} as const

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
 *        - Non autorizzato, o errore nella verifica → 403
 *          `AZIENDA_SELEZIONATA_NON_ACCESSIBILE`, con lo stesso messaggio per un'azienda
 *          inesistente e per una non autorizzata (nessuna enumerazione). L'handler non gira.
 *          Prima la richiesta proseguiva in silenzio sul tenant primario del JWT: con una
 *          selezione scaduta (associazione consulente terminata) le scritture finivano
 *          nell'azienda sbagliata, per esempio un movimento nel registro dello studio.
 *          Il frontend, su questo codice, cancella la selezione e ricarica.
 *        - Eccezione: le rotte di recupero marcate `@ConsentiSelezioneNonValida()` (elenco e
 *          switch delle aziende, login/refresh/logout) proseguono col tenant primario, così
 *          una selezione non valida non chiude l'utente fuori dal selettore.
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

  constructor(
    private readonly membership: MembershipService,
    private readonly reflector: Reflector
  ) {}

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
        return false // fail-closed su errore DB: 403 come per un'azienda non accessibile
      })
    ).pipe(
      switchMap((isAllowed: boolean) => {
        if (!isAllowed) {
          if (this.rottaDiRecupero(context)) {
            // Elenco/switch delle aziende, sessione: si prosegue col tenant primario.
            return next.handle()
          }
          this.logger.warn(
            `Header X-Tenant-ID="${targetTenantId}" rifiutato per utente ${user.id}: ` +
              `azienda non accessibile, richiesta respinta (403).`
          )
          return throwError(
            () => new ForbiddenException({ ...AZIENDA_SELEZIONATA_NON_ACCESSIBILE })
          )
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

  /** Vero per le rotte marcate `@ConsentiSelezioneNonValida()` (sul metodo o sulla classe). */
  private rottaDiRecupero(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(CONSENTI_SELEZIONE_NON_VALIDA, [
        context.getHandler(),
        context.getClass(),
      ]) === true
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
