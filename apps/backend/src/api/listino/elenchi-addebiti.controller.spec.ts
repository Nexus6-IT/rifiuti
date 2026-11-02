/**
 * ElenchiAddebitiController con pipe, guard dei ruoli e filtro reali e servizio finto: validazione dei DTO, UUID,
 * azienda selezionata, ruoli (metadata e comportamento), utente.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { ElenchiAddebitiController } from './elenchi-addebiti.controller'
import { ElenchiAddebitiService } from '../../application/listino/elenchi-addebiti.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'

async function creaApp(servizio: Record<string, jest.Mock>, ruolo: () => string) {
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const moduleRef = await Test.createTestingModule({
    controllers: [ElenchiAddebitiController],
    providers: [
      { provide: ElenchiAddebitiService, useValue: servizio },
      { provide: RuoloEffettivoService, useValue: { accesso: jest.fn() } },
      { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest()
        const senza = !!req.headers['x-senza-azienda']
        req.user = {
          id: 'utente-1',
          tenantId: senza ? undefined : 'altro-tenant-del-token',
          role: ruolo(),
        }
        if (!senza) req.tenantId = TENANT
        return true
      },
    })
    .compile()
  const app = moduleRef.createNestApplication()
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  )
  await app.init()
  return app
}

describe('ElenchiAddebitiController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = ElenchiAddebitiController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it('getById: lettura a tutti i ruoli', () => {
      expect(ruoli('getById')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    })

    it.each(['modifica', 'elimina'])('%s: scrittura senza VIEWER', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])
    })

    it('ogni rotta pubblica ha @Roles esplicito', () => {
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual(['elimina', 'getById', 'modifica'])
      for (const n of metodi) expect(ruoli(n)?.length).toBeGreaterThan(0)
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let ruolo = 'OPERATOR'
    const R = 'elenchi-addebiti'

    beforeEach(async () => {
      ruolo = 'OPERATOR'
      servizio = {
        getById: jest.fn().mockResolvedValue({ id: ID }),
        modifica: jest.fn().mockResolvedValue({ id: ID }),
        elimina: jest.fn().mockResolvedValue(undefined),
      }
      app = await creaApp(servizio, () => ruolo)
    })

    afterEach(async () => {
      await app.close()
    })

    const http = () => request(app.getHttpServer())

    it('GET :id: azienda selezionata', async () => {
      expect((await http().get(`/${R}/${ID}`)).status).toBe(200)
      expect(servizio.getById).toHaveBeenCalledWith(TENANT, ID)
    })

    it('PATCH: corpo parziale con versione; null ammesso sui facoltativi', async () => {
      expect(
        (await http().patch(`/${R}/${ID}`).send({ descrizione: 'Nuova', versione: 2 })).status
      ).toBe(200)
      expect(servizio.modifica).toHaveBeenLastCalledWith(TENANT, 'utente-1', ID, {
        descrizione: 'Nuova',
        versione: 2,
      })
      const corpo = { nota1: null, validoDal: null, validoAl: null, codiceCig: null, versione: 2 }
      await http().patch(`/${R}/${ID}`).send(corpo)
      expect(servizio.modifica.mock.calls[1][3]).toEqual(corpo)
    })

    it('PATCH: predefinito "true" diventa booleano vero', async () => {
      await http().patch(`/${R}/${ID}`).send({ predefinito: 'true', versione: 1 })
      expect(servizio.modifica.mock.calls[0][3].predefinito).toBe(true)
    })

    it.each([
      ['codice null', { codice: null }],
      ['descrizione null', { descrizione: null }],
      ['predefinito null', { predefinito: null }],
      ['predefinito non booleano', { predefinito: 1 }],
      ['campo extra', { contrattoId: ID }],
    ])('PATCH %s: 400', async (_nome, corpo) => {
      const r = await http()
        .patch(`/${R}/${ID}`)
        .send({ ...corpo, versione: 1 })
      expect(r.status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('PATCH senza versione o con versione 0: 400', async () => {
      expect((await http().patch(`/${R}/${ID}`).send({ descrizione: 'x' })).status).toBe(400)
      expect((await http().patch(`/${R}/${ID}`).send({ versione: 0 })).status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('DELETE: 204 con ?versione; senza versione o non numerica 400', async () => {
      const r = await http().delete(`/${R}/${ID}?versione=3`)
      expect(r.status).toBe(204)
      expect(servizio.elimina).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 3)
      expect((await http().delete(`/${R}/${ID}`)).status).toBe(400)
      expect((await http().delete(`/${R}/${ID}?versione=abc`)).status).toBe(400)
    })

    it('un VIEWER legge ma non scrive (403)', async () => {
      ruolo = 'VIEWER'
      expect((await http().get(`/${R}/${ID}`)).status).toBe(200)
      expect(
        (await http().patch(`/${R}/${ID}`).send({ versione: 1, descrizione: 'x' })).status
      ).toBe(403)
      expect((await http().delete(`/${R}/${ID}?versione=1`)).status).toBe(403)
      expect(servizio.modifica).not.toHaveBeenCalled()
      expect(servizio.elimina).not.toHaveBeenCalled()
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      expect((await http().get(`/${R}/${ID}`).set('x-senza-azienda', '1')).status).toBe(403)
      expect(servizio.getById).not.toHaveBeenCalled()
    })

    it('id non UUID: 400 (get, patch, delete)', async () => {
      expect((await http().get(`/${R}/non-un-uuid`)).status).toBe(400)
      expect((await http().patch(`/${R}/xx`).send({ versione: 1 })).status).toBe(400)
      expect((await http().delete(`/${R}/xx?versione=1`)).status).toBe(400)
      expect(servizio.getById).not.toHaveBeenCalled()
    })
  })
})
