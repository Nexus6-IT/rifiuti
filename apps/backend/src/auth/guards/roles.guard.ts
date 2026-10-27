/**
 * Roles Guard
 * Checks if authenticated user has required roles for the route
 *
 * Il ruolo che conta è quello EFFETTIVO nell'azienda della richiesta: un consulente ADMIN
 * nel proprio studio e solo VIEWER presso un cliente non deve superare `@Roles('ADMIN')`
 * sulle rotte del cliente. Il guard gira prima del `TenantSwitchInterceptor` globale, quindi
 * l'azienda selezionata (header `X-Tenant-ID`) la ricava da sé (`aziendaCandidataDaHeader`).
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ServiceUnavailableException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../decorators/roles.decorator'
import { aziendaCandidataDaHeader } from '../../core/context/azienda-da-header'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'
import { VERIFICA_AZIENDA_NON_DISPONIBILE } from '../../core/context/azienda-selezionata-errori'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private readonly ruoloEffettivo: RuoloEffettivoService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required roles from route metadata
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    // If no roles are required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true
    }

    // Get user from request (populated by JWT auth guard)
    const request = context.switchToHttp().getRequest()
    const user = request.user

    // If no user, deny access
    if (!user) {
      return false
    }

    let ruolo: string = user.role
    const candidata = aziendaCandidataDaHeader(request)
    if (candidata) {
      try {
        // `null` = nessun legame con l'azienda: si decide sul token, poi l'interceptor
        // respinge con 403 (o la rotta prosegue sull'azienda primaria, dove il token vale).
        ruolo = (await this.ruoloEffettivo.accesso(user, candidata)) ?? ruolo
      } catch {
        // Fail-closed, stesso corpo dell'interceptor: mai 500, mai via libera.
        throw new ServiceUnavailableException({ ...VERIFICA_AZIENDA_NON_DISPONIBILE })
      }
    }

    // Check if user has any of the required roles
    return requiredRoles.includes(ruolo)
  }
}
