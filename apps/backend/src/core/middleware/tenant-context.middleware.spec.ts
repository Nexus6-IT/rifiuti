import { ForbiddenException } from '@nestjs/common'
import * as jwt from 'jsonwebtoken'
import { TenantContextMiddleware } from './tenant-context.middleware'

describe('TenantContextMiddleware: header X-Tenant-ID del SUPER_ADMIN', () => {
  const SECRET = 'segreto-di-prova'
  const AZIENDA = '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b'
  const middleware = new TenantContextMiddleware({ get: () => SECRET } as any)

  const richiesta = (role: string, header?: string) =>
    ({
      headers: {
        authorization:
          'Bearer ' + jwt.sign({ sub: 'u1', role, tenantId: 'casa', type: 'access' }, SECRET),
        ...(header !== undefined ? { 'x-tenant-id': header } : {}),
      },
    }) as any

  it("SUPER_ADMIN con header UUID: req.tenantId e' quello dell'header", () => {
    const req = richiesta('SUPER_ADMIN', AZIENDA)
    const next = jest.fn()
    middleware.use(req, {} as any, next)
    expect(req.tenantId).toBe(AZIENDA)
    expect(next).toHaveBeenCalled()
  })

  it('SUPER_ADMIN con header non UUID: 403, non 500, e la richiesta non prosegue', () => {
    const next = jest.fn()
    expect(() => middleware.use(richiesta('SUPER_ADMIN', 'non-un-uuid'), {} as any, next)).toThrow(
      ForbiddenException
    )
    expect(next).not.toHaveBeenCalled()
  })

  it("utente normale: header ignorato, anche se non UUID (lo valida l'interceptor)", () => {
    const req = richiesta('ADMIN', 'non-un-uuid')
    middleware.use(req, {} as any, jest.fn())
    expect(req.tenantId).toBe('casa')
  })
})
