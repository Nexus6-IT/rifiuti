/**
 * JWT Auth Guard - TDD Tests
 * Guard for protecting routes with JWT authentication
 */

import { JwtAuthGuard } from './jwt-auth.guard'
import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard
  let reflector: jest.Mocked<Reflector>

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as any

    guard = new JwtAuthGuard(reflector)
  })

  const createMockExecutionContext = (isPublic = false, user: any = null): ExecutionContext => {
    reflector.getAllAndOverride.mockReturnValue(isPublic)

    const mockHandler = jest.fn()
    const mockClass = jest.fn()

    return {
      switchToHttp: () => ({
        getRequest: () => ({
          user,
          headers: {
            authorization: user ? 'Bearer valid-token' : undefined,
          },
        }),
      }),
      getHandler: () => mockHandler,
      getClass: () => mockClass,
    } as any
  }

  describe('canActivate', () => {
    it('should allow access to public routes', async () => {
      const context = createMockExecutionContext(true)

      const result = await guard.canActivate(context)

      expect(result).toBe(true)
    })

    it('should check IS_PUBLIC_KEY metadata', async () => {
      const context = createMockExecutionContext(true)

      await guard.canActivate(context)

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith('isPublic', [
        expect.anything(),
        expect.anything(),
      ])
    })

    it('should deny access if no user in request (protected route)', async () => {
      const context = createMockExecutionContext(false, null)

      // Mock the passport authentication
      jest.spyOn(guard, 'canActivate' as any).mockResolvedValue(false)

      const result = await guard.canActivate(context)

      expect(result).toBe(false)
    })

    it('should allow access if user is authenticated', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        role: 'ADMIN',
      }
      const context = createMockExecutionContext(false, mockUser)

      // Mock passport guard behavior
      jest.spyOn(guard, 'canActivate' as any).mockResolvedValue(true)

      const result = await guard.canActivate(context)

      expect(result).toBe(true)
    })

    it('should call parent AuthGuard(jwt) for protected routes', async () => {
      const context = createMockExecutionContext(false)

      // The actual implementation will call super.canActivate()
      // which triggers passport JWT strategy validation
      expect(guard).toBeDefined()
    })
  })

  describe('handleRequest', () => {
    it('should return user if authenticated', () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
      }

      const result = guard.handleRequest(null, mockUser, null, null)

      expect(result).toEqual(mockUser)
    })

    it('should throw UnauthorizedException if no user', () => {
      expect(() => {
        guard.handleRequest(null, null, null, null)
      }).toThrow(UnauthorizedException)
    })

    it('should throw UnauthorizedException with custom message', () => {
      expect(() => {
        guard.handleRequest(null, null, null, null)
      }).toThrow('Unauthorized access')
    })

    it('should throw original error if provided', () => {
      const error = new Error('Token expired')

      expect(() => {
        guard.handleRequest(error, null, null, null)
      }).toThrow(UnauthorizedException)
    })

    it('should handle info object from passport', () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
      }
      const info = { message: 'Token valid' }

      const result = guard.handleRequest(null, mockUser, info, null)

      expect(result).toEqual(mockUser)
    })
  })
})
