import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { requireRequestTenantId } from '../context/resolve-request-tenant'

/**
 * Azienda SELEZIONATA della richiesta (stessa risposta di `@CurrentTenant()`),
 * FAIL-CLOSED: 403 se nessuna azienda e' determinabile.
 *
 * Non legge mai l'header `x-tenant-id` grezzo (non validato contro la membership)
 * ne' il solo `user.tenantId` del token: durante uno switch di azienda il token
 * resta quello primario, mentre la RLS opera sull'azienda selezionata.
 */
export const TenantId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  return requireRequestTenantId(ctx.switchToHttp().getRequest())
})
