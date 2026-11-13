/**
 * Rotte dell'agente di pesa attraverso la catena HTTP reale (ValidationPipe come in main.ts, filtro
 * globale, `AgentePesaGuard`, limiti di frequenza veri col `ThrottlerGuard` globale attivo come in
 * `AppModule`). Risoluzione del token, moduli e servizi sono finti.
 */
import { Test } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { AbbinamentoAgenteService } from '../../application/pese/agenti/abbinamento-agente.service'
import { IngressoLettureService } from '../../application/pese/agenti/ingresso-letture.service'
import { BattitoAgenteService } from '../../application/pese/agenti/battito-agente.service'
import { RisoluzioneAgenteService } from '../../application/pese/agenti/risoluzione-agente.service'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import {
  CodiceAbbinamentoNonValidoError,
  LottoOltreTempoError,
} from '../../application/pese/errori-pese'
import { hashSegreto } from '../../domain/pese/agenti/credenziali-agente'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { valoreTrustProxy } from '../../core/http/trust-proxy'
import { AgentePesaGuard } from './agente-pesa.guard'
import { IngressoAgenteController } from './ingresso-agente.controller'
import { ThrottlerAbbinamentoGuard } from './throttler-abbinamento.guard'
import { FallimentiAutenticazione, LIMITE_FALLIMENTI_PER_IP } from './fallimenti-autenticazione'
import { ThrottlerAgenteGuard } from './throttler-agente.guard'

const TENANT = '5a5a5a5a-0000-4000-8000-00000000000a'
const ALTRO_TENANT = '5a5a5a5a-0000-4000-8000-00000000000b'
const AGENTE = 'a9a9a9a9-0000-4000-8000-000000000001'
const TOKEN = `wfpa_${'A'.repeat(43)}`
const CHIAVE_PUB = 'A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg='

