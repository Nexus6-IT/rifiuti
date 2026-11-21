/**
 * Rotte `/push/*` attraverso la catena HTTP reale (ValidationPipe, filtro globale, interceptor
 * ruolo autista e moduli). Il servizio e' finto: ha i suoi test su Postgres.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import {
  PushEndpointNonAmmessoError,
  PushNonDisponibileError,
} from '../../application/campo/errori-campo'
import { PushCampoService } from '../../application/campo/push-campo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { ModuloAttivoInterceptor } from '../../core/interceptors/modulo-attivo.interceptor'
import { RuoloAutistaInterceptor } from '../../core/interceptors/ruolo-autista.interceptor'
import { PushController } from './push.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-00000000000a'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123'

describe('Push - catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let moduliAttivi: string[]
  let push: Record<string, jest.Mock>

  beforeEach(async () => {
    ruolo = 'AUTISTA'
    moduliAttivi = ['campo']
    push = {
      chiavePubblica: jest.fn().mockReturnValue('BPubblica'),
      sottoscrivi: jest.fn().mockResolvedValue(undefined),
      annulla: jest.fn().mockResolvedValue(undefined),
      preferenze: jest.fn().mockResolvedValue({ giroModificato: true }),
      impostaPreferenze: jest.fn().mockImplementation(async (_t, _u, v) => v),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [PushController],
      providers: [
        { provide: PushCampoService, useValue: push },
        { provide: ModuliAttiviService, useValue: { moduliAttivi: async () => moduliAttivi } },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
        {
          provide: APP_INTERCEPTOR,
          useFactory: () => new RuoloAutistaInterceptor(new Reflector()),
        },
        {
          provide: APP_INTERCEPTOR,
          inject: [ModuliAttiviService],
          useFactory: (m: ModuliAttiviService) => new ModuloAttivoInterceptor(new Reflector(), m),
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest()
          req.user = { id: UTENTE, tenantId: TENANT, role: ruolo }
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

  const http = () => request(app.getHttpServer())

  it('configurazione: disponibile con la chiave pubblica, non disponibile senza (mai la privata)', async () => {
    let r = await http().get('/push/configurazione').expect(200)
    expect(r.body).toEqual({ disponibile: true, chiavePubblica: 'BPubblica' })
    push.chiavePubblica.mockReturnValue(null)
    r = await http().get('/push/configurazione').expect(200)
    expect(r.body).toEqual({ disponibile: false, chiavePubblica: null })
  })

  it('sottoscrizione: azienda e utente vengono dal token, mai dal corpo', async () => {
    await http().put('/push/sottoscrizione').send({ endpoint: ENDPOINT }).expect(204)
    expect(push.sottoscrivi).toHaveBeenCalledWith(TENANT, UTENTE, ENDPOINT)
    for (const extra of [{ utenteId: UTENTE }, { tenantId: TENANT }]) {
      await http()
        .put('/push/sottoscrizione')
        .send({ endpoint: ENDPOINT, ...extra })
        .expect(400)
    }
    expect(push.sottoscrivi).toHaveBeenCalledTimes(1)
  })

  it('sottoscrizione: endpoint mancante, non https o troppo lungo = 400 senza chiamare il servizio', async () => {
    for (const endpoint of [
      undefined,
      'http://fcm.googleapis.com/x',
      42,
      `https://${'a'.repeat(2000)}`,
    ]) {
      await http().put('/push/sottoscrizione').send({ endpoint }).expect(400)
    }
    expect(push.sottoscrivi).not.toHaveBeenCalled()
  })

  it('funzione spenta: 503 PUSH_NON_DISPONIBILE; endpoint non ammesso: 400 con codice', async () => {
    push.sottoscrivi.mockRejectedValueOnce(new PushNonDisponibileError())
    const r = await http().put('/push/sottoscrizione').send({ endpoint: ENDPOINT }).expect(503)
    expect(JSON.stringify(r.body)).toContain('PUSH_NON_DISPONIBILE')
    push.sottoscrivi.mockRejectedValueOnce(new PushEndpointNonAmmessoError())
    const r2 = await http().put('/push/sottoscrizione').send({ endpoint: ENDPOINT }).expect(400)
    expect(JSON.stringify(r2.body)).toContain('PUSH_ENDPOINT_NON_AMMESSO')
  })

  it('annulla (logout): 204, solo per l utente del token', async () => {
    await http().post('/push/sottoscrizione/annulla').send({ endpoint: ENDPOINT }).expect(204)
    expect(push.annulla).toHaveBeenCalledWith(TENANT, UTENTE, ENDPOINT)
  })

  it('preferenze: lettura e scrittura sull utente del token; valore non booleano = 400', async () => {
    await http().get('/push/preferenze').expect(200, { giroModificato: true })
    expect(push.preferenze).toHaveBeenCalledWith(TENANT, UTENTE)
    await http()
      .put('/push/preferenze')
      .send({ giroModificato: false })
      .expect(200, { giroModificato: false })
    expect(push.impostaPreferenze).toHaveBeenCalledWith(TENANT, UTENTE, { giroModificato: false })
    await http().put('/push/preferenze').send({ giroModificato: 'no' }).expect(400)
    await http().put('/push/preferenze').send({}).expect(400)
  })

  it('anche un utente d ufficio puo usarle (il pezzo P8 le riusa); senza il modulo campo e 403', async () => {
    ruolo = 'ADMIN'
    await http().get('/push/preferenze').expect(200)
    moduliAttivi = ['ritiri']
    const r = await http().get('/push/configurazione').expect(403)
    expect(JSON.stringify(r.body)).toContain('MODULO_NON_ATTIVO')
    await http().put('/push/sottoscrizione').send({ endpoint: ENDPOINT }).expect(403)
    expect(push.sottoscrivi).not.toHaveBeenCalled()
  })
})
