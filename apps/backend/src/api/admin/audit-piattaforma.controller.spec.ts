import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AuditPiattaformaController } from './audit-piattaforma.controller'
import { AuditPiattaformaService } from '../../application/admin/audit-piattaforma.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'

describe('GET /admin/audit/piattaforma (HTTP, RolesGuard reale)', () => {
  let app: INestApplication
  const leggi = jest.fn().mockResolvedValue({ logs: [], totale: 0, pagina: 1, perPagina: 50 })

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      controllers: [AuditPiattaformaController],
      providers: [{ provide: AuditPiattaformaService, useValue: { leggi } }, RolesGuard],
    })
      // L'autenticazione e' finta (il ruolo arriva da un header di prova); i ruoli sono quelli veri.
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: any) => {
          const req = ctx.switchToHttp().getRequest()
          const ruolo = req.headers['x-ruolo-prova']
          if (!ruolo) return false
          req.user = { id: 'u', role: ruolo, tenantId: 't' }
          return true
        },
      })
      .compile()
    app = modulo.createNestApplication()
    await app.init()
  })

  afterAll(async () => await app.close())

  it('200 per SUPER_ADMIN', async () => {
    await request(app.getHttpServer())
      .get('/admin/audit/piattaforma')
      .set('x-ruolo-prova', 'SUPER_ADMIN')
      .expect(200)
    expect(leggi).toHaveBeenCalled()
  })

  it('403 per ADMIN, senza leggere nulla', async () => {
    leggi.mockClear()
    await request(app.getHttpServer())
      .get('/admin/audit/piattaforma')
      .set('x-ruolo-prova', 'ADMIN')
      .expect(403)
    expect(leggi).not.toHaveBeenCalled()
  })
})
