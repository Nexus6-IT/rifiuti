/**
 * AgentiController con pipe, guard dei ruoli e filtro reali e servizio finto: validazione dei DTO,
 * UUID, azienda selezionata, ruoli (metadata e comportamento), forma del contratto HTTP (R37).
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AgentiController } from './agenti.controller'
import { AgentiService } from '../../application/clienti/agenti.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'
const SEDE = '8f8f8f8f-0000-4000-8000-000000000005'

const corpoValido = {
  ragioneSociale: 'Agenzia Rossi',
  partitaIva: '12345678903',
  indirizzo: { via: 'Via Roma', civico: '1', cap: '00100', comune: 'Roma', provincia: 'RM' },
  codice: 'AG1',
  note: 'Zona nord',
}

describe('AgentiController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = AgentiController.prototype as any
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
        list: jest.fn().mockResolvedValue({ elementi: [], totale: 0 }),
        getById: jest.fn().mockResolvedValue({ id: ID }),
        crea: jest.fn().mockResolvedValue({
          agente: { id: ID },
          dittaEsistente: false,
          avvisi: [],
        }),
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
        controllers: [AgentiController],
        providers: [
          { provide: AgentiService, useValue: servizio },
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

    it('GET: azienda selezionata (non quella del token), default pagina 1 / dimensione 25', async () => {
      const r = await http().get('/agenti')
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ elementi: [], totale: 0 })
      expect(servizio.list).toHaveBeenCalledWith(TENANT, { pagina: 1, dimensione: 25 })
    })

    it('GET con testo, soloAttivi e paginazione', async () => {
      await http().get('/agenti?testo=rossi&soloAttivi=true&pagina=2&dimensione=10')
      expect(servizio.list).toHaveBeenCalledWith(TENANT, {
        testo: 'rossi',
        soloAttivi: true,
        pagina: 2,
        dimensione: 10,
      })
      await http().get('/agenti?soloAttivi=false')
      expect(servizio.list.mock.calls[1][1]).toMatchObject({ soloAttivi: false })
    })

    it.each([
      ['soloAttivi non booleano', 'soloAttivi=si'],
      ['pagina 0', 'pagina=0'],
      ['pagina non numerica', 'pagina=a'],
      ['dimensione 101', 'dimensione=101'],
      ['dimensione 0', 'dimensione=0'],
      ['parametro sconosciuto', 'x=1'],
    ])('GET %s: 400', async (_nome, query) => {
      const r = await http().get(`/agenti?${query}`)
      expect(r.status).toBe(400)
      expect(servizio.list).not.toHaveBeenCalled()
    })

    it('GET :id con UUID non valido: 400', async () => {
      expect((await http().get('/agenti/non-un-uuid')).status).toBe(400)
      expect(servizio.getById).not.toHaveBeenCalled()
      expect((await http().get(`/agenti/${ID}`)).status).toBe(200)
      expect(servizio.getById).toHaveBeenCalledWith(TENANT, ID)
    })

    it('un VIEWER legge ma non scrive (403)', async () => {
      ruolo = 'VIEWER'
      expect((await http().get('/agenti')).status).toBe(200)
      expect((await http().post('/agenti').send(corpoValido)).status).toBe(403)
      expect(
        (await http().patch(`/agenti/${ID}`).send({ versione: 1, attivo: false })).status
      ).toBe(403)
      expect((await http().delete(`/agenti/${ID}?versione=1`)).status).toBe(403)
      expect(servizio.crea).not.toHaveBeenCalled()
      expect(servizio.modifica).not.toHaveBeenCalled()
      expect(servizio.elimina).not.toHaveBeenCalled()
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      expect((await http().get('/agenti').set('x-senza-azienda', '1')).status).toBe(403)
      expect(
        (await http().post('/agenti').set('x-senza-azienda', '1').send(corpoValido)).status
      ).toBe(403)
      expect(servizio.list).not.toHaveBeenCalled()
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('POST: 201, comune diventa citta, risposta { agente, dittaEsistente, avvisi }', async () => {
      const r = await http().post('/agenti').send(corpoValido)
      expect(r.status).toBe(201)
      expect(r.body).toEqual({ agente: { id: ID }, dittaEsistente: false, avvisi: [] })
      expect(servizio.crea).toHaveBeenCalledTimes(1)
      const [tenant, utente, dati] = servizio.crea.mock.calls[0]
      expect(tenant).toBe(TENANT)
      expect(utente).toBe('utente-1')
      expect(dati).toMatchObject({
        ragioneSociale: 'Agenzia Rossi',
        partitaIva: '12345678903',
        codice: 'AG1',
        note: 'Zona nord',
        indirizzo: { via: 'Via Roma', civico: '1', cap: '00100', citta: 'Roma', provincia: 'RM' },
      })
      expect(dati.indirizzo).not.toHaveProperty('comune')
    })

    it('POST con tutti i campi facoltativi (null ammessi) e sedeId: accettato', async () => {
      const r = await http()
        .post('/agenti')
        .send({
          ...corpoValido,
          codiceFiscale: null,
          denominazione: 'Sede nord',
          referente: 'Mario',
          email: 'a@b.it',
          telefono: '0612345',
          pec: 'a@pec.it',
          codice: null,
          note: null,
          sedeId: SEDE,
        })
      expect(r.status).toBe(201)
      expect(servizio.crea.mock.calls[0][2]).toMatchObject({
        denominazione: 'Sede nord',
        referente: 'Mario',
        sedeId: SEDE,
        codice: null,
      })
    })

    it.each([
      ['campo extra', { ...corpoValido, tenantId: 'x' }],
      ['ragione sociale mancante', { ...corpoValido, ragioneSociale: undefined }],
      ['ragione sociale vuota', { ...corpoValido, ragioneSociale: '' }],
      ['indirizzo mancante', { ...corpoValido, indirizzo: undefined }],
      [
        'indirizzo senza comune',
        { ...corpoValido, indirizzo: { via: 'v', civico: '1', cap: '1', provincia: 'RM' } },
      ],
      ['partitaIva non stringa', { ...corpoValido, partitaIva: 123 }],
      ['codiceFiscale oltre 16', { ...corpoValido, codiceFiscale: 'A'.repeat(17) }],
      ['sedeId non UUID', { ...corpoValido, sedeId: 'x' }],
      ['codice non stringa', { ...corpoValido, codice: 5 }],
    ])('POST %s: 400 senza chiamare il servizio', async (_nome, corpo) => {
      const r = await http().post('/agenti').send(corpo)
      expect(r.status).toBe(400)
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('PATCH: corpo parziale con versione, risponde con la vista', async () => {
      const r = await http().patch(`/agenti/${ID}`).send({ note: 'Nuove', versione: 2 })
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ id: ID })
      expect(servizio.modifica).toHaveBeenCalledWith(TENANT, 'utente-1', ID, {
        note: 'Nuove',
        versione: 2,
      })
    })

    it('PATCH: codice e note null ammessi (svuotano)', async () => {
      const r = await http().patch(`/agenti/${ID}`).send({ codice: null, note: null, versione: 1 })
      expect(r.status).toBe(200)
      expect(servizio.modifica.mock.calls[0][3]).toEqual({ codice: null, note: null, versione: 1 })
    })

    it.each([
      ['identificativi della ditta', { partitaIva: '12345678903' }],
      ['ragione sociale', { ragioneSociale: 'x' }],
      ['attivo null', { attivo: null }],
      ['attivo non booleano', { attivo: 'si' }],
      ['sedeId non UUID', { sedeId: 'x' }],
      ['sedeId null', { sedeId: null }],
      ['campo extra', { tenantId: 'x' }],
    ])('PATCH %s: 400', async (_nome, corpo) => {
      const r = await http()
        .patch(`/agenti/${ID}`)
        .send({ ...corpo, versione: 1 })
      expect(r.status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('PATCH senza versione o con versione 0: 400', async () => {
      expect((await http().patch(`/agenti/${ID}`).send({ note: 'x' })).status).toBe(400)
      expect((await http().patch(`/agenti/${ID}`).send({ note: 'x', versione: 0 })).status).toBe(
        400
      )
    })

    it('PATCH disattiva/riattiva e cambio sede', async () => {
      await http().patch(`/agenti/${ID}`).send({ attivo: false, sedeId: SEDE, versione: 1 })
      expect(servizio.modifica.mock.calls[0][3]).toEqual({
        attivo: false,
        sedeId: SEDE,
        versione: 1,
      })
    })

    it('DELETE ?versione=: 204 con la versione', async () => {
      const r = await http().delete(`/agenti/${ID}?versione=3`)
      expect(r.status).toBe(204)
      expect(servizio.elimina).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 3)
    })

    it('DELETE senza versione o con versione non numerica: 400', async () => {
      expect((await http().delete(`/agenti/${ID}`)).status).toBe(400)
      expect((await http().delete(`/agenti/${ID}?versione=x`)).status).toBe(400)
      expect(servizio.elimina).not.toHaveBeenCalled()
    })
  })
})
