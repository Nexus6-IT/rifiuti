/**
 * Gestione degli agenti e letture dello strumento attraverso la catena HTTP reale (ValidationPipe,
 * filtro globale, controller). Servizi e ruolo finti: si provano permessi e forma delle richieste.
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import request from 'supertest'
import { AgentiPesaService } from '../../application/pese/agenti/agenti-pesa.service'
import { LetturePesaService } from '../../application/pese/agenti/letture-pesa.service'
import { StatoAccessoNonValidoError } from '../../application/pese/errori-pese'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { AgentiPesaController } from './agenti-pesa.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-00000000000a'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const ID = '3b3b3b3b-0000-4000-8000-000000000006'

describe('AgentiPesaController - catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let agenti: Record<string, jest.Mock>
  let letture: Record<string, jest.Mock>

  beforeEach(async () => {
    ruolo = 'ADMIN'
    agenti = {
      elenca: jest.fn().mockResolvedValue([]),
      crea: jest
        .fn()
        .mockResolvedValue({ agente: { id: ID }, codice: 'ABCD-EFGH-JK23', scadeIl: 'x' }),
      nuovoCodice: jest.fn().mockResolvedValue({ codice: 'ABCD-EFGH-JK23', scadeIl: 'x' }),
      revoca: jest.fn().mockResolvedValue({ id: ID, stato: 'REVOCATO' }),
      assegnaStrumento: jest.fn().mockResolvedValue({ strumentoId: ID, agenteId: null }),
    }
    letture = { elenca: jest.fn().mockResolvedValue([]) }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentiPesaController],
      providers: [
        { provide: AgentiPesaService, useValue: agenti },
        { provide: LetturePesaService, useValue: letture },
        { provide: RuoloEffettivoService, useValue: { ruoloEffettivo: async () => ruolo } },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest()
          req.user = { id: UTENTE, tenantId: TENANT, role: 'ADMIN' }
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

  it('GET /pese/agenti: chiunque nell’azienda, con puoGestire e i dati tecnici solo agli amministratori', async () => {
    ruolo = 'VIEWER'
    const r = await http().get('/pese/agenti').expect(200)
    expect(r.body).toEqual({ righe: [], puoGestire: false })
    expect(agenti.elenca).toHaveBeenCalledWith(TENANT, { vediDatiTecnici: false })
    ruolo = 'ADMIN'
    await http().get('/pese/agenti').expect(200)
    expect(agenti.elenca).toHaveBeenLastCalledWith(TENANT, { vediDatiTecnici: true })
  })

  it('un OPERATOR non gestisce: crea, codice, revoca e assegnazione → 403 PESE_RISERVATE_AMMINISTRATORI', async () => {
    ruolo = 'OPERATOR'
    const chiamate = [
      () => http().post('/pese/agenti').send({ descrizione: 'PC' }),
      () => http().post(`/pese/agenti/${ID}/codice`),
      () => http().post(`/pese/agenti/${ID}/revoca`).send({ motivo: 'x' }),
      () => http().put(`/pese/strumenti/${ID}/agente`).send({ agenteId: null }),
    ]
    for (const c of chiamate) {
      const r = await c().expect(403)
      expect(r.body.error).toBe('PESE_RISERVATE_AMMINISTRATORI')
    }
    expect(agenti.crea).not.toHaveBeenCalled()
    expect(agenti.revoca).not.toHaveBeenCalled()
  })

  it('un ADMIN crea un agente (201 col codice) e lo revoca con motivo', async () => {
    const r = await http().post('/pese/agenti').send({ descrizione: 'PC pesa' }).expect(201)
    expect(r.body.codice).toBe('ABCD-EFGH-JK23')
    expect(agenti.crea).toHaveBeenCalledWith(TENANT, UTENTE, { descrizione: 'PC pesa' })
    await http().post(`/pese/agenti/${ID}/revoca`).send({ motivo: 'PC sostituito' }).expect(200)
    expect(agenti.revoca).toHaveBeenCalledWith(TENANT, UTENTE, ID, 'PC sostituito')
    await http().post(`/pese/agenti/${ID}/revoca`).send({}).expect(400)
  })

  it('nuovo codice su un agente non più in attesa: 409', async () => {
    agenti.nuovoCodice.mockRejectedValue(new StatoAccessoNonValidoError('Solo in attesa.'))
    await http().post(`/pese/agenti/${ID}/codice`).expect(409)
  })

  it('PUT /pese/strumenti/:id/agente: agenteId UUID o null; altro → 400', async () => {
    await http().put(`/pese/strumenti/${ID}/agente`).send({ agenteId: ID }).expect(200)
    expect(agenti.assegnaStrumento).toHaveBeenCalledWith(TENANT, UTENTE, ID, ID)
    await http().put(`/pese/strumenti/${ID}/agente`).send({ agenteId: null }).expect(200)
    await http().put(`/pese/strumenti/${ID}/agente`).send({ agenteId: 'xx' }).expect(400)
    await http().put(`/pese/strumenti/${ID}/agente`).send({}).expect(400)
  })

  it('GET /pese/letture: operatori; i filtri passano; VIEWER → 403; filtri non validi → 400', async () => {
    await http()
      .get(`/pese/letture?registroId=${ID}&libere=false&dal=2026-11-13T08:00:00Z`)
      .expect(200)
    const filtri = letture.elenca.mock.calls[0][1]
    expect(filtri).toMatchObject({ registroId: ID, libere: false })
    expect(filtri.dal).toEqual(new Date('2026-11-13T08:00:00Z'))
    await http().get('/pese/letture?libere=boh').expect(400)
    await http().get('/pese/letture?registroId=xx').expect(400)
    ruolo = 'VIEWER'
    await http().get('/pese/letture').expect(403)
  })
})
