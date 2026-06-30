import { ExecutionContext, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PermissionGuard } from './permission.guard'
import { UserRole } from '../../domain/identity-access/user-role.entity'
import { Permission } from '../../domain/identity-access/permission.entity'

/**
 * PermissionGuard unit tests
 *
 * Security focus (P0):
 *  1. Cache MISS must NOT blindly deny: the guard must load permissions from the
 *     database (UserRoleRepository + PermissionRepository), populate the cache and
 *     then evaluate. A legitimate user with a valid DB permission but an empty
 *     cache must be AUTHORIZED.
 *  2. ABAC resource attributes must NOT be built by spreading the raw request body
 *     (spoofable). The body must never influence the authorization decision.
 */
describe('PermissionGuard', () => {
  let guard: PermissionGuard

  // Mocks
  let reflector: jest.Mocked<Reflector>
  let permissionCache: any
  let auditLogRepository: any
  let auditQueue: any
  let abacEvaluator: any
  let abacPolicyRepository: any
  let userRoleRepository: any
  let permissionRepository: any

  const TENANT_ID = 'tenant-1'
  const USER_ID = 'user-1'

  const buildContext = (overrides: Partial<any> = {}): ExecutionContext => {
    const request = {
      user: { userId: USER_ID, tenantId: TENANT_ID, role: 'OPERATOR' },
      body: {},
      params: {},
      headers: {},
      ip: '127.0.0.1',
      ...overrides,
    }

    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext
  }

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>

    permissionCache = {
      getPermissions: jest.fn(),
      setPermissions: jest.fn().mockResolvedValue(undefined),
    }

    auditLogRepository = {}

    auditQueue = {
      add: jest.fn().mockResolvedValue(undefined),
    }

    abacEvaluator = {
      evaluate: jest.fn(),
    }

    abacPolicyRepository = {
      findActiveByResourceType: jest.fn().mockResolvedValue([]),
    }

    userRoleRepository = {
      findActiveByUserId: jest.fn().mockResolvedValue([]),
    }

    permissionRepository = {
      findByRole: jest.fn().mockResolvedValue([]),
    }

    guard = new PermissionGuard(
      reflector,
      permissionCache,
      auditLogRepository,
      auditQueue,
      abacEvaluator,
      abacPolicyRepository,
      userRoleRepository,
      permissionRepository
    )
  })

  it('allows access when no @RequirePermission decorator is present', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined as any)

    await expect(guard.canActivate(buildContext())).resolves.toBe(true)
  })

  it('throws ForbiddenException when no authenticated user is present', async () => {
    reflector.getAllAndOverride.mockReturnValue('fir:read:facility' as any)

    await expect(guard.canActivate(buildContext({ user: undefined }))).rejects.toBeInstanceOf(
      ForbiddenException
    )
  })

  it('grants access on cache HIT when permission is present', async () => {
    reflector.getAllAndOverride.mockReturnValue('fir:read:facility' as any)
    permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

    await expect(guard.canActivate(buildContext())).resolves.toBe(true)
    // No DB fallback needed on a cache hit
    expect(userRoleRepository.findActiveByUserId).not.toHaveBeenCalled()
  })

  describe('cache MISS -> DB fallback (P0 bug #1)', () => {
    it('loads permissions from DB and AUTHORIZES a legitimate user when cache is empty', async () => {
      reflector.getAllAndOverride.mockReturnValue('fir:read:facility' as any)
      // Cache empty
      permissionCache.getPermissions.mockResolvedValue(null)

      // DB: user has one active role granting the required permission
      const userRole = UserRole.create({
        userId: USER_ID,
        roleId: 'role-1',
        tenantId: TENANT_ID,
        assignedBy: 'admin-1',
      })
      userRoleRepository.findActiveByUserId.mockResolvedValue([userRole])

      const permission = Permission.fromString(
        'fir:read:facility',
        'Read FIR at facility scope',
        'FIR'
      )
      permissionRepository.findByRole.mockResolvedValue([permission])

      await expect(guard.canActivate(buildContext())).resolves.toBe(true)

      // It must have consulted the DB on the cache miss
      expect(userRoleRepository.findActiveByUserId).toHaveBeenCalledWith(USER_ID, TENANT_ID)
      expect(permissionRepository.findByRole).toHaveBeenCalledWith('role-1')

      // It must have populated the cache with the loaded permissions
      expect(permissionCache.setPermissions).toHaveBeenCalledWith(
        TENANT_ID,
        USER_ID,
        expect.arrayContaining(['fir:read:facility'])
      )
    })

    it('denies access on cache miss when the DB grants no matching permission', async () => {
      reflector.getAllAndOverride.mockReturnValue('fir:delete:all' as any)
      permissionCache.getPermissions.mockResolvedValue(null)

      const userRole = UserRole.create({
        userId: USER_ID,
        roleId: 'role-1',
        tenantId: TENANT_ID,
        assignedBy: 'admin-1',
      })
      userRoleRepository.findActiveByUserId.mockResolvedValue([userRole])
      permissionRepository.findByRole.mockResolvedValue([
        Permission.fromString('fir:read:own', 'desc', 'FIR'),
      ])

      await expect(guard.canActivate(buildContext())).rejects.toBeInstanceOf(ForbiddenException)
      // Still must have attempted the DB load (no blind deny)
      expect(userRoleRepository.findActiveByUserId).toHaveBeenCalled()
    })
  })

  describe('ABAC must not trust the request body (P0 bug #2)', () => {
    it('does not pass spoofed body attributes into the ABAC evaluation context', async () => {
      reflector.getAllAndOverride.mockReturnValue('fir:read:facility' as any)
      permissionCache.getPermissions.mockResolvedValue(['fir:read:facility'])

      // Active ABAC policy so the evaluator gets invoked
      abacPolicyRepository.findActiveByResourceType.mockResolvedValue([{ id: 'policy-1' }])
      abacEvaluator.evaluate.mockResolvedValue({
        decision: 'ALLOW',
        totalEvaluationTimeMs: 1,
        evaluatedPolicies: [],
      })

      // Attacker tries to inject ownerId into the body to spoof ABAC
      const context = buildContext({
        body: { ownerId: 'attacker-controlled', isApproved: true },
        params: { id: 'resource-9' },
      })

      await guard.canActivate(context)

      expect(abacEvaluator.evaluate).toHaveBeenCalledTimes(1)
      const evaluationContext = abacEvaluator.evaluate.mock.calls[0][1]

      // The spoofed body values must NOT leak into the resource attributes
      expect(evaluationContext.resource.ownerId).not.toBe('attacker-controlled')
      expect(evaluationContext.resource.isApproved).toBeUndefined()
    })
  })
})
