/**
 * InvioSdiController (4.5b) con pipe, guard dei ruoli e filtro reali e servizio finto: validazione del
 * DTO, 202, ruoli (metadata e comportamento), azienda selezionata, ruolo effettivo.
 */
import {
  ConflictException,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { InvioSdiController } from './invio-sdi.controller'
import { InvioSdiService } from '../../application/sdi/invio-sdi.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RICHIEDE_MODULO } from '../../core/decorators/richiede-modulo.decorator'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-0000000000aa'
const DOC = '6b6b6b6b-0000-4000-8000-0000000000bb'

describe('InvioSdiController', () => {
  describe('metadata', () => {
    const reflector = new Reflector()
    const proto = InvioSdiController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it('il controller richiede il modulo sdi', () => {
      expect(reflector.get(RICHIEDE_MODULO, InvioSdiController)).toEqual(['sdi'])
    })

    it('invio e riprova solo ADMIN e SUPER_ADMIN', () => {
      expect(ruoli('invia')).toEqual(['SUPER_ADMIN', 'ADMIN'])
      expect(ruoli('riprova')).toEqual(['SUPER_ADMIN', 'ADMIN'])
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
        accoda: jest.fn().mockResolvedValue({ accodate: [], saltate: [] }),
        riprova: jest.fn().mockResolvedValue({ documentoId: DOC, trasmissioneId: 't', avvisi: [] }),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [InvioSdiController],
        providers: [
          { provide: InvioSdiService, useValue: servizio },
          { provide: RuoloEffettivoService, useValue: { accesso: jest.fn(), ruoloEffettivo } },
          { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (ctx: ExecutionContext) => {
            const req = ctx.switchToHttp().getRequest()
            req.user = { id: 'utente-1', tenantId: 'altro-tenant-del-token', role: ruolo }
            req.tenantId = TENANT
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

    it('POST invio-sdi: 202 e il servizio riceve azienda selezionata, utente, ids e conferma', async () => {
      const r = await request(app.getHttpServer())
        .post('/documenti-fattura/invio-sdi')
        .send({ ids: [DOC], confermaGiaEmesso: true })
        .expect(202)
      expect(r.body).toEqual({ accodate: [], saltate: [] })
      expect(servizio.accoda).toHaveBeenCalledWith(TENANT, 'utente-1', {
        ids: [DOC],
        confermaGiaEmesso: true,
      })
    })

    it('POST invio-sdi: corpo non valido (ids mancanti, tipo sbagliato, campi in piu): 400, servizio mai chiamato', async () => {
      const post = () => request(app.getHttpServer()).post('/documenti-fattura/invio-sdi')
      await post().send({}).expect(400)
      await post().send({ ids: 'x' }).expect(400)
      await post()
        .send({ ids: [1] })
        .expect(400)
      await post()
        .send({ ids: [DOC], confermaGiaEmesso: 'si' })
        .expect(400)
      await post()
        .send({ ids: [DOC], tenantId: 'altra' })
        .expect(400)
      expect(servizio.accoda).not.toHaveBeenCalled()
    })

    it('VIEWER e OPERATOR: 403, servizio mai chiamato', async () => {
      for (const r of ['VIEWER', 'OPERATOR']) {
        ruolo = r
        await request(app.getHttpServer())
          .post('/documenti-fattura/invio-sdi')
          .send({ ids: [DOC] })
          .expect(403)
        await request(app.getHttpServer())
          .post(`/documenti-fattura/${DOC}/invio-sdi/riprova`)
          .expect(403)
      }
      expect(servizio.accoda).not.toHaveBeenCalled()
      expect(servizio.riprova).not.toHaveBeenCalled()
    })

    it('un ADMIN del token ma solo VIEWER nell azienda scelta: 403 e niente accodato', async () => {
      ruoloEffettivo.mockResolvedValue('VIEWER')
      await request(app.getHttpServer())
        .post('/documenti-fattura/invio-sdi')
        .send({ ids: [DOC] })
        .expect(403)
      expect(servizio.accoda).not.toHaveBeenCalled()
    })

    it('il 409 del servizio (INVIO_SDI_NON_ATTIVO) arriva nel body con il codice', async () => {
      servizio.accoda.mockRejectedValue(
        new ConflictException({ error: 'INVIO_SDI_NON_ATTIVO', message: 'spento' })
      )
      const r = await request(app.getHttpServer())
        .post('/documenti-fattura/invio-sdi')
        .send({ ids: [DOC] })
        .expect(409)
      expect(JSON.stringify(r.body)).toContain('INVIO_SDI_NON_ATTIVO')
    })

    it('POST :id/invio-sdi/riprova: 202; id non UUID: 400', async () => {
      await request(app.getHttpServer())
        .post(`/documenti-fattura/${DOC}/invio-sdi/riprova`)
        .expect(202)
      expect(servizio.riprova).toHaveBeenCalledWith(TENANT, 'utente-1', DOC)
      await request(app.getHttpServer())
        .post('/documenti-fattura/non-un-uuid/invio-sdi/riprova')
        .expect(400)
    })
  })
})
