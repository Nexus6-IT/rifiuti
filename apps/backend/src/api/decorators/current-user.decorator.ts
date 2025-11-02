import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @CurrentUser Decorator
 * Extracts user data from JWT token in request
 * Per plan.md: User context for authorization and audit
 *
 * Usage:
 * - @CurrentUser() user: JwtPayload - Get full user object
 * - @CurrentUser('userId') userId: string - Get specific field
 * - @CurrentUser('email') email: string - Get email field
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return null;
    }

    // If data parameter provided, return specific field
    if (data) {
      return user[data];
    }

    // Return full user object
    return user;
  },
);

/**
 * JWT Payload Interface
 * Standard structure expected in request.user
 */
export interface JwtPayload {
  userId: string;
  tenantId: string;
  email: string;
  spidFiscalCode?: string;
  role?: string;
  lastSpidAuthTimestamp?: number;
  iat?: number;
  exp?: number;
}
