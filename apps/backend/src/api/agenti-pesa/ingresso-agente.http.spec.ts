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
import { RisoluzioneAgenteService } from '../../application/pese/agenti/risoluzione-agente.service'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { CodiceAbbinamentoNonValidoError } from '../../application/pese/errori-pese'
import { hashSegreto } from '../../domain/pese/agenti/credenziali-agente'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { AgentePesaGuard } from './agente-pesa.guard'
import { IngressoAgenteController } from './ingresso-agente.controller'
import { ThrottlerAbbinamentoGuard } from './throttler-abbinamento.guard'
import { ThrottlerIngressoGuard, LIMITE_INGRESSO_PER_ROTTA } from './throttler-ingresso.guard'
import { ThrottlerAgenteGuard } from './throttler-agente.guard'

const TENANT = '5a5a5a5a-0000-4000-8000-00000000000a'
const ALTRO_TENANT = '5a5a5a5a-0000-4000-8000-00000000000b'
const AGENTE = 'a9a9a9a9-0000-4000-8000-000000000001'
const TOKEN = `wfpa_${'A'.repeat(43)}`
const CHIAVE_PUB = 'A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg='

describe('IngressoAgenteController (abbinamento, configurazione) - catena HTTP', () => {
  let app: INestApplication
  let abbinamento: Record<string, jest.Mock>
  let stato: 'ATTIVO' | 'REVOCATO'

  beforeEach(async () => {
    stato = 'ATTIVO'
    abbinamento = {
      abbina: jest.fn().mockResolvedValue({ agenteId: AGENTE, token: TOKEN, strumenti: [] }),
      configurazione: jest.fn().mockResolvedValue({ agenteId: AGENTE, strumenti: [] }),
    }
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
        ThrottlerIngressoGuard,
        // Come in AppModule: il limite globale per IP c'e', e le rotte dell'agente lo escludono.
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    }).compile()
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

    it('token ignoti: dopo il tetto della rotta (prima dell’autenticazione) 429, non solo 401', async () => {
      const ignoto = `Bearer wfpa_${'C'.repeat(43)}`
      for (let i = 0; i < LIMITE_INGRESSO_PER_ROTTA; i++) {
        await http().get('/agenti-pesa/configurazione').set('Authorization', ignoto).expect(401)
      }
      const r = await http()
        .get('/agenti-pesa/configurazione')
        .set('Authorization', ignoto)
        .expect(429)
      expect(r.headers['retry-after']).toBeDefined()
    })
  })
})
