/**
 * Roles Guard
 * Checks if authenticated user has required roles for the route
 */

import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ROLES_KEY } from '../decorators/roles.decorator'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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

    // Check if user has any of the required roles
    return requiredRoles.includes(user.role)
  }
}
