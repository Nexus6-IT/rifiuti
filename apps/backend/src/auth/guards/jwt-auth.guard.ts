/**
 * JWT Auth Guard
 * Protects routes requiring JWT authentication
 * Supports @Public() decorator for public routes
 */

import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import { Reflector } from '@nestjs/core'

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super()
  }

  /**
   * Check if route can be activated
   * Allows public routes to bypass authentication
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ])

    if (isPublic) {
      return true
    }

    // Call passport JWT strategy validation
    return super.canActivate(context) as Promise<boolean>
  }

  /**
   * Handle authentication result from passport
   */
  handleRequest(err: any, user: any, _info: any, _context: any) {
    // If there's an error or no user, throw unauthorized
    if (err || !user) {
      throw new UnauthorizedException(err?.message || 'Unauthorized access')
    }

    return user
  }
}
