import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { resolveRequestTenantId } from '../../core/context/resolve-request-tenant'

/**
 * @CurrentTenant Decorator
 * Restituisce il tenant (azienda) EFFETTIVO della richiesta: quello selezionato
 * e già validato dal `TenantSwitchInterceptor`, con fallback sul tenant del JWT.
 * NON leggere `req.user.tenantId` direttamente: durante uno switch di azienda
 * resta il tenant primario e le scritture finirebbero nell'azienda sbagliata.
 *
 * Usage:
 * async getUser(@CurrentTenant() tenantId: string) { ... }
 */
export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | null => {
    return resolveRequestTenantId(ctx.switchToHttp().getRequest())
  }
)
