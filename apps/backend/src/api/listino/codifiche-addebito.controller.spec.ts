/**
 * CodificheAddebitoController con pipe, guard dei ruoli e filtro reali e servizio finto:
 * validazione dei DTO, UUID, azienda selezionata, ruoli (metadata e comportamento), utente.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { CodificheAddebitoController } from './codifiche-addebito.controller'
import { CodificheAddebitoService } from '../../application/listino/codifiche-addebito.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'

const corpoValido = { genere: 'GRUPPO', descrizione: 'Servizi di raccolta' }

describe('CodificheAddebitoController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = CodificheAddebitoController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it.each(['list', 'prossimoCodice', 'getById'])('%s: lettura a tutti i ruoli', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    })

    it.each(['crea', 'modifica', 'elimina'])('%s: scrittura senza VIEWER', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])
    })

    it('ogni rotta pubblica ha @Roles esplicito', () => {
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual([
        'crea',
        'elimina',
        'getById',
        'list',
        'modifica',
        'prossimoCodice',
      ])
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
        prossimoCodice: jest.fn().mockResolvedValue('001'),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [CodificheAddebitoController],
        providers: [
          { provide: CodificheAddebitoService, useValue: servizio },
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
    const R = 'codifiche-addebito'

    it('GET senza genere: 400 e nessun servizio', async () => {
      const r = await http().get(`/${R}`)
      expect(r.status).toBe(400)
      expect(servizio.list).not.toHaveBeenCalled()
    })

    it('GET con genere non ammesso: 400', async () => {
      expect((await http().get(`/${R}?genere=ALTRO`)).status).toBe(400)
      expect(servizio.list).not.toHaveBeenCalled()
    })

    it('GET ?genere: azienda selezionata, default senza disattivate', async () => {
      const r = await http().get(`/${R}?genere=CATEGORIA_STATISTICA_1`)
      expect(r.status).toBe(200)
      expect(servizio.list).toHaveBeenCalledWith(TENANT, {
        genere: 'CATEGORIA_STATISTICA_1',
        incluseDisattivate: false,
      })
    })

    it('GET ?genere&incluseDisattivate=true', async () => {
      await http().get(`/${R}?genere=CENTRO_RICAVO&incluseDisattivate=true`)
      expect(servizio.list).toHaveBeenCalledWith(TENANT, {
        genere: 'CENTRO_RICAVO',
        incluseDisattivate: true,
      })
    })

    it('GET prossimo-codice e’ dichiarata prima di :id: non e’ scambiata per un id', async () => {
      const r = await http().get(`/${R}/prossimo-codice?genere=CATEGORIA`)
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ codice: '001' })
      expect(servizio.prossimoCodice).toHaveBeenCalledWith(TENANT, 'CATEGORIA')
      expect(servizio.getById).not.toHaveBeenCalled()
    })

    it('GET prossimo-codice senza genere o con genere errato: 400', async () => {
      expect((await http().get(`/${R}/prossimo-codice`)).status).toBe(400)
      expect((await http().get(`/${R}/prossimo-codice?genere=X`)).status).toBe(400)
      expect(servizio.prossimoCodice).not.toHaveBeenCalled()
    })

    it('POST senza codice: ammesso (primo libero)', async () => {
      const r = await http().post(`/${R}`).send(corpoValido)
      expect(r.status).toBe(201)
    })

    it('POST con codice null (modo normale, R24): ammesso e passato al servizio', async () => {
      const corpo = { ...corpoValido, codice: null }
      const r = await http().post(`/${R}`).send(corpo)
      expect(r.status).toBe(201)
      expect(servizio.crea).toHaveBeenCalledWith(TENANT, 'utente-1', corpo)
    })

    it('GET e POST con un genere della 4.1 (TIPO): 400', async () => {
      expect((await http().get(`/${R}?genere=TIPO`)).status).toBe(400)
      expect(
        (
          await http()
            .post(`/${R}`)
            .send({ ...corpoValido, genere: 'TIPO' })
        ).status
      ).toBe(400)
      expect(servizio.list).not.toHaveBeenCalled()
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it("PATCH con codice '' arriva al servizio (che risponde 400 col messaggio di R2)", async () => {
      const r = await http().patch(`/${R}/${ID}`).send({ codice: '', versione: 1 })
      expect(r.status).toBe(200)
      expect(servizio.modifica.mock.calls[0][3]).toEqual({ codice: '', versione: 1 })
    })

    it('POST con codice esplicito', async () => {
      const corpo = { ...corpoValido, codice: '007' }
      await http().post(`/${R}`).send(corpo)
      expect(servizio.crea).toHaveBeenCalledWith(TENANT, 'utente-1', corpo)
    })

    it.each([
      ['genere mancante', { ...corpoValido, genere: undefined }],
      ['genere non ammesso', { ...corpoValido, genere: 'ALTRO' }],
      ['descrizione mancante', { ...corpoValido, descrizione: undefined }],
      ['codice non stringa', { ...corpoValido, codice: 1 }],
      ['campo extra', { ...corpoValido, tenantId: 'x' }],
    ])('POST %s: 400 senza chiamare il servizio', async (_nome, corpo) => {
      const r = await http().post(`/${R}`).send(corpo)
      expect(r.status).toBe(400)
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('PATCH: corpo parziale con versione', async () => {
      const r = await http().patch(`/${R}/${ID}`).send({ descrizione: 'Nuova', versione: 2 })
      expect(r.status).toBe(200)
      expect(servizio.modifica).toHaveBeenCalledWith(TENANT, 'utente-1', ID, {
        descrizione: 'Nuova',
        versione: 2,
      })
    })

    it('PATCH con genere: 400 (il genere non si cambia)', async () => {
      const r = await http()
        .patch(`/${R}/${ID}`)
        .send({ genere: 'CATEGORIA_STATISTICA_1', versione: 1 })
      expect(r.status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it.each([
      ['attiva null', { attiva: null }],
      ['codice null', { codice: null }],
      ['descrizione null', { descrizione: null }],
    ])('PATCH %s: 400 (null non azzera in silenzio)', async (_nome, corpo) => {
      const r = await http()
        .patch(`/${R}/${ID}`)
        .send({ ...corpo, versione: 1 })
      expect(r.status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('un VIEWER legge ma non scrive (403)', async () => {
      ruolo = 'VIEWER'
      expect((await http().get(`/${R}?genere=CATEGORIA`)).status).toBe(200)
      expect((await http().post(`/${R}`).send(corpoValido)).status).toBe(403)
      expect((await http().patch(`/${R}/${ID}`).send({ versione: 1, attiva: false })).status).toBe(
        403
      )
      expect((await http().delete(`/${R}/${ID}?versione=1`)).status).toBe(403)
      expect(servizio.crea).not.toHaveBeenCalled()
      expect(servizio.modifica).not.toHaveBeenCalled()
      expect(servizio.elimina).not.toHaveBeenCalled()
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      const r = await http().get(`/${R}?genere=CATEGORIA`).set('x-senza-azienda', '1')
      expect(r.status).toBe(403)
      const w = await http().post(`/${R}`).set('x-senza-azienda', '1').send(corpoValido)
      expect(w.status).toBe(403)
      expect(servizio.list).not.toHaveBeenCalled()
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('POST: 201, utente da req.user.id e azienda selezionata', async () => {
      const r = await http().post(`/${R}`).send(corpoValido)
      expect(r.status).toBe(201)
      expect(servizio.crea).toHaveBeenCalledWith(TENANT, 'utente-1', corpoValido)
    })

    it('PATCH senza versione o con versione 0: 400', async () => {
      expect((await http().patch(`/${R}/${ID}`).send({ descrizione: 'x' })).status).toBe(400)
      expect((await http().patch(`/${R}/${ID}`).send({ versione: 0 })).status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('PATCH disattiva: attiva=false passa al servizio', async () => {
      await http().patch(`/${R}/${ID}`).send({ attiva: false, versione: 1 })
      expect(servizio.modifica.mock.calls[0][3]).toEqual({ attiva: false, versione: 1 })
    })

    it('id non UUID: 400', async () => {
      expect((await http().get(`/${R}/non-un-uuid`)).status).toBe(400)
      expect(servizio.getById).not.toHaveBeenCalled()
    })

    it('DELETE: 204 con ?versione', async () => {
      const r = await http().delete(`/${R}/${ID}?versione=3`)
      expect(r.status).toBe(204)
      expect(servizio.elimina).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 3)
    })

    it('DELETE senza versione o non numerica: 400', async () => {
      expect((await http().delete(`/${R}/${ID}`)).status).toBe(400)
      expect((await http().delete(`/${R}/${ID}?versione=abc`)).status).toBe(400)
      expect(servizio.elimina).not.toHaveBeenCalled()
    })
  })
})
