/**
 * Webhook SDI attraverso la catena HTTP reale: `rawBody` come in `main.ts`, `@Public`, filtro globale,
 * limite di frequenza dedicato (col `ThrottlerGuard` globale attivo come in `AppModule`). Il servizio e'
 * finto: qui si prova cosa vede il chiamante (stati e corpi delle risposte), non la logica.
 */
import { INestApplication } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { WebhookSdiService } from '../../application/sdi/webhook-sdi.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { WebhookSdiController } from './webhook-sdi.controller'
import { LIMITE_WEBHOOK_SDI, ThrottlerWebhookSdiGuard } from './throttler-webhook-sdi.guard'

const TOKEN = 'A'.repeat(43)
const TENANT = 'aaaaaaaa-0000-4000-8000-00000000000a'

describe('WebhookSdiController - catena HTTP', () => {
  let app: INestApplication
  let ricevi: jest.Mock

  beforeEach(async () => {
    ricevi = jest.fn().mockResolvedValue({ tipo: 'RICEVUTO' })
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          { name: 'short', ttl: 1000, limit: 10 },
          { name: 'medium', ttl: 60_000, limit: 100 },
          { name: 'long', ttl: 900_000, limit: 1000 },
        ]),
      ],
      controllers: [WebhookSdiController],
      providers: [
        { provide: WebhookSdiService, useValue: { ricevi } },
        ThrottlerWebhookSdiGuard,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    }).compile()
    app = moduleRef.createNestApplication({ rawBody: true })
    await app.init()
  })
  afterEach(async () => {
    await app.close()
  })

  const post = (token = TOKEN, corpo: object | string = { id: 'e1' }, provider = 'fake') =>
    request(app.getHttpServer())
      .post(`/sdi/webhook/${provider}/${token}`)
      .set('x-sdi-signature', 't=1,v1=abc')
      .set('content-type', 'application/json')
      .send(typeof corpo === 'string' ? corpo : JSON.stringify(corpo))

  it('e pubblica: 200 { ricevuto: true } senza JWT, e il servizio riceve il raw body e le intestazioni', async () => {
    const r = await post().expect(200)
    expect(r.body).toEqual({ ricevuto: true })
    const [provider, token, intestazioni, corpo] = ricevi.mock.calls[0]
    expect(provider).toBe('fake')
    expect(token).toBe(TOKEN)
    expect(intestazioni['x-sdi-signature']).toBe('t=1,v1=abc')
    // Byte esatti del corpo (serve all'HMAC): niente ri-serializzazione.
    expect((corpo as Buffer).toString('utf8')).toBe('{"id":"e1"}')
  })

  it('corpo con spazi e ordine delle chiavi non canonici: il servizio vede i byte originali', async () => {
    await post(TOKEN, '{ "z": 1,  "a": 2 }').expect(200)
    expect((ricevi.mock.calls[0][3] as Buffer).toString('utf8')).toBe('{ "z": 1,  "a": 2 }')
  })

  it('NON_TROVATO -> 404 generico, senza dati dell’azienda', async () => {
    ricevi.mockResolvedValue({ tipo: 'NON_TROVATO' })
    const r = await post().expect(404)
    expect(JSON.stringify(r.body)).not.toContain(TENANT)
  })

  it('NON_AUTENTICO -> 401 generico', async () => {
    ricevi.mockResolvedValue({ tipo: 'NON_AUTENTICO' })
    const r = await post().expect(401)
    expect(JSON.stringify(r.body)).not.toContain(TENANT)
  })

  it('errore del servizio -> 503 senza il messaggio del driver', async () => {
    ricevi.mockRejectedValue(new Error('password=segreta host=db.interno'))
    const r = await post().expect(503)
    expect(JSON.stringify(r.body)).not.toContain('segreta')
  })

  it('corpo vuoto -> 404 senza chiamare il servizio', async () => {
    await request(app.getHttpServer()).post(`/sdi/webhook/fake/${TOKEN}`).expect(404)
    expect(ricevi).not.toHaveBeenCalled()
  })

  it(`oltre ${LIMITE_WEBHOOK_SDI} richieste al minuto dallo stesso IP: 429`, async () => {
    for (let i = 0; i < LIMITE_WEBHOOK_SDI; i++) await post().expect(200)
    await post().expect(429)
  }, 60_000)
})