describe('IngressoAgenteController (abbinamento, configurazione) - catena HTTP', () => {
  let app: INestApplication
  let abbinamento: Record<string, jest.Mock>
  let letture: Record<string, jest.Mock>
  let battito: Record<string, jest.Mock>
  let stato: 'ATTIVO' | 'REVOCATO'

  beforeEach(async () => {
    stato = 'ATTIVO'
    abbinamento = {
      abbina: jest.fn().mockResolvedValue({ agenteId: AGENTE, token: TOKEN, strumenti: [] }),
      configurazione: jest.fn().mockResolvedValue({ agenteId: AGENTE, strumenti: [] }),
    }
    battito = {
      registra: jest
        .fn()
        .mockResolvedValue({ oraServer: 'x', simulazioneAmmessa: false, revocato: false }),
    }
    letture = { riceviLotto: jest.fn().mockResolvedValue([]) }
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
      controllers: [IngressoAgenteController],
      providers: [
        { provide: AbbinamentoAgenteService, useValue: abbinamento },
        { provide: IngressoLettureService, useValue: letture },
        { provide: BattitoAgenteService, useValue: battito },
        {
          provide: RisoluzioneAgenteService,
          useValue: {
            daToken: jest.fn(async (h: string) =>
              h === hashSegreto(TOKEN) ? { id: AGENTE, tenantId: TENANT, stato } : null
            ),
          },
        },
        { provide: ModuliAttiviService, useValue: { moduliAttivi: async () => ['pese'] } },
        AgentePesaGuard,
        ThrottlerAgenteGuard,
        ThrottlerAbbinamentoGuard,
        FallimentiAutenticazione,
        // Come in AppModule: il limite globale per IP c'e', e le rotte dell'agente lo escludono.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    }).compile()
    app = moduleRef.createNestApplication()
    // Come in main.ts: nginx sullo stesso host, un hop di loopback.
    app.getHttpAdapter().getInstance().set('trust proxy', valoreTrustProxy(undefined))
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
  })

  afterEach(async () => {
    await app.close()
  })

  const http = () => request(app.getHttpServer())
  const corpo = {
    codice: 'ABCD-EFGH-JK23',
    chiavePubblica: CHIAVE_PUB,
    nomeHost: 'PC',
    versione: '1.0',
  }

  describe('POST /agenti-pesa/abbinamento', () => {
    it('è pubblica: funziona senza JWT e risponde 201 col token', async () => {
      const r = await http().post('/agenti-pesa/abbinamento').send(corpo).expect(201)
      expect(r.body).toMatchObject({ agenteId: AGENTE, token: TOKEN })
      expect(abbinamento.abbina).toHaveBeenCalledWith(corpo)
    })

    it('codice non valido: 401 CODICE_NON_VALIDO con il messaggio fisso', async () => {
      abbinamento.abbina.mockRejectedValue(new CodiceAbbinamentoNonValidoError())
      const r = await http().post('/agenti-pesa/abbinamento').send(corpo).expect(401)
      expect(r.body).toMatchObject({
        error: 'CODICE_NON_VALIDO',
        message: 'Codice di abbinamento non valido o scaduto.',
      })
    })

    it('chiave pubblica che non è base64 di 32 byte: 400 senza toccare il servizio', async () => {
      await http()
        .post('/agenti-pesa/abbinamento')
        .send({ ...corpo, chiavePubblica: 'troppo-corta' })
        .expect(400)
      expect(abbinamento.abbina).not.toHaveBeenCalled()
    })

    it('11 abbinamenti in un minuto dallo stesso IP: l’undicesimo è 429 con Retry-After', async () => {
      for (let i = 0; i < 10; i++)
        await http().post('/agenti-pesa/abbinamento').send(corpo).expect(201)
      const r = await http().post('/agenti-pesa/abbinamento').send(corpo).expect(429)
      expect(Number(r.headers['retry-after'])).toBeGreaterThan(0)
    })
  })

  describe('GET /agenti-pesa/configurazione', () => {
    it('col token risponde 200 con la configurazione dell’agente del token', async () => {
      await http()
        .get('/agenti-pesa/configurazione')
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(200)
      expect(abbinamento.configurazione).toHaveBeenCalledWith({ id: AGENTE, tenantId: TENANT })
    })

    it('l’header X-Tenant-ID di un’altra azienda è ignorato: l’azienda è quella del token', async () => {
      await http()
        .get('/agenti-pesa/configurazione')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('X-Tenant-ID', ALTRO_TENANT)
        .expect(200)
      expect(abbinamento.configurazione).toHaveBeenCalledWith({ id: AGENTE, tenantId: TENANT })
    })

    it('senza token 401 TOKEN_NON_VALIDO; token ignoto 401; revocato 403 AGENTE_REVOCATO', async () => {
      const senza = await http().get('/agenti-pesa/configurazione').expect(401)
      expect(senza.body.error).toBe('TOKEN_NON_VALIDO')
      await http()
        .get('/agenti-pesa/configurazione')
        .set('Authorization', `Bearer wfpa_${'B'.repeat(43)}`)
        .expect(401)
      stato = 'REVOCATO'
      const rev = await http()
        .get('/agenti-pesa/configurazione')
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(403)
      expect(rev.body.error).toBe('AGENTE_REVOCATO')
    })

    it('11 richieste in un minuto dello stesso agente: l’undicesima è 429 (non per IP: 10/s globale escluso)', async () => {
      for (let i = 0; i < 10; i++) {
        await http()
          .get('/agenti-pesa/configurazione')
          .set('Authorization', `Bearer ${TOKEN}`)
          .expect(200)
      }
      const r = await http()
        .get('/agenti-pesa/configurazione')
        .set('Authorization', `Bearer ${TOKEN}`)
        .expect(429)
      expect(r.headers['retry-after']).toBeDefined()
    })

    it('token ignoti: dopo il tetto per IP 429, e un agente valido da un altro IP passa ancora', async () => {
      const ignoto = `Bearer wfpa_${'C'.repeat(43)}`
      for (let i = 0; i < LIMITE_FALLIMENTI_PER_IP; i++) {
        await http()
          .get('/agenti-pesa/configurazione')
          .set('Authorization', ignoto)
          .set('X-Forwarded-For', '203.0.113.50')
          .expect(401)
      }
      const r = await http()
        .get('/agenti-pesa/configurazione')
        .set('Authorization', ignoto)
        .set('X-Forwarded-For', '203.0.113.50')
        .expect(429)
      expect(r.headers['retry-after']).toBeDefined()
      // Il token VALIDO dello stesso IP bloccato e' fermato prima del database; da un altro IP passa.
      await http()
        .get('/agenti-pesa/configurazione')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('X-Forwarded-For', '203.0.113.51')
        .expect(200)
    })

    it('le richieste autenticate non contano per il tetto d’ingresso (agente valido sopra il tetto)', async () => {
      // il limite per agente (10/min) scatta comunque; qui basta che il conteggio dei rifiuti resti a zero
      for (let i = 0; i < 10; i++) {
        await http()
          .get('/agenti-pesa/configurazione')
          .set('Authorization', `Bearer ${TOKEN}`)
          .set('X-Forwarded-For', '203.0.113.60')
          .expect(200)
      }
      const f = app.get(FallimentiAutenticazione)
      expect(f.bloccatoPer('203.0.113.60')).toBeNull()
    })
  })

  describe('POST /agenti-pesa/letture', () => {
    const el = { payload: Buffer.from('{}').toString('base64'), firma: `${'A'.repeat(86)}==` }
    const manda = (corpo: unknown, token = TOKEN) =>
      http()
        .post('/agenti-pesa/letture')
        .set('Authorization', `Bearer ${token}`)
        .send(corpo as object)

    it('un lotto valido risponde 200 con gli esiti e passa l’agente del token', async () => {
      letture.riceviLotto.mockResolvedValue([{ chiaveIdempotenza: null, esito: 'ACCETTATA' }])
      const r = await manda({ letture: [el] }).expect(200)
      expect(r.body).toEqual({ esiti: [{ chiaveIdempotenza: null, esito: 'ACCETTATA' }] })
      expect(letture.riceviLotto.mock.calls[0][0]).toEqual({ id: AGENTE, tenantId: TENANT })
      expect(letture.riceviLotto.mock.calls[0][1]).toHaveLength(1)
    })

    it('51 elementi, lotto vuoto, base64 sbagliato o firma di lunghezza sbagliata: 400', async () => {
      await manda({ letture: Array.from({ length: 51 }, () => el) }).expect(400)
      await manda({ letture: [] }).expect(400)
      await manda({ letture: [{ ...el, payload: 'non base64!' }] }).expect(400)
      await manda({ letture: [{ ...el, firma: 'AAAA' }] }).expect(400)
      await manda({ letture: [{ ...el, extra: 1 }] }).expect(400)
      expect(letture.riceviLotto).not.toHaveBeenCalled()
    })

    it('corpo che non è JSON: 400', async () => {
      await http()
        .post('/agenti-pesa/letture')
        .set('Authorization', `Bearer ${TOKEN}`)
        .set('Content-Type', 'application/json')
        .send('{non json')
        .expect(400)
    })

    it('61 richieste in un minuto dello stesso agente: la 61a è 429 con Retry-After', async () => {
      for (let i = 0; i < 60; i++) await manda({ letture: [el] }).expect(200)
      const r = await manda({ letture: [el] }).expect(429)
      expect(r.headers['retry-after']).toBeDefined()
    })

    it('agente revocato fra due richieste: la seconda è 403', async () => {
      await manda({ letture: [el] }).expect(200)
      stato = 'REVOCATO'
      const r = await manda({ letture: [el] }).expect(403)
      expect(r.body.error).toBe('AGENTE_REVOCATO')
    })

    it('lotto oltre il tempo massimo: 503 LOTTO_OLTRE_TEMPO', async () => {
      letture.riceviLotto.mockRejectedValue(new LottoOltreTempoError())
      const r = await manda({ letture: [el] }).expect(503)
      expect(r.body.error).toBe('LOTTO_OLTRE_TEMPO')
    })
  })

  describe('POST /agenti-pesa/battito', () => {
    const corpo = {
      versione: '1.0.0',
      oraAgente: '2026-11-13T09:15:03.123Z',
      codaInAttesa: 0,
      lettureScartate: 0,
      ultimaSequenza: 41,
      strumenti: [{ strumentoId: AGENTE, stato: 'OK' }],
    }
    const manda = (c: unknown) =>
      http()
        .post('/agenti-pesa/battito')
        .set('Authorization', `Bearer ${TOKEN}`)
        .send(c as object)

    it('200 con la risposta del servizio; l’agente è quello del token', async () => {
      await manda(corpo).expect(200)
      expect(battito.registra.mock.calls[0][0]).toEqual({ id: AGENTE, tenantId: TENANT })
    })

    it('ora senza offset, stato sconosciuto, numeri negativi: 400', async () => {
      await manda({ ...corpo, oraAgente: '2026-11-13T09:15:03' }).expect(400)
      await manda({ ...corpo, strumenti: [{ strumentoId: AGENTE, stato: 'BOH' }] }).expect(400)
      await manda({ ...corpo, codaInAttesa: -1 }).expect(400)
      expect(battito.registra).not.toHaveBeenCalled()
    })

    it('agente revocato: 403', async () => {
      stato = 'REVOCATO'
      await manda(corpo).expect(403)
    })
  })
})
