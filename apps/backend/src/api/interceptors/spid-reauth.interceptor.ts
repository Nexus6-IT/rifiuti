import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Reflector } from '@nestjs/core';

/**
 * SPID Re-Authentication Interceptor
 *
 * Enforces SPID/CIE re-authentication for high-risk operations per spec.md FR-027:
 * - Checks if more than 15 minutes have elapsed since last SPID authentication
 * - Blocks high-risk operations (delete FIR, approve user, digital signature) if session not fresh
 * - Returns 428 Precondition Required to trigger frontend re-auth modal
 *
 * Usage:
 * @RequireSpidReauth() // Apply to controller methods that need fresh SPID session
 * async deleteF

IR(@Param('id') id: string) { ... }
 */

// Metadata key for the @RequireSpidReauth decorator
export const REQUIRE_SPID_REAUTH_KEY = 'requireSpidReauth';

// Decorator to mark endpoints that require fresh SPID authentication
export const RequireSpidReauth = () =>
  (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    Reflect.defineMetadata(REQUIRE_SPID_REAUTH_KEY, true, descriptor.value);
    return descriptor;
  };

@Injectable()
export class SpidReauthInterceptor implements NestInterceptor {
  private readonly SPID_SESSION_FRESHNESS_MS = 15 * 60 * 1000; // 15 minutes in milliseconds

  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const requiresSpidReauth = this.reflector.get<boolean>(
      REQUIRE_SPID_REAUTH_KEY,
      context.getHandler(),
    );

    // If this endpoint doesn't require SPID re-auth, proceed normally
    if (!requiresSpidReauth) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // If no authenticated user, let the auth guard handle it
    if (!user) {
      return next.handle();
    }

    // Get last SPID authentication timestamp from user session/JWT
    const lastSpidAuthTime = user.lastSpidAuthTime || user.iat * 1000; // iat is in seconds, convert to ms

    // Check if SPID session is still fresh (< 15 minutes)
    const now = Date.now();
    const timeSinceLastAuth = now - lastSpidAuthTime;

    if (timeSinceLastAuth > this.SPID_SESSION_FRESHNESS_MS) {
      // Session is stale, require re-authentication
      throw new HttpException(
        {
          statusCode: HttpStatus.PRECONDITION_REQUIRED,
          error: 'Precondition Required',
          message:
            'This operation requires fresh SPID/CIE authentication. Please re-authenticate to continue.',
          requiredAction: 'SPID_REAUTH',
          lastAuthTime: lastSpidAuthTime,
          requiredFreshness: this.SPID_SESSION_FRESHNESS_MS,
        },
        HttpStatus.PRECONDITION_REQUIRED, // 428 status code
      );
    }

    // Session is fresh, proceed with the request
    return next.handle();
  }
}
