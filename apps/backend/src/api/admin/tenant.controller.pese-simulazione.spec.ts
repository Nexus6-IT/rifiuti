/**
 * `PATCH /admin/tenants/:id/pese-simulazione` (4.8b, Q2) attraverso la catena HTTP con i guard
 * VERI di ruolo: ADMIN → 403, SUPER_ADMIN → 200. Il servizio e' finto.
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import request from 'supertest'
import { TenantService } from '../../application/admin/tenant.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { TenantController } from './tenant.controller'

const ID = '3b3b3b3b-0000-4000-8000-000000000006'

describe('TenantController PATCH :id/pese-simulazione', () => {
  let app: INestApplication
  let ruolo: string
  let servizio: { impostaSimulazionePese: jest.Mock }

  beforeEach(async () => {
    ruolo = 'SUPER_ADMIN'
    servizio = { impostaSimulazionePese: jest.fn().mockResolvedValue({ id: ID }) }
    const moduleRef = await Test.createTestingModule({
      controllers: [TenantController],
      providers: [
        { provide: TenantService, useValue: servizio },
        { provide: RuoloEffettivoService, useValue: { ruoloEffettivo: async () => ruolo } },
        Reflector,
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (c: ExecutionContext) => {
          c.switchToHttp().getRequest().user = { id: 'u1', tenantId: 't1', role: ruolo }
          return true
        },
      })
      .compile()
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
  })
  afterEach(async () => {
    await app.close()
  })

  it('SUPER_ADMIN: 200 e il servizio riceve l’utente, l’azienda e il valore', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/tenants/${ID}/pese-simulazione`)
      .send({ ammessa: true })
      .expect(200)
    expect(servizio.impostaSimulazionePese).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1', role: 'SUPER_ADMIN' }),
      ID,
      true
    )
  })

  it('ADMIN: 403 e nessuna scrittura', async () => {
    ruolo = 'ADMIN'
    await request(app.getHttpServer())
      .patch(`/admin/tenants/${ID}/pese-simulazione`)
      .send({ ammessa: true })
      .expect(403)
    expect(servizio.impostaSimulazionePese).not.toHaveBeenCalled()
  })

  it('corpo non valido: 400', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/tenants/${ID}/pese-simulazione`)
      .send({ ammessa: 'si' })
      .expect(400)
  })
})
