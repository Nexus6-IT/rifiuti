/**
 * Roles Guard - Tests
 * Ruolo del token e, con un'azienda selezionata diversa da quella di casa, ruolo EFFETTIVO.
 */

import { RolesGuard } from './roles.guard'
import { ExecutionContext, ServiceUnavailableException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

const CASA = '5a5a5a5a-0000-4000-8000-000000000001'
const CLIENTE = 'c1c1c1c1-0000-4000-8000-000000000002'

describe('RolesGuard', () => {
  let guard: RolesGuard
  let reflector: jest.Mocked<Reflector>
  let ruoloEffettivo: { accesso: jest.Mock }

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as any
    ruoloEffettivo = { accesso: jest.fn() }

    guard = new RolesGuard(reflector, ruoloEffettivo as any)
  })

  const createMockExecutionContext = (
    requiredRoles: string[] | null,
    userRole: string | null,
    headerTenant?: string | string[]
  ): ExecutionContext => {
    reflector.getAllAndOverride.mockReturnValue(requiredRoles)

    const mockHandler = jest.fn()
    const mockClass = jest.fn()

    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: headerTenant === undefined ? {} : { 'x-tenant-id': headerTenant },
          user: userRole ? { id: 'user-123', role: userRole, tenantId: CASA } : null,
        }),
      }),
      getHandler: () => mockHandler,
      getClass: () => mockClass,
    } as any
  }

  describe('canActivate', () => {
    it('should allow access if no roles are required', async () => {
      const context = createMockExecutionContext(null, 'VIEWER')

      expect(await guard.canActivate(context)).toBe(true)
    })

    it('should allow access if route has empty roles array', async () => {
      const context = createMockExecutionContext([], 'VIEWER')

      expect(await guard.canActivate(context)).toBe(true)
    })

    it('should deny access if user is not authenticated', async () => {
      const context = createMockExecutionContext(['ADMIN'], null)

      expect(await guard.canActivate(context)).toBe(false)
    })

    it('should allow access if user has required role', async () => {
      const context = createMockExecutionContext(['ADMIN'], 'ADMIN')

      expect(await guard.canActivate(context)).toBe(true)
    })

    it('should deny access if user does not have required role', async () => {
      const context = createMockExecutionContext(['ADMIN'], 'VIEWER')

      expect(await guard.canActivate(context)).toBe(false)
    })

    it('should allow access if user has one of multiple required roles', async () => {
      const context = createMockExecutionContext(['ADMIN', 'OPERATOR'], 'OPERATOR')

      expect(await guard.canActivate(context)).toBe(true)
    })

    it('should deny access if user has none of the required roles', async () => {
      const context = createMockExecutionContext(['ADMIN', 'OPERATOR'], 'VIEWER')

      expect(await guard.canActivate(context)).toBe(false)
    })

    it('should check ROLES_KEY metadata', async () => {
      const context = createMockExecutionContext(['ADMIN'], 'ADMIN')

      await guard.canActivate(context)

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith('roles', [
        expect.anything(),
        expect.anything(),
      ])
    })

    it('should handle case-sensitive role comparison', async () => {
      const context = createMockExecutionContext(['ADMIN'], 'admin')

      expect(await guard.canActivate(context)).toBe(false)
    })

    it('should work with single role requirement', async () => {
      const context = createMockExecutionContext(['VIEWER'], 'VIEWER')

      expect(await guard.canActivate(context)).toBe(true)
    })

    it('nessun header: il ruolo effettivo non viene mai consultato', async () => {
      const context = createMockExecutionContext(['ADMIN'], 'ADMIN')

      await guard.canActivate(context)

      expect(ruoloEffettivo.accesso).not.toHaveBeenCalled()
    })
  })

  describe('azienda selezionata diversa da quella di casa', () => {
    it('consulente ADMIN di casa ma VIEWER presso il cliente: @Roles(ADMIN) negato', async () => {
      ruoloEffettivo.accesso.mockResolvedValue('VIEWER')
      const context = createMockExecutionContext(['ADMIN'], 'ADMIN', CLIENTE)

      expect(await guard.canActivate(context)).toBe(false)
      expect(ruoloEffettivo.accesso).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'user-123', role: 'ADMIN' }),
        CLIENTE
      )
    })

    it('consulente associato come ADMIN: @Roles(ADMIN) concesso', async () => {
      ruoloEffettivo.accesso.mockResolvedValue('ADMIN')
      const context = createMockExecutionContext(['ADMIN'], 'VIEWER', CLIENTE)

      expect(await guard.canActivate(context)).toBe(true)
    })

    it('azienda senza accesso (null): decide il ruolo del token', async () => {
      ruoloEffettivo.accesso.mockResolvedValue(null)

      expect(await guard.canActivate(createMockExecutionContext(['ADMIN'], 'ADMIN', CLIENTE))).toBe(
        true
      )
      expect(
        await guard.canActivate(createMockExecutionContext(['ADMIN'], 'VIEWER', CLIENTE))
      ).toBe(false)
    })

    it('header non UUID: ruolo del token, accesso mai chiamato', async () => {
      const context = createMockExecutionContext(['ADMIN'], 'ADMIN', 'non-un-uuid')

      expect(await guard.canActivate(context)).toBe(true)
      expect(ruoloEffettivo.accesso).not.toHaveBeenCalled()
    })

    it("header uguale all'azienda di casa: accesso mai chiamato", async () => {
      const context = createMockExecutionContext(['ADMIN'], 'ADMIN', CASA)

      expect(await guard.canActivate(context)).toBe(true)
      expect(ruoloEffettivo.accesso).not.toHaveBeenCalled()
    })

    it('SUPER_ADMIN: invariato, accesso mai chiamato', async () => {
      const context = createMockExecutionContext(['SUPER_ADMIN'], 'SUPER_ADMIN', CLIENTE)

      expect(await guard.canActivate(context)).toBe(true)
      expect(ruoloEffettivo.accesso).not.toHaveBeenCalled()
    })

    it('accesso che lancia: 503 VERIFICA_AZIENDA_NON_DISPONIBILE (fail-closed)', async () => {
      ruoloEffettivo.accesso.mockRejectedValue(new Error('db giu: password=segreta'))
      const context = createMockExecutionContext(['ADMIN'], 'ADMIN', CLIENTE)

      const errore = await guard.canActivate(context).then(
        () => null,
        (e: unknown) => e
      )

      expect(errore).toBeInstanceOf(ServiceUnavailableException)
      const corpo = (errore as ServiceUnavailableException).getResponse()
      expect(corpo).toMatchObject({ error: 'VERIFICA_AZIENDA_NON_DISPONIBILE' })
      expect(JSON.stringify(corpo)).not.toContain('segreta')
      expect(JSON.stringify(corpo)).not.toContain(CLIENTE)
    })
  })
})
