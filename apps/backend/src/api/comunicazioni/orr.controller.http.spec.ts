/**
 * Controller `/comunicazioni/orr` attraverso la catena HTTP reale (ValidationPipe, filtro globale,
 * modulo commerciale). Ruolo effettivo e servizio sono finti: il servizio ha le sue spec.
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { ModuloAttivoInterceptor } from '../../core/interceptors/modulo-attivo.interceptor'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { COMUNICAZIONI_ORR_SERVICE } from '../../application/comunicazioni/comunicazioni-orr.port'
import {
  ComunicazioneConBloccantiError,
  ComunicazioneNonTrovataError,
} from '../../application/comunicazioni/comunicazioni-orso.port'
import { RichiestaComunicazioneNonValidaError } from '../../application/comunicazioni/comunicazioni-tracciato.port'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { OrrController } from './orr.controller'

const TENANT_TOKEN = '5a5a5a5a-0000-4000-8000-00000000000a'
const TENANT_SELEZIONATO = '5a5a5a5a-0000-4000-8000-00000000000b'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const SEDE = '4c4c4c4c-0000-4000-8000-000000000007'

const query = { unitaLocaleId: SEDE, da: '2026-05-01', a: '2026-05-31' }

describe('OrrController - catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let orr: Record<string, jest.Mock>
  let moduliAttivi: jest.Mock

  beforeEach(async () => {
    ruolo = 'ADMIN'
    orr = {
      anteprima: jest
        .fn()
        .mockResolvedValue({ file: [], avvisiGenerali: [], bloccanti: false, nessunDato: true }),
      genera: jest.fn().mockResolvedValue([{ id: 'x', attivita: 'STO' }]),
      elenca: jest.fn().mockResolvedValue([]),
    }
    moduliAttivi = jest.fn().mockResolvedValue(['comunicazioni'])
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [OrrController],
      providers: [
        { provide: COMUNICAZIONI_ORR_SERVICE, useValue: orr },
        {
          provide: RuoloEffettivoService,
          useValue: { ruoloEffettivo: jest.fn(async () => ruolo) },
        },
        { provide: ModuliAttiviService, useValue: { moduliAttivi } },
        { provide: APP_INTERCEPTOR, useClass: ModuloAttivoInterceptor },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest()
          req.user = { id: UTENTE, tenantId: TENANT_TOKEN, role: 'ADMIN' }
          const selezionato = req.headers['x-tenant-id']
          if (typeof selezionato === 'string') req.tenantId = selezionato
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

  it('anteprima: lettura per ogni ruolo, con l’azienda selezionata; dice se si puo generare', async () => {
    ruolo = 'VIEWER'
    const r = await request(app.getHttpServer())
      .get('/comunicazioni/orr/anteprima')
      .query({ ...query, attivita: 'STO' })
      .set('X-Tenant-ID', TENANT_SELEZIONATO)
      .expect(200)
    expect(orr.anteprima).toHaveBeenCalledWith(TENANT_SELEZIONATO, { ...query, attivita: 'STO' })
    expect(r.body).toMatchObject({ nessunDato: true, puoGenerare: false })
    ruolo = 'OPERATOR'
    const r2 = await request(app.getHttpServer())
      .get('/comunicazioni/orr/anteprima')
      .query(query)
      .expect(200)
    expect(r2.body.puoGenerare).toBe(true)
  })

  it('parametri non validi -> 400 senza chiamare il servizio', async () => {
    await request(app.getHttpServer())
      .get('/comunicazioni/orr/anteprima')
      .query({ ...query, unitaLocaleId: 'x' })
      .expect(400)
    await request(app.getHttpServer())
      .get('/comunicazioni/orr/anteprima')
      .query({ ...query, da: '1/5/2026' })
      .expect(400)
    await request(app.getHttpServer())
      .get('/comunicazioni/orr/anteprima')
      .query({ ...query, attivita: 'XXX' })
      .expect(400)
    await request(app.getHttpServer())
      .post('/comunicazioni/orr')
      .send({ ...query, extra: 1 })
      .expect(400)
    expect(orr.anteprima).not.toHaveBeenCalled()
    expect(orr.genera).not.toHaveBeenCalled()
  })

  it('genera: ADMIN e OPERATOR ok, 201 con l’elenco dei file; il VIEWER ottiene 403', async () => {
    for (const r of ['ADMIN', 'OPERATOR']) {
      ruolo = r
      const res = await request(app.getHttpServer())
        .post('/comunicazioni/orr')
        .send(query)
        .expect(201)
      expect(res.body).toEqual({ file: [{ id: 'x', attivita: 'STO' }] })
    }
    expect(orr.genera).toHaveBeenCalledWith(TENANT_TOKEN, UTENTE, query)
    orr.genera.mockClear()
    ruolo = 'VIEWER'
    await request(app.getHttpServer()).post('/comunicazioni/orr').send(query).expect(403)
    expect(orr.genera).not.toHaveBeenCalled()
  })

  it('bloccanti -> 400 COMUNICAZIONE_CON_BLOCCANTI con gli avvisi', async () => {
    orr.genera.mockRejectedValue(
      new ComunicazioneConBloccantiError([
        { codice: 'ATECO_PRODUTTORE', messaggio: 'm', movimentoIds: ['1'] },
      ])
    )
    const r = await request(app.getHttpServer()).post('/comunicazioni/orr').send(query).expect(400)
    expect(r.body.error ?? r.body.code ?? JSON.stringify(r.body)).toContain(
      'COMUNICAZIONE_CON_BLOCCANTI'
    )
    expect(JSON.stringify(r.body)).toContain('ATECO_PRODUTTORE')
  })

  it('periodo o attivita non validi dal servizio -> 400; sede di un’altra azienda -> 404', async () => {
    orr.anteprima.mockRejectedValueOnce(
      new RichiestaComunicazioneNonValidaError(['il periodo deve stare in un solo anno'])
    )
    const r = await request(app.getHttpServer())
      .get('/comunicazioni/orr/anteprima')
      .query(query)
      .expect(400)
    expect(JSON.stringify(r.body)).toContain('RICHIESTA_COMUNICAZIONE_NON_VALIDA')
    orr.anteprima.mockRejectedValueOnce(new ComunicazioneNonTrovataError())
    await request(app.getHttpServer()).get('/comunicazioni/orr/anteprima').query(query).expect(404)
  })

  it('storico: lettura per ogni ruolo', async () => {
    ruolo = 'VIEWER'
    await request(app.getHttpServer())
      .get('/comunicazioni/orr')
      .query({ unitaLocaleId: SEDE })
      .expect(200)
    expect(orr.elenca).toHaveBeenCalledWith(TENANT_TOKEN, { unitaLocaleId: SEDE })
  })

  it('modulo comunicazioni non attivo -> 403', async () => {
    moduliAttivi.mockResolvedValue([])
    await request(app.getHttpServer()).get('/comunicazioni/orr/anteprima').query(query).expect(403)
    expect(orr.anteprima).not.toHaveBeenCalled()
  })
})
