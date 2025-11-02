import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AUDIT_ACTION_KEY } from '../decorators/audit-action.decorator';

/**
 * SpidStepUpGuard
 * Enforces step-up re-authentication for high-risk operations
 * Per plan.md FR-027: Requires SPID re-auth if >15 minutes since last authentication
 *
 * High-risk operations (requires @AuditAction decorator):
 * - delete_fir
 * - approve_user
 * - digital_signature
 * - assign_role
 * - revoke_permission
 */
@Injectable()
export class SpidStepUpGuard implements CanActivate {
  private readonly logger = new Logger(SpidStepUpGuard.name);
  private readonly STEP_UP_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

  // High-risk actions requiring step-up authentication
  private readonly HIGH_RISK_ACTIONS = new Set([
    'delete_fir',
    'approve_user',
    'digital_signature',
    'assign_role',
    'revoke_permission',
    'grant_temp_permission',
    'modify_system_role',
  ]);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Get audit action from decorator metadata
    const auditAction = this.reflector.getAllAndOverride<string>(
      AUDIT_ACTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no @AuditAction decorator or action is not high-risk, allow access
    if (!auditAction || !this.HIGH_RISK_ACTIONS.has(auditAction)) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    // Check if user has lastSpidAuthTimestamp (set by SPID strategy on login)
    const lastSpidAuth = user.lastSpidAuthTimestamp;

    if (!lastSpidAuth) {
      this.logger.warn(
        `User ${user.userId} attempting high-risk action '${auditAction}' without SPID timestamp`,
      );
      throw new UnauthorizedException({
        message: 'SPID authentication required for this operation',
        action: auditAction,
        requiresStepUp: true,
        spidAuthUrl: '/api/auth/spid/login',
      });
    }

    // Calculate time elapsed since last SPID authentication
    const now = Date.now();
    const timeSinceAuth = now - lastSpidAuth;

    if (timeSinceAuth > this.STEP_UP_THRESHOLD_MS) {
      const minutesSinceAuth = Math.floor(timeSinceAuth / 60000);

      this.logger.warn(
        `⚠️  Step-up required: User ${user.userId} attempting '${auditAction}' ` +
          `after ${minutesSinceAuth} minutes (threshold: 15 minutes)`,
      );

      throw new UnauthorizedException({
        message:
          'Your session has expired for high-risk operations. Please re-authenticate via SPID.',
        action: auditAction,
        requiresStepUp: true,
        minutesSinceAuth,
        spidAuthUrl: '/api/auth/spid/login',
        returnUrl: request.url,
      });
    }

    // Log successful step-up validation
    this.logger.debug(
      `Step-up check passed for user ${user.userId}, action '${auditAction}' ` +
        `(${Math.floor(timeSinceAuth / 60000)}m since auth)`,
    );

    return true;
  }
}
