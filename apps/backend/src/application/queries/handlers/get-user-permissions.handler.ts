import { Injectable, Logger } from '@nestjs/common'
import { GetUserPermissionsQuery } from '../get-user-permissions.query'
import { UserRoleRepository } from '../../../domain/identity-access/user-role.repository.interface'
import { RoleRepository } from '../../../domain/identity-access/role.repository.interface'
import { PermissionRepository } from '../../../domain/identity-access/permission.repository.interface'
import { TemporaryPermissionGrantRepository } from '../../../domain/identity-access/temporary-permission-grant.repository.interface'
import { PermissionCacheService } from '../../../infrastructure/cache/permission-cache.service'

/**
 * GetUserPermissionsQueryHandler
 * Retrieves user's effective permissions from roles
 * Per plan.md FR-001: Cache-first with <10ms P99 latency target
 *
 * Returns union of permissions from all active roles + temp permissions
 */
@Injectable()
export class GetUserPermissionsQueryHandler {
  private readonly logger = new Logger(GetUserPermissionsQueryHandler.name)
  private readonly CACHE_TTL = 300 // 5 minutes

  constructor(
    private readonly userRoleRepository: UserRoleRepository,
    private readonly roleRepository: RoleRepository,
    private readonly permissionRepository: PermissionRepository,
    private readonly permissionCache: PermissionCacheService,
    private readonly temporaryPermissionGrantRepository: TemporaryPermissionGrantRepository
  ) {}

  async execute(query: GetUserPermissionsQuery): Promise<{
    permissions: string[]
    facilityIds: string[]
    source: 'cache' | 'database'
  }> {
    const startTime = Date.now()

    // Step 1: Check cache first (for performance)
    const cachedPermissions = await this.permissionCache.getPermissions(
      query.tenantId,
      query.userId
    )

    if (cachedPermissions) {
      const duration = Date.now() - startTime
      this.logger.debug(`Cache hit for user ${query.userId} (${duration}ms)`)

      return {
        permissions: cachedPermissions,
        // NB: la cache permessi memorizza solo le stringhe permesso, non gli
        // scope per-facility. Su cache hit i facilityIds non sono disponibili
        // (estendere il valore di cache richiederebbe una modifica di schema in
        // PermissionCacheService). Chi necessita lo scoping per facility deve
        // richiedere il path DB (cache miss) o interrogare le assegnazioni.
        facilityIds: [],
        source: 'cache',
      }
    }

    // Step 2: Cache miss - fetch from database
    this.logger.debug(`Cache miss for user ${query.userId} - fetching from database`)

    // Get user's active role assignments
    const userRoles = await this.userRoleRepository.findActiveByUserId(query.userId, query.tenantId)

    if (userRoles.length === 0) {
      // User has no roles - cache empty result
      await this.permissionCache.setPermissions(query.tenantId, query.userId, [], this.CACHE_TTL)

      return {
        permissions: [],
        facilityIds: [],
        source: 'database',
      }
    }

    // Step 3: Collect facility IDs from all roles
    const facilityIds = new Set<string>()
    for (const userRole of userRoles) {
      if (userRole.facilityIds) {
        userRole.facilityIds.forEach(id => facilityIds.add(id))
      }
    }

    // Step 4: Get permissions for all roles
    const permissionSet = new Set<string>()

    for (const userRole of userRoles) {
      const permissions = await this.permissionRepository.findByRole(userRole.roleId)

      permissions.forEach(permission => {
        permissionSet.add(permission.toString())
      })
    }

    // Step 5: Include temporary permissions if requested
    if (query.includeTempPermissions) {
      const activeGrants = await this.temporaryPermissionGrantRepository.findActiveByUser(
        query.userId,
        query.tenantId
      )
      for (const grant of activeGrants) {
        // Sicurezza: aggiungi solo i grant effettivamente attivi (non scaduti/
        // non revocati), così i permessi temporanei vengono concessi solo nella
        // loro finestra di validità.
        if (grant.isActive()) {
          grant.permissions.forEach(perm => permissionSet.add(perm))
        }
      }
      if (activeGrants.length > 0) {
        this.logger.debug(
          `Added ${activeGrants.length} temporary grant(s) for user ${query.userId}`
        )
      }
    }

    // Step 6: Convert to array and cache
    const permissionsArray = Array.from(permissionSet)

    await this.permissionCache.setPermissions(
      query.tenantId,
      query.userId,
      permissionsArray,
      this.CACHE_TTL
    )

    const duration = Date.now() - startTime
    this.logger.log(
      `Fetched ${permissionsArray.length} permissions for user ${query.userId} (${duration}ms)`
    )

    return {
      permissions: permissionsArray,
      facilityIds: Array.from(facilityIds),
      source: 'database',
    }
  }
}
