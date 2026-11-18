/**
 * ConfigurazioneSdiController con pipe, guard dei ruoli e filtro reali e servizio finto:
 * validazione del DTO, ruoli (metadata e comportamento), azienda selezionata, ruolo effettivo.
 */
import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { ConfigurazioneSdiController } from './configurazione-sdi.controller'
import { ConfigurazioneSdiService } from '../../application/sdi/configurazione-sdi.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RICHIEDE_MODULO } from '../../core/decorators/richiede-modulo.decorator'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-0000000000aa'

describe('ConfigurazioneSdiController', () => {
  describe('metadata', () => {
    const reflector = new Reflector()
    const proto = ConfigurazioneSdiController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it('il controller richiede il modulo sdi', () => {
      expect(reflector.get(RICHIEDE_MODULO, ConfigurazioneSdiController)).toEqual(['sdi'])
    })

    it('GET a tutti i ruoli, tutte le scritture solo ADMIN e SUPER_ADMIN', () => {
      expect(ruoli('leggi')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
      for (const n of [
        'imposta',
        'verifica',
        'rigeneraToken',
        'impostaInvioAttivo',
        'impostaPassoOnboarding',
      ]) {
        expect(ruoli(n)).toEqual(['SUPER_ADMIN', 'ADMIN'])
      }
    })

    it('ogni rotta pubblica ha @Roles esplicito', () => {
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function' && n !== 'amministratore'
      )
      expect(metodi.sort()).toEqual(
        [
          'imposta',
          'impostaInvioAttivo',
          'impostaPassoOnboarding',
          'leggi',
          'rigeneraToken',
          'verifica',
        ].sort()
      )
      for (const n of metodi) expect(ruoli(n)?.length).toBeGreaterThan(0)
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let ruolo = 'ADMIN'
    let ruoloEffettivo: jest.Mock

    beforeEach(async () => {
      ruolo = 'ADMIN'
      ruoloEffettivo = jest.fn().mockResolvedValue('ADMIN')
      servizio = {
        leggi: jest.fn().mockResolvedValue({ configurata: false, versione: 0 }),
        imposta: jest.fn().mockResolvedValue({ configurata: true, versione: 1, webhookToken: 't' }),
        verifica: jest.fn().mockResolvedValue({ esito: { ok: true, dettaglio: 'ok' } }),
        rigeneraToken: jest.fn().mockResolvedValue({ versione: 2, webhookToken: 'n' }),
        impostaInvioAttivo: jest.fn().mockResolvedValue({ invioAttivo: true }),
        impostaPassoOnboarding: jest.fn().mockResolvedValue({ onboarding: {} }),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [ConfigurazioneSdiController],
        providers: [
          { provide: ConfigurazioneSdiService, useValue: servizio },
          { provide: RuoloEffettivoService, useValue: { accesso: jest.fn(), ruoloEffettivo } },
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

    it('GET: legge con l azienda selezionata (non quella del token)', async () => {
      await request(app.getHttpServer()).get('/sdi/configurazione').expect(200)
      expect(servizio.leggi).toHaveBeenCalledWith(TENANT)
    })

    it('GET senza azienda selezionata: errore, servizio mai chiamato', async () => {
      const r = await request(app.getHttpServer())
        .get('/sdi/configurazione')
        .set('x-senza-azienda', '1')
      expect(r.status).toBeGreaterThanOrEqual(400)
      expect(servizio.leggi).not.toHaveBeenCalled()
    })

    it('VIEWER e OPERATOR: 403 su ogni scrittura, servizio mai chiamato', async () => {
      for (const r of ['VIEWER', 'OPERATOR']) {
        ruolo = r
        await request(app.getHttpServer())
          .put('/sdi/configurazione')
          .send({ provider: 'fake', ambiente: 'SANDBOX', versione: 0 })
          .expect(403)
        await request(app.getHttpServer()).post('/sdi/configurazione/verifica').expect(403)
        await request(app.getHttpServer())
          .post('/sdi/configurazione/token')
          .send({ versione: 1 })
          .expect(403)
        await request(app.getHttpServer())
          .put('/sdi/configurazione/invio-attivo')
          .send({ attivo: true, versione: 1 })
          .expect(403)
        await request(app.getHttpServer())
          .put('/sdi/configurazione/onboarding')
          .send({ passo: 'X', fatto: true, versione: 1 })
          .expect(403)
      }
      for (const s of Object.values(servizio).filter(m => m !== servizio.leggi))
        expect(s).not.toHaveBeenCalled()
    })

    it('un ADMIN del token ma solo VIEWER nell azienda scelta: 403 e niente scritto', async () => {
      ruoloEffettivo.mockResolvedValue('VIEWER')
      const r = await request(app.getHttpServer())
        .put('/sdi/configurazione/invio-attivo')
        .send({ attivo: true, versione: 1 })
      expect(r.status).toBe(403)
      expect(servizio.impostaInvioAttivo).not.toHaveBeenCalled()
    })

    it('PUT: dto valido passa al servizio con utente e azienda', async () => {
      const dto = {
        provider: 'fake',
        ambiente: 'SANDBOX',
        credenziali: { apiKey: 'k' },
        versione: 0,
      }
      await request(app.getHttpServer()).put('/sdi/configurazione').send(dto).expect(200)
      expect(servizio.imposta).toHaveBeenCalledWith(TENANT, 'utente-1', dto)
    })

    it('PUT: campi mancanti o di troppo: 400', async () => {
      await request(app.getHttpServer())
        .put('/sdi/configurazione')
        .send({ provider: 'fake', versione: 0 })
        .expect(400)
      await request(app.getHttpServer())
        .put('/sdi/configurazione')
        .send({ provider: 'fake', ambiente: 'SANDBOX', versione: -1 })
        .expect(400)
      await request(app.getHttpServer())
        .put('/sdi/configurazione')
        .send({ provider: 'fake', ambiente: 'SANDBOX', versione: 0, invioAttivo: true })
        .expect(400)
      expect(servizio.imposta).not.toHaveBeenCalled()
    })

    it('invio-attivo: il 409 SDI_NON_VERIFICATO arriva nel body', async () => {
      servizio.impostaInvioAttivo.mockRejectedValue(
        new ConflictException({ error: 'SDI_NON_VERIFICATO', message: 'Verifica prima' })
      )
      const r = await request(app.getHttpServer())
        .put('/sdi/configurazione/invio-attivo')
        .send({ attivo: true, versione: 1 })
      expect(r.status).toBe(409)
      expect(r.body.error ?? r.body.message).toBeDefined()
      expect(JSON.stringify(r.body)).toContain('SDI_NON_VERIFICATO')
    })

    it('ruolo effettivo rifiutato dal servizio di appartenenza: 403', async () => {
      ruoloEffettivo.mockRejectedValue(new ForbiddenException())
      await request(app.getHttpServer()).post('/sdi/configurazione/verifica').expect(403)
      expect(servizio.verifica).not.toHaveBeenCalled()
    })
  })
})
