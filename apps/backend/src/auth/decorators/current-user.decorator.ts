/**
 * CurrentUser Decorator
 * Extracts authenticated user from request
 */

import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import { resolveRequestTenantId } from '../../core/context/resolve-request-tenant'

export interface CurrentUserPayload {
  id: string
  email: string
  fiscalCode?: string
  tenantId: string
  role: string
  permissions: string[]
  /** Presente solo se la sessione e' un'impersonificazione (id del SUPER_ADMIN). */
  impersonatorId?: string
}

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext): any => {
    const request = ctx.switchToHttp().getRequest()
    const user = request.user

    if (!user) {
      return user
    }

    // `tenantId` è l'azienda su cui la richiesta OPERA, non quella scritta nel
    // token: durante uno switch di azienda (X-Tenant-ID validato) le due
    // divergono, e i controller devono seguire l'azienda selezionata — la
    // stessa che l'estensione RLS di Prisma inietta nelle query.
    const tenantAttivo = resolveRequestTenantId(request)
    const effettivo =
      !tenantAttivo || tenantAttivo === user.tenantId ? user : { ...user, tenantId: tenantAttivo }

    // @CurrentUser('id'): singolo campo dell'utente effettivo (come il vecchio decoratore di api/).
    return data ? effettivo[data] : effettivo
  }
)
