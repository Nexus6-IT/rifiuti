/**
 * SpeseAccessorieController con pipe, guard dei ruoli e filtro reali e servizio finto:
 * validazione dei DTO, UUID, azienda selezionata, ruoli (metadata e comportamento), utente.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { SpeseAccessorieController } from './spese-accessorie.controller'
import { SpeseAccessorieService } from '../../application/clienti/spese-accessorie.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'

const corpoValido = {
  tipo: 'INCASSO',
  codice: 'INC',
  descrizione: 'Spese di incasso',
  importo: '2.50',
}

describe('SpeseAccessorieController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = SpeseAccessorieController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it.each(['list', 'getById'])('%s: lettura a tutti i ruoli', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    })

    it.each(['crea', 'modifica', 'elimina'])('%s: scrittura senza VIEWER', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])
    })

    it('ogni rotta pubblica ha @Roles esplicito', () => {
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual(['crea', 'elimina', 'getById', 'list', 'modifica'])
      for (const n of metodi) expect(ruoli(n)?.length).toBeGreaterThan(0)
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let ruolo = 'OPERATOR'

    beforeEach(async () => {
      ruolo = 'OPERATOR'
      servizio = {
        list: jest.fn().mockResolvedValue([]),
        getById: jest.fn().mockResolvedValue({ id: ID }),
        crea: jest.fn().mockResolvedValue({ id: ID }),
        modifica: jest.fn().mockResolvedValue({ id: ID }),
        elimina: jest.fn().mockResolvedValue(undefined),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [SpeseAccessorieController],
        providers: [
          { provide: SpeseAccessorieService, useValue: servizio },
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
              role: ruolo,
            }
            if (!senza) req.tenantId = TENANT
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

    const http = () => request(app.getHttpServer())

    it('GET: usa l’azienda selezionata, non quella del token; default senza disattivate', async () => {
      const r = await http().get('/spese-accessorie')
      expect(r.status).toBe(200)
      expect(servizio.list).toHaveBeenCalledWith(TENANT, {
        tipo: undefined,
        incluseDisattivate: false,
      })
    })

    it('GET ?incluseDisattivate=true', async () => {
      await http().get('/spese-accessorie?incluseDisattivate=true')
      expect(servizio.list).toHaveBeenCalledWith(TENANT, {
        tipo: undefined,
        incluseDisattivate: true,
      })
    })

    it('GET ?tipo=BOLLO: filtra per tipo', async () => {
      await http().get('/spese-accessorie?tipo=BOLLO')
      expect(servizio.list).toHaveBeenCalledWith(TENANT, {
        tipo: 'BOLLO',
        incluseDisattivate: false,
      })
    })

    it('GET ?tipo non ammesso: 400 senza chiamare il servizio', async () => {
      expect((await http().get('/spese-accessorie?tipo=ALTRO')).status).toBe(400)
      expect((await http().get('/spese-accessorie?tipo=incasso')).status).toBe(400)
      expect(servizio.list).not.toHaveBeenCalled()
    })

    it('un VIEWER legge ma non scrive (403)', async () => {
      ruolo = 'VIEWER'
      expect((await http().get('/spese-accessorie')).status).toBe(200)
      expect((await http().post('/spese-accessorie').send(corpoValido)).status).toBe(403)
      expect(
        (await http().patch(`/spese-accessorie/${ID}`).send({ versione: 1, attiva: false })).status
      ).toBe(403)
      expect((await http().delete(`/spese-accessorie/${ID}?versione=1`)).status).toBe(403)
      expect(servizio.crea).not.toHaveBeenCalled()
      expect(servizio.modifica).not.toHaveBeenCalled()
      expect(servizio.elimina).not.toHaveBeenCalled()
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      const r = await http().get('/spese-accessorie').set('x-senza-azienda', '1')
      expect(r.status).toBe(403)
      const w = await http().post('/spese-accessorie').set('x-senza-azienda', '1').send(corpoValido)
      expect(w.status).toBe(403)
      expect(servizio.list).not.toHaveBeenCalled()
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('POST: 201, utente da req.user.id e azienda selezionata', async () => {
      const r = await http().post('/spese-accessorie').send(corpoValido)
      expect(r.status).toBe(201)
      expect(servizio.crea).toHaveBeenCalledWith(TENANT, 'utente-1', corpoValido)
    })

    it.each([
      ['tipo non ammesso', { ...corpoValido, tipo: 'ALTRO' }],
      ['importo con la virgola', { ...corpoValido, importo: '4,5' }],
      ['importo numerico', { ...corpoValido, importo: 4.5 }],
      ['importo negativo', { ...corpoValido, importo: '-1' }],
      ['importo con tre decimali', { ...corpoValido, importo: '1.234' }],
      ['importo con più di 8 cifre intere', { ...corpoValido, importo: '123456789' }],
      ['importo vuoto', { ...corpoValido, importo: '' }],
      ['campo extra', { ...corpoValido, tenantId: 'x' }],
      ['codice mancante', { ...corpoValido, codice: undefined }],
    ])('POST %s: 400 senza chiamare il servizio', async (_nome, corpo) => {
      const r = await http().post('/spese-accessorie').send(corpo)
      expect(r.status).toBe(400)
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it.each(['0', '2', '2.5', '2.50', '12345678.99'])(
      'POST importo %s: accettato',
      async importo => {
        const r = await http()
          .post('/spese-accessorie')
          .send({ ...corpoValido, importo })
        expect(r.status).toBe(201)
      }
    )

    it.each([
      ['attiva null', { attiva: null }],
      ['tipo null', { tipo: null }],
      ['importo null', { importo: null }],
      ['importo con la virgola', { importo: '4,5' }],
    ])('PATCH %s: 400', async (_nome, corpo) => {
      const r = await http()
        .patch(`/spese-accessorie/${ID}`)
        .send({ ...corpo, versione: 1 })
      expect(r.status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('PATCH: corpo parziale con versione', async () => {
      const r = await http().patch(`/spese-accessorie/${ID}`).send({ importo: '3.00', versione: 2 })
      expect(r.status).toBe(200)
      expect(servizio.modifica).toHaveBeenCalledWith(TENANT, 'utente-1', ID, {
        importo: '3.00',
        versione: 2,
      })
    })

    it('PATCH senza versione o con versione 0: 400', async () => {
      expect((await http().patch(`/spese-accessorie/${ID}`).send({ importo: '1.00' })).status).toBe(
        400
      )
      expect((await http().patch(`/spese-accessorie/${ID}`).send({ versione: 0 })).status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it.each([
      ['fineMese null', { fineMese: null }],
      ['attiva null', { attiva: null }],
      ['modalita null', { modalita: null }],
      ['giorniRate null', { giorniRate: null }],
    ])('PATCH %s: 400 (null non azzera in silenzio)', async (_nome, corpo) => {
      const r = await http()
        .patch(`/spese-accessorie/${ID}`)
        .send({ ...corpo, versione: 1 })
      expect(r.status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('PATCH disattiva: attiva=false passa al servizio', async () => {
      await http().patch(`/spese-accessorie/${ID}`).send({ attiva: false, versione: 1 })
      expect(servizio.modifica.mock.calls[0][3]).toEqual({ attiva: false, versione: 1 })
    })

    it('id non UUID: 400', async () => {
      expect((await http().get('/spese-accessorie/non-un-uuid')).status).toBe(400)
      expect(servizio.getById).not.toHaveBeenCalled()
    })

    it('DELETE: 204 con ?versione', async () => {
      const r = await http().delete(`/spese-accessorie/${ID}?versione=3`)
      expect(r.status).toBe(204)
      expect(servizio.elimina).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 3)
    })

    it('DELETE senza versione o non numerica: 400', async () => {
      expect((await http().delete(`/spese-accessorie/${ID}`)).status).toBe(400)
      expect((await http().delete(`/spese-accessorie/${ID}?versione=abc`)).status).toBe(400)
      expect(servizio.elimina).not.toHaveBeenCalled()
    })
  })
})
