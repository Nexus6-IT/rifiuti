import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  Logger,
  Inject,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { TenantContext } from '../../core/context/tenant-context'
import { AZIENDA_PIATTAFORMA_ID } from '../../core/context/azienda-piattaforma'
import { aziendaCandidataDaHeader } from '../../core/context/azienda-da-header'
import { VERIFICA_AZIENDA_NON_DISPONIBILE } from '../../core/context/azienda-selezionata-errori'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { InjectQueue } from '@nestjs/bullmq'
import { Queue } from 'bullmq'
import { PERMISSION_KEY } from '../decorators/require-permission.decorator'
import { PermissionCacheService } from '../../infrastructure/cache/permission-cache.service'
import { PermissionAuditLogRepository } from '../../domain/identity-access/permission-audit-log.repository.interface'
import { AuditMetadata } from '../../domain/identity-access/value-objects/audit-metadata.vo'
import {
  AbacPolicyEvaluator,
  EvaluationContext,
} from '../../domain/identity-access/abac/abac-policy-evaluator.service'
import { AbacPolicyRepository } from '../../domain/identity-access/abac/abac-policy.repository.interface'
import { UserRoleRepository } from '../../domain/identity-access/user-role.repository.interface'
import { PermissionRepository } from '../../domain/identity-access/permission.repository.interface'

/**
 * TTL (secondi) della voce di cache dei permessi di un consulente su un'azienda cliente.
 * Breve di proposito: la modifica o la revoca dell'associazione (`consultant_tenant_associations`)
 * oggi non invalida la cache, e un ruolo dello studio modificato invalida solo le voci dello
 * studio. La scadenza e' quindi l'unico limite alla persistenza di permessi non piu' validi
 * (l'accesso all'azienda e' comunque riverificato a ogni richiesta).
 */
const TTL_PERMESSI_CONSULENTE_SECONDI = 60

