import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Observable } from 'rxjs'
import { CONSENTITO_AUTISTA } from '../decorators/consentito-autista.decorator'

/** Codice macchina del 403 (il filtro globale lo rimanda nel corpo). */
export const ROTTA_NON_CONSENTITA_ALL_AUTISTA = 'ROTTA_NON_CONSENTITA_ALL_AUTISTA'

/**
 * RuoloAutistaInterceptor: un utente con ruolo `AUTISTA` entra SOLO nelle rotte marcate
 * `@ConsentitoAutista()`; ogni altra riceve 403 prima che il handler giri.
 *
 * Perche' un interceptor globale e non un guard: i guard globali girano PRIMA di quelli dei
 * controller (`JwtAuthGuard`), quindi non vedrebbero `req.user`. Gli interceptor girano dopo tutti
 * i guard, a utente gia' autenticato. Va registrato PRIMA di `TenantSwitchInterceptor` (c'e' un
 * test sull'ordine): l'autista non deve nemmeno arrivare alla verifica dell'azienda.
 *
 * Fail-closed per costruzione: la lista di ammissione e' il marcatore, non una lista di divieti.
 * Il ruolo e' quello del token (`user.role`): un autista ha un'azienda sola.
 * Le rotte pubbliche non hanno utente e passano (non sono d'ufficio).
 */
@Injectable()
export class RuoloAutistaInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RuoloAutistaInterceptor.name)

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle()

    const req = context.switchToHttp().getRequest<{ user?: { id?: string; role?: string } }>()
    if (req.user?.role !== 'AUTISTA') return next.handle()

    const consentita = this.reflector.getAllAndOverride<string | undefined>(CONSENTITO_AUTISTA, [
      context.getHandler(),
      context.getClass(),
    ])
    if (consentita !== undefined) return next.handle()

    this.logger.warn(`Rotta d'ufficio negata a un autista (utente=${req.user.id ?? '?'})`)
    throw new ForbiddenException({
      message: 'Il tuo ruolo non consente di usare questa funzione.',
      error: ROTTA_NON_CONSENTITA_ALL_AUTISTA,
    })
  }
}
