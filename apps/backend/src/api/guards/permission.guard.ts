import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionCacheService } from '../../infrastructure/cache/permission-cache.service';
import { PermissionAuditLogRepository } from '../../domain/identity-access/permission-audit-log.repository.interface';
import { AuditMetadata } from '../../domain/identity-access/value-objects/audit-metadata.vo';
import { AbacPolicyEvaluator, EvaluationContext } from '../../domain/identity-access/abac/abac-policy-evaluator.service';
import { AbacPolicyRepository } from '../../domain/identity-access/abac/abac-policy.repository.interface';

/**
 * PermissionGuard
 * Enforces permission checks on endpoints with @RequirePermission decorator
 * Implements cache lookup and ABAC policy evaluation per plan.md
 * T224: Integrated ABAC policy evaluation after RBAC check
 * Target: <10ms P99 latency (including <5ms ABAC overhead)
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private reflector: Reflector,
    private permissionCache: PermissionCacheService,
    @Inject('PermissionAuditLogRepository')
    private auditLogRepository: PermissionAuditLogRepository,
    @InjectQueue('audit-logging') private readonly auditQueue: Queue,
    private abacEvaluator: AbacPolicyEvaluator,
    @Inject('AbacPolicyRepository')
    private abacPolicyRepository: AbacPolicyRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const startTime = Date.now();

    // Get required permission from decorator metadata
    const requiredPermission = this.reflector.getAllAndOverride<string>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no @RequirePermission decorator, allow access
    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const { userId, tenantId } = user;

    try {
      // Step 1: Check cache for user permissions
      let userPermissions = await this.permissionCache.getPermissions(
        tenantId,
        userId,
      );

      // Step 2: If cache miss, fetch from database (TODO: implement in Phase 3)
      if (!userPermissions) {
        this.logger.debug(
          `Cache miss for user ${userId} - fetching from database`,
        );
        // TODO Phase 3: Query UserRoleRepository + PermissionRepository
        // For now, deny access
        userPermissions = [];
      }

      // Step 3: Check if user has required permission (RBAC)
      const hasRbacPermission = this.checkPermission(
        userPermissions,
        requiredPermission,
      );

      let finalDecision: 'ALLOW' | 'DENY' = hasRbacPermission ? 'ALLOW' : 'DENY';
      let evaluatedPolicies: any[] | undefined;
      let abacEvaluationTimeMs = 0;

      // Step 4: ABAC evaluation (T224) - only if RBAC passes
      if (hasRbacPermission) {
        const [resourceType, action] = requiredPermission.split(':');

        const abacStartTime = performance.now();
        const policies = await this.abacPolicyRepository.findActiveByResourceType(resourceType);

        if (policies.length > 0) {
          const evaluationContext: EvaluationContext = {
            user: {
              id: userId,
              tenantId,
              ...user, // Include all user attributes
            },
            resource: {
              type: resourceType,
              // TODO: Extract resource attributes from request body/params
              ...request.body,
              ...request.params,
            },
            action,
            environment: {
              timestamp: new Date(),
              ip: request.ip,
            },
          };

          const abacResult = await this.abacEvaluator.evaluate(policies, evaluationContext);
          abacEvaluationTimeMs = abacResult.totalEvaluationTimeMs;
          evaluatedPolicies = abacResult.evaluatedPolicies;

          // ABAC can override RBAC (DENY takes precedence)
          if (abacResult.decision === 'DENY') {
            finalDecision = 'DENY';
            this.logger.debug(
              `ABAC policy DENIED access for user ${userId} on ${resourceType}:${action}`,
            );
          }
        }
        const abacEndTime = performance.now();
        abacEvaluationTimeMs = abacEndTime - abacStartTime;
      }

      const duration = Date.now() - startTime;
      this.logger.debug(
        `Permission check for ${userId}: ${requiredPermission} = ${finalDecision} (${duration}ms, ABAC: ${abacEvaluationTimeMs.toFixed(2)}ms)`,
      );

      // T149: Log permission check to audit trail (asynchronous, non-blocking)
      const decision = finalDecision;
      const reason = finalDecision === 'DENY'
        ? (hasRbacPermission ? 'ABAC policy denied access' : 'User does not have required permission')
        : undefined;

      // Extract audit metadata from request
      const auditMetadata = AuditMetadata.fromRequest({
        sessionId: request.session?.id,
        ip: request.ip,
        headers: request.headers,
        user: {
          spidFiscalCode: user.spidFiscalCode,
        },
      });

      // Parse resource info from permission (format: resource:action:scope)
      const [resourceType, action] = requiredPermission.split(':');

      // Log asynchronously (non-blocking - <1ms overhead)
      this.logAuditEntry(
        userId,
        tenantId,
        requiredPermission,
        resourceType,
        decision,
        reason,
        auditMetadata,
        evaluatedPolicies, // T224: Include ABAC policy evaluation results
      ).catch((error) => {
        this.logger.error(`Failed to log audit entry: ${error.message}`, error.stack);
        // Don't throw - audit logging failure should not break permission checks
      });

      if (finalDecision === 'DENY') {
        throw new ForbiddenException({
          message: 'Insufficient permissions',
          requiredPermission,
          currentRole: user.role || 'unknown',
          contactAdmin: 'Contact your administrator to request access',
        });
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      this.logger.error(
        `Permission check error for user ${userId}:`,
        error,
      );
      throw new ForbiddenException('Permission check failed');
    }
  }

  /**
   * Check if user has required permission
   * Supports wildcard matching and scope hierarchy
   */
  private checkPermission(
    userPermissions: string[],
    requiredPermission: string,
  ): boolean {
    // Exact match
    if (userPermissions.includes(requiredPermission)) {
      return true;
    }

    // Parse permission format: resource:action:scope
    const [reqResource, reqAction, reqScope] = requiredPermission.split(':');

    // Check for broader scope permissions
    // Example: user has "fir:read:all", endpoint requires "fir:read:facility"
    const scopeHierarchy = ['own', 'facility', 'all'];
    const reqScopeLevel = scopeHierarchy.indexOf(reqScope);

    for (const userPerm of userPermissions) {
      const [userResource, userAction, userScope] = userPerm.split(':');

      // Must match resource and action
      if (userResource !== reqResource || userAction !== reqAction) {
        continue;
      }

      // Check if user scope is broader or equal
      const userScopeLevel = scopeHierarchy.indexOf(userScope);
      if (userScopeLevel >= reqScopeLevel) {
        return true;
      }
    }

    return false;
  }

  /**
   * Log audit entry asynchronously
   * T149: Log all permission checks via BullMQ with <1ms overhead
   * T224: Include ABAC policy evaluation results
   * Uses cryptographic chaining for tamper detection
   */
  private async logAuditEntry(
    userId: string,
    tenantId: string,
    actionAttempted: string,
    resourceType: string,
    decision: 'ALLOW' | 'DENY',
    reason: string | undefined,
    auditMetadata: AuditMetadata,
    evaluatedPolicies?: any[],
  ): Promise<void> {
    try {
      // Queue permission check audit event (async, <1ms overhead)
      await this.auditQueue.add(
        'permission-check',
        {
          type: 'permission-check',
          data: {
            userId,
            tenantId,
            actionAttempted,
            resourceType,
            resourceId: undefined, // Not available in guard context
            decision,
            reason,
            spidFiscalCode: auditMetadata.spidFiscalCode,
            sessionId: auditMetadata.sessionId,
            ipAddress: auditMetadata.ipAddress,
            userAgent: auditMetadata.userAgent,
            timestamp: new Date().toISOString(),
            evaluatedPolicies: evaluatedPolicies || undefined, // T224: ABAC policy evaluation results
            contextAttributes: undefined,
          },
        },
        {
          attempts: 3, // Retry up to 3 times
          backoff: {
            type: 'exponential',
            delay: 1000, // Start with 1 second
          },
        },
      );

      this.logger.debug(
        `[AUDIT] Queued permission check: user=${userId}, action=${actionAttempted}, decision=${decision}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to queue audit entry: ${error.message}`,
        error.stack,
      );
      // Don't throw - audit logging failure should not break permission checks
    }
  }
}