/**
 * PermissionGuard
 * Enforces permission checks on endpoints with @RequirePermission decorator
 * Implements cache lookup and ABAC policy evaluation per plan.md
 * T224: Integrated ABAC policy evaluation after RBAC check
 * Target: <10ms P99 latency (including <5ms ABAC overhead)
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name)

  constructor(
    private reflector: Reflector,
    private permissionCache: PermissionCacheService,
    @Inject('PermissionAuditLogRepository')
    private auditLogRepository: PermissionAuditLogRepository,
    @InjectQueue('audit-logging') private readonly auditQueue: Queue,
    private abacEvaluator: AbacPolicyEvaluator,
    @Inject('AbacPolicyRepository')
    private abacPolicyRepository: AbacPolicyRepository,
    @Inject('UserRoleRepository')
    private userRoleRepository: UserRoleRepository,
    @Inject('PermissionRepository')
    private permissionRepository: PermissionRepository,
    private readonly ruoloEffettivo: RuoloEffettivoService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const startTime = Date.now()

    // Get required permission from decorator metadata
    const requiredPermission = this.reflector.getAllAndOverride<string>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    // If no @RequirePermission decorator, allow access
    if (!requiredPermission) {
      return true
    }

    const request = context.switchToHttp().getRequest()
    const user = request.user

    if (!user) {
      throw new ForbiddenException('Authentication required')
    }

    // BUG CRITICO (trovato durante la verifica dal vivo P4, 2026-07-25):
    // `request.user` è popolato da JwtStrategy con la proprietà `id` (vedi
    // `CurrentUserPayload`), MAI `userId`. Il precedente `const { userId,
    // tenantId } = user` risolveva quindi sempre `userId === undefined`,
    // rendendo la cache dei permessi chiave su `(tenantId, undefined)` —
    // CONDIVISA da tutti gli utenti dello stesso tenant. Il primo utente che
    // popolava la cache (es. un ADMIN) "regalava" i propri permessi a
    // qualunque altro utente dello stesso tenant fino a scadenza/invalidazione
    // della cache: escalation di privilegi cross-utente all'interno del
    // tenant. Corretto leggendo `user.id`.
    const { id: userId, tenantId } = user

    // Azienda su cui opera la richiesta e permessi da valutare.
    //
    // SUPER_ADMIN: con `X-Tenant-ID` (il middleware lo onora per lui) conta l'azienda scelta
    // per l'audit, senza header le sue azioni vanno all'azienda tecnica "piattaforma". I permessi
    // restano quelli dell'azienda di casa (le assegnazioni di ruolo stanno li', non nell'azienda
    // scelta).
    //
    // Altri utenti: questo guard gira PRIMA del TenantSwitchInterceptor, che convalida l'header,
    // quindi l'azienda selezionata (`aziendaCandidataDaHeader`) la verifica da se' con
    // `RuoloEffettivoService`, la stessa risoluzione dell'interceptor:
    //  - associazione consulente valida: i permessi sono quelli del ruolo `role_id`
    //    dell'associazione, NON quelli che il consulente ha a casa (un ADMIN del proprio studio
    //    presso un cliente con un ruolo di sola consultazione non puo' scrivere);
    //  - altri legami (azienda di proprieta', figlia -> madre): permessi dell'azienda primaria;
    //  - nessun legame: si decide come col token (permessi di casa); l'interceptor respinge con
    //    403, oppure la rotta `@ConsentiSelezioneNonValida` prosegue sull'azienda primaria.
    // L'audit va all'azienda su cui opera la richiesta (candidata con accesso, altrimenti token).
    // Se la verifica non e' possibile (database irraggiungibile): 503, come l'interceptor
    // (fail-closed, mai 500, mai via libera).
    const isSuperAdmin = user.role === 'SUPER_ADMIN'
    const aziendaScelta = isSuperAdmin ? this.aziendaDaHeader(request) : null
    let aziendaAudit: string = isSuperAdmin ? (aziendaScelta ?? AZIENDA_PIATTAFORMA_ID) : tenantId
    let aziendaConsulente: string | null = null
    let ruoloAssociazioneId: string | null = null
    const candidata = aziendaCandidataDaHeader(request)
    if (candidata) {
      let accesso
      try {
        accesso = await this.ruoloEffettivo.accessoConOrigine(user, candidata)
      } catch {
        throw new ServiceUnavailableException({ ...VERIFICA_AZIENDA_NON_DISPONIBILE })
      }
      if (accesso) {
        aziendaAudit = candidata
        if (accesso.roleId) {
          aziendaConsulente = candidata
          ruoloAssociazioneId = accesso.roleId
        }
      }
    }

    try {
      // Step 1: Check cache for user permissions.
      // Chiave `(azienda, utente)`. I permessi di casa stanno sotto `(casa, utente)`. Quelli
      // dell'associazione del consulente presso il cliente stanno in uno spazio PROPRIO,
      // `(cliente, "assoc:<utente>")`: la voce `(cliente, utente)` e' scritta da
      // `GetUserPermissionsQueryHandler` (assegnazioni dirette nel cliente, TTL 300s) e ha un
      // altro significato; riusarla farebbe negare o concedere per errore. Il prefisso per
      // azienda resta quello di `invalidateTenant(cliente)`, che quindi colpisce anche questa.
      const aziendaCache = aziendaConsulente ?? tenantId
      const utenteCache = aziendaConsulente ? `assoc:${userId}` : userId
      let userPermissions = await this.permissionCache.getPermissions(aziendaCache, utenteCache)

      // Step 2: On cache miss, load the user's effective permissions from the
      // database (RBAC source of truth), then populate the cache. A cache miss
      // must NEVER blindly deny a legitimate user.
      if (!userPermissions) {
        this.logger.debug(`Cache miss for user ${userId} - fetching from database`)
        // Il super admin con header ha nel contesto l'azienda scelta: le sue assegnazioni di ruolo
        // (azienda di casa) con la RLS attiva non si vedrebbero. Si leggono nel contesto di casa.
        if (ruoloAssociazioneId) {
          try {
            userPermissions = await this.ruoloEffettivo.permessiDelRuolo(ruoloAssociazioneId)
          } catch (error) {
            // Stesso esito dell'errore su `accessoConOrigine`: 503, mai 403 generico ne' via
            // libera. Il dettaglio resta nel log, non nel corpo della risposta.
            this.logger.error(
              `Lettura permessi del ruolo di associazione non riuscita per user ${userId}: ${(error as Error)?.message}`
            )
            throw new ServiceUnavailableException({ ...VERIFICA_AZIENDA_NON_DISPONIBILE })
          }
        } else {
          userPermissions =
            aziendaScelta && tenantId
              ? await TenantContext.run(
                  { tenantId, userId, isSuperAdmin: true },
                  async () => await this.loadPermissionsFromDb(userId, tenantId)
                )
              : await this.loadPermissionsFromDb(userId, tenantId)
        }

        // Populate the cache so subsequent requests hit the fast path.
        // Cache write failures must not break the authorization decision.
        await this.permissionCache
          .setPermissions(
            aziendaCache,
            utenteCache,
            userPermissions,
            ...(aziendaConsulente ? [TTL_PERMESSI_CONSULENTE_SECONDI] : [])
          )
          .catch(error => {
            this.logger.error(
              `Failed to populate permission cache for user ${userId}: ${error.message}`,
              error.stack
            )
          })
      }

      // Step 3: Check if user has required permission (RBAC)
      const hasRbacPermission = this.checkPermission(userPermissions, requiredPermission)

      let finalDecision: 'ALLOW' | 'DENY' = hasRbacPermission ? 'ALLOW' : 'DENY'
      let evaluatedPolicies: any[] | undefined
      let abacEvaluationTimeMs = 0

      // Step 4: ABAC evaluation (T224) - only if RBAC passes
      if (hasRbacPermission) {
        const [resourceType, action] = requiredPermission.split(':')

        const abacStartTime = performance.now()
        const policies = await this.abacPolicyRepository.findActiveByResourceType(resourceType)

        if (policies.length > 0) {
          const evaluationContext: EvaluationContext = {
            user: {
              id: userId,
              tenantId,
              ...user, // Include all user attributes
            },
            // SECURITY: never spread the raw request body into the resource
            // attributes — it is fully attacker-controlled and would let a
            // client spoof ABAC decisions (e.g. forge ownerId/isApproved).
            // Only derive trusted identifiers from the route params. Real
            // resource attributes must be loaded server-side from a trusted
            // store before they can be used for authorization; until such a
            // loader exists, expose only the resource id from the route.
            resource: this.extractResourceAttributes(resourceType, request),
            action,
            environment: {
              timestamp: new Date(),
              ip: request.ip,
            },
          }

          const abacResult = await this.abacEvaluator.evaluate(policies, evaluationContext)
          abacEvaluationTimeMs = abacResult.totalEvaluationTimeMs
          evaluatedPolicies = abacResult.evaluatedPolicies

          // ABAC can override RBAC (DENY takes precedence)
          if (abacResult.decision === 'DENY') {
            finalDecision = 'DENY'
            this.logger.debug(
              `ABAC policy DENIED access for user ${userId} on ${resourceType}:${action}`
            )
          }
        }
        const abacEndTime = performance.now()
        abacEvaluationTimeMs = abacEndTime - abacStartTime
      }

      const duration = Date.now() - startTime
      this.logger.debug(
        `Permission check for ${userId}: ${requiredPermission} = ${finalDecision} (${duration}ms, ABAC: ${abacEvaluationTimeMs.toFixed(2)}ms)`
      )

      // T149: Log permission check to audit trail (asynchronous, non-blocking)
      const decision = finalDecision
      const reason =
        finalDecision === 'DENY'
          ? hasRbacPermission
            ? 'ABAC policy denied access'
            : 'User does not have required permission'
          : undefined

      // Extract audit metadata from request
      // Codice fiscale dell'utente e sessione ricavata dal token (v. JwtStrategy): colonne NOT NULL.
      const auditMetadata = AuditMetadata.fromRequest({
        sessionId: request.session?.id ?? user.sessionId,
        ip: request.ip,
        headers: request.headers,
        user: {
          spidFiscalCode: user.fiscalCode ?? user.spidFiscalCode,
        },
      })

      // Parse resource info from permission (format: resource:action:scope)
      const [resourceType, _action] = requiredPermission.split(':')

      // Log asynchronously (non-blocking - <1ms overhead)
      this.logAuditEntry(
        userId,
        aziendaAudit,
        requiredPermission,
        resourceType,
        decision,
        reason,
        auditMetadata,
        evaluatedPolicies // T224: Include ABAC policy evaluation results
      ).catch(error => {
        this.logger.error(`Failed to log audit entry: ${error.message}`, error.stack)
        // Don't throw - audit logging failure should not break permission checks
      })

      if (finalDecision === 'DENY') {
        throw new ForbiddenException({
          message: 'Insufficient permissions',
          requiredPermission,
          currentRole: user.role || 'unknown',
          contactAdmin: 'Contact your administrator to request access',
        })
      }

      return true
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof ServiceUnavailableException) {
        throw error
      }

      this.logger.error(`Permission check error for user ${userId}:`, error)
      throw new ForbiddenException('Permission check failed')
    }
  }

  /**
   * Load the user's effective permission strings from the database.
   *
   * Resolves all active (non-expired, non-revoked) role assignments for the
   * user within the tenant, then expands each role into its permission strings
   * in `resource:action:scope` format. Used as the authoritative fallback on a
   * permission cache miss so legitimate users are never blindly denied.
   */
  private async loadPermissionsFromDb(userId: string, tenantId: string): Promise<string[]> {
    const activeUserRoles = await this.userRoleRepository.findActiveByUserId(userId, tenantId)

    if (!activeUserRoles || activeUserRoles.length === 0) {
      return []
    }

    // De-duplicate role ids (a user could hold the same role via multiple
    // assignments, e.g. facility-scoped duplicates).
    const roleIds = Array.from(new Set(activeUserRoles.map(userRole => userRole.roleId)))

    const permissionSet = new Set<string>()

    await Promise.all(
      roleIds.map(async roleId => {
        const permissions = await this.permissionRepository.findByRole(roleId)
        for (const permission of permissions) {
          permissionSet.add(permission.toString())
        }
      })
    )

    return Array.from(permissionSet)
  }

  /**
   * Build the ABAC resource attribute set from TRUSTED inputs only.
   *
   * SECURITY: the request body is fully attacker-controlled and must never feed
   * an authorization decision. Only the resource id derived from the route
   * params is exposed here. Any additional resource attribute (ownerId,
   * approval state, etc.) must be loaded server-side from a trusted store
   * before being used; this method intentionally returns the minimal safe set.
   */
  private extractResourceAttributes(resourceType: string, request: any): Record<string, unknown> {
    const resource: Record<string, unknown> = { type: resourceType }

    const routeId = request?.params?.id
    if (typeof routeId === 'string' && routeId.length > 0) {
      resource.id = routeId
    }

    return resource
  }

  /**
   * Check if user has required permission
   * Supports wildcard matching and scope hierarchy
   */
  private checkPermission(userPermissions: string[], requiredPermission: string): boolean {
    // Exact match
    if (userPermissions.includes(requiredPermission)) {
      return true
    }

    // Parse permission format: resource:action:scope
    const [reqResource, reqAction, reqScope] = requiredPermission.split(':')

    // Check for broader scope permissions
    // Example: user has "fir:read:all", endpoint requires "fir:read:facility"
    const scopeHierarchy = ['own', 'facility', 'all']
    const reqScopeLevel = scopeHierarchy.indexOf(reqScope)

    for (const userPerm of userPermissions) {
      const [userResource, userAction, userScope] = userPerm.split(':')

      // Must match resource and action
      if (userResource !== reqResource || userAction !== reqAction) {
        continue
      }

      // Check if user scope is broader or equal
      const userScopeLevel = scopeHierarchy.indexOf(userScope)
      if (userScopeLevel >= reqScopeLevel) {
        return true
      }
    }

    return false
  }

  /** Azienda scelta con `X-Tenant-ID` (solo UUID validi), oppure null. */
  private aziendaDaHeader(request: any): string | null {
    // Un solo parser dell'header: quello di `aziendaCandidataDaHeader`, che esclude il
    // SUPER_ADMIN e l'azienda di casa. Qui serve proprio per il SUPER_ADMIN, senza confronto con
    // l'azienda di casa: lo si chiama con un utente neutro e senza tenant.
    return aziendaCandidataDaHeader({ headers: request?.headers, user: { role: 'ADMIN' } })
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
    evaluatedPolicies?: any[]
  ): Promise<void> {
    // Le righe di audit sono per azienda (per il super admin senza azienda scelta e' gia' la
    // piattaforma): senza azienda l'evento non si accoda.
    if (!tenantId) {
      this.logger.debug('[AUDIT] Evento non accodato: nessuna azienda nel contesto')
      return
    }

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
        }
      )

      this.logger.debug(
        `[AUDIT] Queued permission check: user=${userId}, action=${actionAttempted}, decision=${decision}`
      )
    } catch (error) {
      this.logger.error(`Failed to queue audit entry: ${error.message}`, error.stack)
      // Don't throw - audit logging failure should not break permission checks
    }
  }
}
