/**
 * Rotte di modifica e cancellazione dei contratti attraverso la catena HTTP reale: ValidationPipe
 * di main.ts, ParseUUIDPipe/ParseIntPipe, RolesGuard e filtro globale delle eccezioni. Il servizio
 * e il ruolo effettivo sono finti (il servizio ha i suoi test, anche contro Postgres).
 */
import { Test } from '@nestjs/testing'
import {
  ConflictException,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import request from 'supertest'
import { ContractController } from './contract.controller'
import { ContractService } from './contract.service'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const ID = '3b3b3b3b-0000-4000-8000-000000000006'

describe('ContractController — catena HTTP (modifica e cancellazione)', () => {
  let app: INestApplication
  let ruolo: string
  let servizio: Record<string, jest.Mock>

  beforeEach(async () => {
    ruolo = 'ADMIN'
    servizio = {
      update: jest.fn().mockResolvedValue({ id: ID }),
      elimina: jest.fn().mockResolvedValue(undefined),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [ContractController],
      providers: [
        { provide: ContractService, useValue: servizio },
        {
          provide: RuoloEffettivoService,
          useValue: { ruoloEffettivo: jest.fn(async () => ruolo) },
        },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = {
            id: UTENTE,
            tenantId: TENANT,
            role: ruolo,
          }
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
    await app?.close()
  })

  const http = () => request(app.getHttpServer())

  it('PATCH: 200, null su endDate arriva al servizio come null, date come Date', async () => {
    const res = await http()
      .patch(`/contracts/${ID}`)
      .send({ versione: 2, endDate: null, startDate: '2026-02-01', basePrice: 10 })
    expect(res.status).toBe(200)
    const [tenant, utente, id, input] = servizio.update.mock.calls[0]
    expect([tenant, utente, id]).toEqual([TENANT, UTENTE, ID])
    expect(input.endDate).toBeNull()
    expect(input.startDate).toEqual(new Date('2026-02-01'))
    expect(input.versione).toBe(2)
  })

  it('PATCH: corpo non valido o id non UUID: 400 senza toccare il servizio', async () => {
    const corpi = [
      {},
      { versione: 0 },
      { versione: 1, pricingConfig: {} },
      { versione: 1, status: 'ACTIVE' },
    ]
    for (const corpo of corpi) {
      expect((await http().patch(`/contracts/${ID}`).send(corpo)).status).toBe(400)
    }
    expect((await http().patch('/contracts/xyz').send({ versione: 1 })).status).toBe(400)
    expect(servizio.update).not.toHaveBeenCalled()
  })

  it('PATCH: il 409 del servizio arriva col codice in `error`', async () => {
    servizio.update.mockRejectedValue(
      new ConflictException({
        message: 'Un contratto cessato non si modifica.',
        error: 'CONTRATTO_NON_MODIFICABILE',
      })
    )
    const res = await http().patch(`/contracts/${ID}`).send({ versione: 1 })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('CONTRATTO_NON_MODIFICABILE')
    expect(res.body.message).toBe('Un contratto cessato non si modifica.')
  })

  it('DELETE: 204 con versione numerica in query', async () => {
    const res = await http().delete(`/contracts/${ID}?versione=3`)
    expect(res.status).toBe(204)
    expect(servizio.elimina).toHaveBeenCalledWith(TENANT, UTENTE, ID, 3)
  })

  it('DELETE: senza versione, versione non numerica o id non UUID: 400', async () => {
    expect((await http().delete(`/contracts/${ID}`)).status).toBe(400)
    expect((await http().delete(`/contracts/${ID}?versione=abc`)).status).toBe(400)
    expect((await http().delete('/contracts/xyz?versione=1')).status).toBe(400)
    expect(servizio.elimina).not.toHaveBeenCalled()
  })

  it('VIEWER: 403 su PATCH e DELETE', async () => {
    ruolo = 'VIEWER'
    expect((await http().patch(`/contracts/${ID}`).send({ versione: 1 })).status).toBe(403)
    expect((await http().delete(`/contracts/${ID}?versione=1`)).status).toBe(403)
    expect(servizio.update).not.toHaveBeenCalled()
    expect(servizio.elimina).not.toHaveBeenCalled()
  })
})
