/**
 * ModelliStampaController con pipe, guard dei ruoli e filtro reali e servizio finto: validazione
 * dei DTO (contratto fissato dal frontend), UUID, azienda selezionata, ruoli, utente.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { json } from 'express'
import request from 'supertest'
import { ModelliStampaService } from '../../application/modelli-stampa/modelli-stampa.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { ModelliStampaController } from './modelli-stampa.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'

const corpoModifica = {
  nome: 'FIR standard',
  ambito: 'FIR',
  copie: 2,
  testoIntestazione: null,
  testoPiePagina: 'Piede',
  colorePrimario: '#112233',
  coloreSecondario: '#445566',
  logoBase64: null,
  versione: 3,
}
const { versione: _v, ...datiModello } = corpoModifica

describe('ModelliStampaController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = ModelliStampaController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it('list: lettura a tutti i ruoli', () => {
      expect(ruoli('list')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    })

    it.each(['crea', 'modifica', 'rendiPredefinito', 'elimina'])(
      '%s: scrittura solo SUPER_ADMIN e ADMIN',
      nome => {
        expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN'])
      }
    )

    it('ogni rotta pubblica ha @Roles esplicito', () => {
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual(['crea', 'elimina', 'list', 'modifica', 'rendiPredefinito'])
      for (const n of metodi) expect(ruoli(n)?.length).toBeGreaterThan(0)
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let ruolo = 'ADMIN'

    beforeEach(async () => {
      ruolo = 'ADMIN'
      servizio = {
        list: jest.fn().mockResolvedValue([]),
        crea: jest.fn().mockResolvedValue({ id: ID }),
        modifica: jest.fn().mockResolvedValue({ id: ID }),
        rendiPredefinito: jest.fn().mockResolvedValue({ id: ID }),
        elimina: jest.fn().mockResolvedValue(undefined),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [ModelliStampaController],
        providers: [
          { provide: ModelliStampaService, useValue: servizio },
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
      // Come in `main.ts`: il logo in base64 supera il limite di 100 KB del parser di default.
      app.use(json({ limit: '600kb' }))
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
      )
      await app.init()
    })

    afterEach(async () => {
      await app.close()
    })

    const http = () => request(app.getHttpServer())
    const R = 'modelli-stampa'

    it('GET: azienda selezionata (non quella del token)', async () => {
      expect((await http().get(`/${R}`)).status).toBe(200)
      expect(servizio.list).toHaveBeenCalledWith(TENANT)
    })

    it('POST: solo il nome basta, gli altri campi hanno i predefiniti del servizio', async () => {
      const r = await http().post(`/${R}`).send({ nome: 'Solo nome' })
      expect(r.status).toBe(201)
      expect(servizio.crea).toHaveBeenCalledWith(TENANT, 'utente-1', { nome: 'Solo nome' })
    })

    it('POST con tutti i campi: il corpo passa invariato', async () => {
      expect((await http().post(`/${R}`).send(datiModello)).status).toBe(201)
      expect(servizio.crea).toHaveBeenCalledWith(TENANT, 'utente-1', datiModello)
    })

    it.each([
      ['nome mancante', { ...datiModello, nome: undefined }],
      ['ambito sconosciuto', { ...datiModello, ambito: 'ALTRO' }],
      ['copie non intere', { ...datiModello, copie: '2' }],
      ['campo extra (predefinito non si crea)', { ...datiModello, predefinito: true }],
      ['campo extra (tenantId)', { ...datiModello, tenantId: 'x' }],
      ['logo non stringa', { ...datiModello, logoBase64: 5 }],
      ['logo oltre il tetto di lunghezza', { ...datiModello, logoBase64: 'A'.repeat(350_000) }],
    ])('POST %s: 400 senza chiamare il servizio', async (_n, corpo) => {
      expect((await http().post(`/${R}`).send(corpo)).status).toBe(400)
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('PUT: corpo completo con versione, i nullable passano null', async () => {
      const r = await http().put(`/${R}/${ID}`).send(corpoModifica)
      expect(r.status).toBe(200)
      expect(servizio.modifica).toHaveBeenCalledWith(TENANT, 'utente-1', ID, corpoModifica)
    })

    it.each([
      ['senza versione', { ...corpoModifica, versione: undefined }],
      ['versione 0', { ...corpoModifica, versione: 0 }],
      ['senza nome', { ...corpoModifica, nome: undefined }],
      ['senza ambito', { ...corpoModifica, ambito: undefined }],
      [
        'testoIntestazione assente (PUT sostituisce tutto)',
        { ...corpoModifica, testoIntestazione: undefined },
      ],
      ['colore numerico', { ...corpoModifica, colorePrimario: 5 }],
    ])('PUT %s: 400', async (_n, corpo) => {
      expect((await http().put(`/${R}/${ID}`).send(corpo)).status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('POST :id/predefinito: passa la versione', async () => {
      const r = await http().post(`/${R}/${ID}/predefinito`).send({ versione: 4 })
      expect(r.status).toBe(200)
      expect(servizio.rendiPredefinito).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 4)
      expect((await http().post(`/${R}/${ID}/predefinito`).send({})).status).toBe(400)
    })

    it('DELETE: 204 con ?versione; senza versione o non numerica 400', async () => {
      expect((await http().delete(`/${R}/${ID}?versione=3`)).status).toBe(204)
      expect(servizio.elimina).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 3)
      expect((await http().delete(`/${R}/${ID}`)).status).toBe(400)
      expect((await http().delete(`/${R}/${ID}?versione=x`)).status).toBe(400)
      expect(servizio.elimina).toHaveBeenCalledTimes(1)
    })

    it.each(['OPERATOR', 'VIEWER'])('%s legge ma non scrive (403)', async r => {
      ruolo = r
      expect((await http().get(`/${R}`)).status).toBe(200)
      expect((await http().post(`/${R}`).send(datiModello)).status).toBe(403)
      expect((await http().put(`/${R}/${ID}`).send(corpoModifica)).status).toBe(403)
      expect((await http().post(`/${R}/${ID}/predefinito`).send({ versione: 1 })).status).toBe(403)
      expect((await http().delete(`/${R}/${ID}?versione=1`)).status).toBe(403)
      for (const m of ['crea', 'modifica', 'rendiPredefinito', 'elimina']) {
        expect(servizio[m]).not.toHaveBeenCalled()
      }
    })

    it('SUPER_ADMIN scrive', async () => {
      ruolo = 'SUPER_ADMIN'
      expect((await http().post(`/${R}`).send(datiModello)).status).toBe(201)
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      expect((await http().get(`/${R}`).set('x-senza-azienda', '1')).status).toBe(403)
      expect(servizio.list).not.toHaveBeenCalled()
    })

    it('id non UUID: 400', async () => {
      expect((await http().put(`/${R}/xx`).send(corpoModifica)).status).toBe(400)
      expect((await http().post(`/${R}/xx/predefinito`).send({ versione: 1 })).status).toBe(400)
      expect((await http().delete(`/${R}/xx?versione=1`)).status).toBe(400)
    })
  })
})
