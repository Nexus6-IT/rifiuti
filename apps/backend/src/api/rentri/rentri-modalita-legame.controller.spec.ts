import { Test } from '@nestjs/testing'
import { INestApplication, ExecutionContext } from '@nestjs/common'
import request from 'supertest'
import { RentriModalitaLegameController } from './rentri-modalita-legame.controller'
import { RentriModalitaLegameService } from '../../infrastructure/rentri/rentri-modalita-legame.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'

const user: CurrentUserPayload = {
  id: 'user-1',
  email: 'admin@example.com',
  tenantId: 'tenant-1',
  role: 'ADMIN',
  permissions: [],
}

// richiesta senza switch di azienda: l'azienda selezionata coincide con quella del token
const req = { tenantId: user.tenantId, user }

describe('RentriModalitaLegameController', () => {
  let controller: RentriModalitaLegameController
  let service: jest.Mocked<RentriModalitaLegameService>

  beforeEach(() => {
    service = {
      getForTenant: jest.fn(),
      setForTenant: jest.fn(),
    } as unknown as jest.Mocked<RentriModalitaLegameService>

    controller = new RentriModalitaLegameController(service)
  })

  describe('GET (get)', () => {
    it('ritorna la modalità corrente del tenant', async () => {
      service.getForTenant.mockResolvedValue({
        modalitaLegame: 'MANUALE',
        certificatoConfigurato: false,
      })

      const res = await controller.get(req)

      expect(res).toEqual({ modalitaLegame: 'MANUALE', certificatoConfigurato: false })
      expect(service.getForTenant).toHaveBeenCalledWith('tenant-1')
    })
  })

  describe('PATCH (set)', () => {
    it('imposta la modalità del tenant corrente', async () => {
      service.setForTenant.mockResolvedValue({
        modalitaLegame: 'IBRIDA',
        certificatoConfigurato: true,
      })

      const res = await controller.set({ modalitaLegame: 'IBRIDA' }, req)

      expect(res).toEqual({ modalitaLegame: 'IBRIDA', certificatoConfigurato: true })
      expect(service.setForTenant).toHaveBeenCalledWith('tenant-1', 'IBRIDA')
    })

    it('propaga l’errore del service (es. 400 senza certificato)', async () => {
      const error = new Error('serve un certificato')
      service.setForTenant.mockRejectedValue(error)

      await expect(controller.set({ modalitaLegame: 'AUTOMATICA' }, req)).rejects.toBe(error)
    })
  })
})

/**
 * Verifica EMPIRICA dell'autorizzazione: monta un'app Nest reale con
 * JwtAuthGuard (sostituito da un fake che inietta l'utente di test, per non
 * dipendere dall'infrastruttura JWT/passport in questo spec) e RolesGuard
 * VERO — non mockato — così il 403 osservato è prodotto dal guard reale che
 * legge la metadata `@Roles` del controller, non da un'aspettativa sul
 * decoratore. Non ci si fida del decoratore: si manda una richiesta HTTP vera
 * e si legge lo status code effettivo.
 */
describe('RentriModalitaLegameController — autorizzazione (verifica empirica)', () => {
  let app: INestApplication
  let currentTestUser: CurrentUserPayload
  let service: jest.Mocked<RentriModalitaLegameService>

  beforeAll(async () => {
    service = {
      getForTenant: jest.fn().mockResolvedValue({
        modalitaLegame: 'MANUALE',
        certificatoConfigurato: false,
      }),
      setForTenant: jest.fn().mockResolvedValue({
        modalitaLegame: 'MANUALE',
        certificatoConfigurato: false,
      }),
    } as unknown as jest.Mocked<RentriModalitaLegameService>

    const moduleRef = await Test.createTestingModule({
      controllers: [RentriModalitaLegameController],
      providers: [
        { provide: RentriModalitaLegameService, useValue: service },
        { provide: RuoloEffettivoService, useValue: { accesso: jest.fn() } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest()
          req.user = currentTestUser
          return true
        },
      })
      // RolesGuard NON è mockato: è il guard reale del progetto.
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('nega a un OPERATOR (403), non un mio presupposto sul decoratore', async () => {
    currentTestUser = {
      id: 'u',
      email: 'op@example.com',
      tenantId: 't',
      role: 'OPERATOR',
      permissions: [],
    }

    await request(app.getHttpServer()).get('/rentri/modalita-legame').expect(403)
    await request(app.getHttpServer())
      .patch('/rentri/modalita-legame')
      .send({ modalitaLegame: 'MANUALE' })
      .expect(403)
  })

  it('nega a un VIEWER (403)', async () => {
    currentTestUser = {
      id: 'u',
      email: 'v@example.com',
      tenantId: 't',
      role: 'VIEWER',
      permissions: [],
    }

    await request(app.getHttpServer()).get('/rentri/modalita-legame').expect(403)
  })

  it('consente a un ADMIN (200)', async () => {
    currentTestUser = {
      id: 'u',
      email: 'a@example.com',
      tenantId: 't',
      role: 'ADMIN',
      permissions: [],
    }

    await request(app.getHttpServer()).get('/rentri/modalita-legame').expect(200)
  })

  it('consente a un SUPER_ADMIN (200)', async () => {
    currentTestUser = {
      id: 'u',
      email: 's@example.com',
      tenantId: 't',
      role: 'SUPER_ADMIN',
      permissions: [],
    }

    await request(app.getHttpServer()).get('/rentri/modalita-legame').expect(200)
  })
})
