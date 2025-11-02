/**
 * Roles Guard - TDD Tests
 * Guard for checking user roles against required roles
 */

import { RolesGuard } from './roles.guard'
import { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

describe('RolesGuard', () => {
  let guard: RolesGuard
  let reflector: jest.Mocked<Reflector>

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as any

    guard = new RolesGuard(reflector)
  })

  const createMockExecutionContext = (
    requiredRoles: string[] | null,
    userRole: string | null
  ): ExecutionContext => {
    reflector.getAllAndOverride.mockReturnValue(requiredRoles)

    const mockHandler = jest.fn()
    const mockClass = jest.fn()

    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user: userRole ? { id: 'user-123', role: userRole } : null,
        }),
      }),
      getHandler: () => mockHandler,
      getClass: () => mockClass,
    } as any
  }

  describe('canActivate', () => {
    it('should allow access if no roles are required', () => {
      const context = createMockExecutionContext(null, 'VIEWER')

      const result = guard.canActivate(context)

      expect(result).toBe(true)
    })

    it('should allow access if route has empty roles array', () => {
      const context = createMockExecutionContext([], 'VIEWER')

      const result = guard.canActivate(context)

      expect(result).toBe(true)
    })

    it('should deny access if user is not authenticated', () => {
      const context = createMockExecutionContext(['ADMIN'], null)

      const result = guard.canActivate(context)

      expect(result).toBe(false)
    })

    it('should allow access if user has required role', () => {
      const context = createMockExecutionContext(['ADMIN'], 'ADMIN')

      const result = guard.canActivate(context)

      expect(result).toBe(true)
    })

    it('should deny access if user does not have required role', () => {
      const context = createMockExecutionContext(['ADMIN'], 'VIEWER')

      const result = guard.canActivate(context)

      expect(result).toBe(false)
    })

    it('should allow access if user has one of multiple required roles', () => {
      const context = createMockExecutionContext(['ADMIN', 'OPERATOR'], 'OPERATOR')

      const result = guard.canActivate(context)

      expect(result).toBe(true)
    })

    it('should deny access if user has none of the required roles', () => {
      const context = createMockExecutionContext(['ADMIN', 'OPERATOR'], 'VIEWER')

      const result = guard.canActivate(context)

      expect(result).toBe(false)
    })

    it('should check ROLES_KEY metadata', () => {
      const context = createMockExecutionContext(['ADMIN'], 'ADMIN')

      guard.canActivate(context)

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith('roles', [
        expect.anything(),
        expect.anything(),
      ])
    })

    it('should handle case-sensitive role comparison', () => {
      const context = createMockExecutionContext(['ADMIN'], 'admin')

      const result = guard.canActivate(context)

      expect(result).toBe(false)
    })

    it('should work with single role requirement', () => {
      const context = createMockExecutionContext(['VIEWER'], 'VIEWER')

      const result = guard.canActivate(context)

      expect(result).toBe(true)
    })
  })
})
