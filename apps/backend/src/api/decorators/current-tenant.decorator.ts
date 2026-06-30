import { createParamDecorator, ExecutionContext } from '@nestjs/common'

/**
 * @CurrentTenant Decorator
 * Extracts tenant ID from JWT token in request
 *
 * Usage:
 * async getUser(@CurrentTenant() tenantId: string) { ... }
 */
export const CurrentTenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest()
    return request.user?.tenantId || null
  }
)
