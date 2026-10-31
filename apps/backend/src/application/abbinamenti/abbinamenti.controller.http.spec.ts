/**
 * API degli abbinamenti attraverso la catena HTTP reale: ValidationPipe di main.ts, filtro globale
 * delle eccezioni, controller. Servizio e ruolo effettivo sono finti (il servizio ha i suoi test).
 */
import { Test } from '@nestjs/testing'
import {
  ExecutionContext,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import request from 'supertest'
import { AbbinamentiController } from './abbinamenti.controller'
import { AbbinamentiService } from './abbinamenti.service'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const TENANT_TOKEN = '5a5a5a5a-0000-4000-8000-00000000000a'
const TENANT_SEL = '5a5a5a5a-0000-4000-8000-00000000000b'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const REG = '3b3b3b3b-0000-4000-8000-000000000006'
const SC = '4c4c4c4c-0000-4000-8000-000000000007'
const CA = '4c4c4c4c-0000-4000-8000-000000000008'

describe('AbbinamentiController - catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let servizio: Record<string, jest.Mock>

  beforeEach(async () => {
    ruolo = 'ADMIN'
    servizio = {
      vista: jest.fn().mockResolvedValue({ registroId: REG, ambiti: [] }),
      proposta: jest.fn().mockResolvedValue({}),
      salvaManuale: jest.fn().mockResolvedValue({ scarico: {}, avvisi: [] }),
      ricalcola: jest.fn().mockResolvedValue({
        scarichiAbbinati: 0,
        righeScritte: 0,
        righeCancellate: 0,
        avvisi: [],
      }),
      differenze: jest.fn().mockResolvedValue([]),
    }
    const logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    const moduleRef = await Test.createTestingModule({
      controllers: [AbbinamentiController],
      providers: [
        { provide: AbbinamentiService, useValue: servizio },
        {
          provide: RuoloEffettivoService,
          useValue: { ruoloEffettivo: jest.fn(async () => ruolo) },
        },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger as never) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest()
          req.user = { id: UTENTE, tenantId: TENANT_TOKEN, role: 'ADMIN' }
          const sel = req.headers['x-tenant-id']
          if (typeof sel === 'string') req.tenantId = sel
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
    await app?.close()
  })
  const http = () => request(app.getHttpServer())
  const riga = { caricoId: CA, quantita: 10 }

  it('GET senza registroId o non UUID: 400; valido: usa l azienda selezionata', async () => {
    expect((await http().get('/abbinamenti')).status).toBe(400)
    expect((await http().get('/abbinamenti?registroId=xyz')).status).toBe(400)
    expect(
      (await http().get(`/abbinamenti?registroId=${REG}`).set('X-Tenant-ID', TENANT_SEL)).status
    ).toBe(200)
    expect(servizio.vista).toHaveBeenCalledWith(TENANT_SEL, REG, undefined, 'ADMIN')
  })

  it('`oggi` non e un parametro dell API', async () => {
    expect((await http().get(`/abbinamenti?registroId=${REG}&oggi=2026-01-01`)).status).toBe(400)
  })

  it('id dello scarico non UUID: 400 in italiano senza id', async () => {
    const res = await http().get('/abbinamenti/scarichi/abc/proposta')
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.body)).toContain('Identificativo non valido')
    expect((await http().put('/abbinamenti/scarichi/abc').send({ righe: [] })).status).toBe(400)
  })

  it('PUT: piu di 500 righe, quantita negativa o zero, ids non UUID: 400', async () => {
    const put = (body: object) => http().put(`/abbinamenti/scarichi/${SC}`).send(body)
    expect((await put({ righe: Array.from({ length: 501 }, () => riga) })).status).toBe(400)
    expect((await put({ righe: [{ caricoId: CA, quantita: -1 }] })).status).toBe(400)
    expect((await put({ righe: [{ caricoId: CA, quantita: 0 }] })).status).toBe(400)
    expect((await put({ righe: [{ caricoId: 'x', quantita: 1 }] })).status).toBe(400)
    expect((await put({ righe: [{ giacenzaInizialeId: 'x', quantita: 1 }] })).status).toBe(400)
    expect((await put({})).status).toBe(400)
    const troppo = await put({ righe: [{ caricoId: CA, quantita: 1_000_000_000 }] })
    expect(troppo.status).toBe(400)
    expect(JSON.stringify(troppo.body)).toContain('La quantità non può superare 999.999.999,999.')
    expect((await put({ righe: [{ ...riga, extra: 1 }] })).status).toBe(400)
    expect(servizio.salvaManuale).not.toHaveBeenCalled()
    // il massimo di DECIMAL(12,3) e ammesso (non e un 400 di validazione)
    expect((await put({ righe: [{ caricoId: CA, quantita: 999_999_999.999 }] })).status).not.toBe(
      400
    )
  })

  it('PUT con carico e giacenza insieme: 400 col messaggio previsto', async () => {
    const res = await http()
      .put(`/abbinamenti/scarichi/${SC}`)
      .send({ righe: [{ caricoId: CA, giacenzaInizialeId: CA, quantita: 1 }] })
    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Indica un carico oppure una giacenza iniziale, non entrambi.')
  })

  it('PUT valido: l utente autenticato e le righe arrivano al servizio; elenco vuoto ammesso', async () => {
    expect(
      (
        await http()
          .put(`/abbinamenti/scarichi/${SC}`)
          .send({ righe: [riga] })
      ).status
    ).toBe(200)
    expect(servizio.salvaManuale).toHaveBeenCalledWith(TENANT_TOKEN, UTENTE, SC, [riga])
    expect((await http().put(`/abbinamenti/scarichi/${SC}`).send({ righe: [] })).status).toBe(200)
  })

  it('PUT per VIEWER: 403', async () => {
    ruolo = 'VIEWER'
    const res = await http().put(`/abbinamenti/scarichi/${SC}`).send({ righe: [] })
    expect(res.status).toBe(403)
    expect(res.body.message).toBe('Il tuo ruolo non consente di modificare gli abbinamenti.')
  })

  it('scarico o registro di un altra azienda: 404 senza id', async () => {
    servizio.proposta.mockRejectedValue(new NotFoundException('Scarico non trovato'))
    const res = await http().get(`/abbinamenti/scarichi/${SC}/proposta`)
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Scarico non trovato')
    const { RegistroNonTrovatoError } = await import('../registro/registri.service')
    servizio.vista.mockRejectedValue(new RegistroNonTrovatoError())
    const r2 = await http().get(`/abbinamenti?registroId=${REG}`)
    expect(r2.status).toBe(404)
    expect(r2.body.message).toBe('Registro non trovato.')
  })

  it('ricalcolo: modalita e registroId validati; AUTOMATICI per OPERATOR e 403', async () => {
    const post = (b: object) => http().post('/abbinamenti/ricalcolo').send(b)
    expect((await post({ registroId: REG, modalita: 'TUTTO' })).status).toBe(400)
    expect((await post({ modalita: 'AUTOMATICI' })).status).toBe(400)
    expect((await post({ registroId: 'x', modalita: 'AUTOMATICI' })).status).toBe(400)
    expect((await post({ registroId: REG, modalita: 'AUTOMATICI', cerCode: 'abc' })).status).toBe(
      400
    )
    expect(
      (await post({ registroId: REG, modalita: 'AUTOMATICI', cerCode: '99 99 11' })).status
    ).toBe(200)
    ruolo = 'OPERATOR'
    expect((await post({ registroId: REG, modalita: 'NON_ABBINATI' })).status).toBe(200)
    const res = await post({ registroId: REG, modalita: 'AUTOMATICI' })
    expect(res.status).toBe(403)
    expect(res.body.message).toBe(
      "Solo un amministratore dell'azienda può ricalcolare gli abbinamenti automatici."
    )
  })

  it('differenze: registroId obbligatorio', async () => {
    expect((await http().get('/abbinamenti/differenze')).status).toBe(400)
    expect((await http().get(`/abbinamenti/differenze?registroId=${REG}`)).status).toBe(200)
    expect(servizio.differenze).toHaveBeenCalledWith(TENANT_TOKEN, REG, undefined)
  })
})
