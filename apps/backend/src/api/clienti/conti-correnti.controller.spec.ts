/**
 * ContiCorrentiController con pipe, guard dei ruoli e filtro reali e servizio finto:
 * validazione dei DTO, UUID, azienda selezionata, ruoli (metadata e comportamento), utente.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { ContiCorrentiController } from './conti-correnti.controller'
import { ContiCorrentiService } from '../../application/clienti/conti-correnti.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'

const corpoValido = {
  codice: 'C1',
  descrizione: 'Conto principale',
  banca: 'Banca di prova',
  iban: 'IT60 X054 2811 1010 0000 0123 456',
  bic: 'BPMOIT22',
}

describe('ContiCorrentiController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = ContiCorrentiController.prototype as any
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
        controllers: [ContiCorrentiController],
        providers: [
          { provide: ContiCorrentiService, useValue: servizio },
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
      const r = await http().get('/conti-correnti')
      expect(r.status).toBe(200)
      expect(servizio.list).toHaveBeenCalledWith(TENANT, false)
    })

    it('GET ?incluseDisattivate=true', async () => {
      await http().get('/conti-correnti?incluseDisattivate=true')
      expect(servizio.list).toHaveBeenCalledWith(TENANT, true)
    })

    it('un VIEWER legge ma non scrive (403)', async () => {
      ruolo = 'VIEWER'
      expect((await http().get('/conti-correnti')).status).toBe(200)
      expect((await http().post('/conti-correnti').send(corpoValido)).status).toBe(403)
      expect(
        (await http().patch(`/conti-correnti/${ID}`).send({ versione: 1, attiva: false })).status
      ).toBe(403)
      expect((await http().delete(`/conti-correnti/${ID}?versione=1`)).status).toBe(403)
      expect(servizio.crea).not.toHaveBeenCalled()
      expect(servizio.modifica).not.toHaveBeenCalled()
      expect(servizio.elimina).not.toHaveBeenCalled()
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      const r = await http().get('/conti-correnti').set('x-senza-azienda', '1')
      expect(r.status).toBe(403)
      const w = await http().post('/conti-correnti').set('x-senza-azienda', '1').send(corpoValido)
      expect(w.status).toBe(403)
      expect(servizio.list).not.toHaveBeenCalled()
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('POST: 201, utente da req.user.id e azienda selezionata', async () => {
      const r = await http().post('/conti-correnti').send(corpoValido)
      expect(r.status).toBe(201)
      expect(servizio.crea).toHaveBeenCalledWith(TENANT, 'utente-1', corpoValido)
    })

    it.each([
      ['campo extra', { ...corpoValido, tenantId: 'x' }],
      ['codice mancante', { ...corpoValido, codice: undefined }],
      ['iban non stringa', { ...corpoValido, iban: 123 }],
      ['iban oltre 42 caratteri', { ...corpoValido, iban: 'I'.repeat(43) }],
      ['bic oltre 11 caratteri', { ...corpoValido, bic: 'B'.repeat(12) }],
      ['banca non stringa', { ...corpoValido, banca: 5 }],
    ])('POST %s: 400 senza chiamare il servizio', async (_nome, corpo) => {
      const r = await http().post('/conti-correnti').send(corpo)
      expect(r.status).toBe(400)
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('POST con IBAN con spazi e BIC assente o null: accettato (la validità la decide il dominio)', async () => {
      expect((await http().post('/conti-correnti').send(corpoValido)).status).toBe(201)
      expect(
        (
          await http()
            .post('/conti-correnti')
            .send({ ...corpoValido, bic: null })
        ).status
      ).toBe(201)
    })

    it.each([
      ['attivo null', { attivo: null }],
      ['banca null', { banca: null }],
      ['iban null', { iban: null }],
      ['codice null', { codice: null }],
    ])('PATCH %s: 400', async (_nome, corpo) => {
      const r = await http()
        .patch(`/conti-correnti/${ID}`)
        .send({ ...corpo, versione: 1 })
      expect(r.status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('PATCH bic null: ammesso (toglie il BIC)', async () => {
      const r = await http().patch(`/conti-correnti/${ID}`).send({ bic: null, versione: 1 })
      expect(r.status).toBe(200)
      expect(servizio.modifica.mock.calls[0][3]).toEqual({ bic: null, versione: 1 })
    })

    it('PATCH: corpo parziale con versione', async () => {
      const r = await http()
        .patch(`/conti-correnti/${ID}`)
        .send({ banca: 'Nuova banca', versione: 2 })
      expect(r.status).toBe(200)
      expect(servizio.modifica).toHaveBeenCalledWith(TENANT, 'utente-1', ID, {
        banca: 'Nuova banca',
        versione: 2,
      })
    })

    it('PATCH senza versione o con versione 0: 400', async () => {
      expect((await http().patch(`/conti-correnti/${ID}`).send({ banca: 'x' })).status).toBe(400)
      expect((await http().patch(`/conti-correnti/${ID}`).send({ versione: 0 })).status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it.each([
      ['fineMese null', { fineMese: null }],
      ['attiva null', { attiva: null }],
      ['modalita null', { modalita: null }],
      ['giorniRate null', { giorniRate: null }],
    ])('PATCH %s: 400 (null non azzera in silenzio)', async (_nome, corpo) => {
      const r = await http()
        .patch(`/conti-correnti/${ID}`)
        .send({ ...corpo, versione: 1 })
      expect(r.status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('PATCH disattiva: attivo=false passa al servizio', async () => {
      await http().patch(`/conti-correnti/${ID}`).send({ attivo: false, versione: 1 })
      expect(servizio.modifica.mock.calls[0][3]).toEqual({ attivo: false, versione: 1 })
    })

    it('id non UUID: 400', async () => {
      expect((await http().get('/conti-correnti/non-un-uuid')).status).toBe(400)
      expect(servizio.getById).not.toHaveBeenCalled()
    })

    it('DELETE: 204 con ?versione', async () => {
      const r = await http().delete(`/conti-correnti/${ID}?versione=3`)
      expect(r.status).toBe(204)
      expect(servizio.elimina).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 3)
    })

    it('DELETE senza versione o non numerica: 400', async () => {
      expect((await http().delete(`/conti-correnti/${ID}`)).status).toBe(400)
      expect((await http().delete(`/conti-correnti/${ID}?versione=abc`)).status).toBe(400)
      expect(servizio.elimina).not.toHaveBeenCalled()
    })
  })
})
