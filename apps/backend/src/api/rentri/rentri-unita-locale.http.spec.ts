/**
 * Elenco delle unita locali attraverso la catena HTTP reale: e' una lettura condivisa fra RENTRI
 * e Comunicazioni (la pagina delle comunicazioni sceglie la sede da qui). Le scritture restano
 * del solo modulo `rentri`.
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { ModuloAttivoInterceptor } from '../../core/interceptors/modulo-attivo.interceptor'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { RentriUnitaLocaleController } from './rentri-unita-locale.controller'
import { RentriUnitaLocaleService } from '../../infrastructure/rentri/rentri-unita-locale.service'

const TENANT = '5a5a5a5a-0000-4000-8000-00000000000a'

describe('RentriUnitaLocaleController - modulo sull elenco (HTTP)', () => {
  let app: INestApplication
  let moduliAttivi: jest.Mock
  let service: { listForTenant: jest.Mock; create: jest.Mock }

  beforeEach(async () => {
    moduliAttivi = jest.fn()
    service = { listForTenant: jest.fn().mockResolvedValue([{ id: 'ul-1' }]), create: jest.fn() }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [RentriUnitaLocaleController],
      providers: [
        { provide: RentriUnitaLocaleService, useValue: service },
        { provide: ModuliAttiviService, useValue: { moduliAttivi } },
        { provide: APP_INTERCEPTOR, useClass: ModuloAttivoInterceptor },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest()
          req.user = { id: 'u1', tenantId: TENANT, role: 'ADMIN' }
          req.tenantId = TENANT
          return true
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile()
    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  it.each([['rentri'], ['comunicazioni']])('elenco: 200 con il solo modulo %s', async modulo => {
    moduliAttivi.mockResolvedValue([modulo])
    const res = await request(app.getHttpServer()).get('/rentri/unita-locali').expect(200)
    expect(res.body).toEqual({ items: [{ id: 'ul-1' }] })
  })

  it('elenco: 403 MODULO_NON_ATTIVO senza rentri ne comunicazioni', async () => {
    moduliAttivi.mockResolvedValue(['registro'])
    const res = await request(app.getHttpServer()).get('/rentri/unita-locali').expect(403)
    expect(JSON.stringify(res.body)).toContain('MODULO_NON_ATTIVO')
    expect(service.listForTenant).not.toHaveBeenCalled()
  })

  it('scrittura: 403 con il solo modulo comunicazioni', async () => {
    moduliAttivi.mockResolvedValue(['comunicazioni'])
    await request(app.getHttpServer())
      .post('/rentri/unita-locali')
      .send({ numIscrSito: 'x', denominazione: 'y' })
      .expect(403)
    expect(service.create).not.toHaveBeenCalled()
  })
})
