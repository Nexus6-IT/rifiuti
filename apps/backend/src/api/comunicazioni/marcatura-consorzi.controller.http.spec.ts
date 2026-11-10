/**
 * Controller `/comunicazioni/consorzi` attraverso la catena HTTP reale (ValidationPipe, filtro
 * globale, interceptor del modulo). Ruolo effettivo e servizi sono finti: i servizi hanno i loro
 * test contro Postgres.
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { ModuloAttivoInterceptor } from '../../core/interceptors/modulo-attivo.interceptor'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import {
  ESTRATTO_CONSORZI_SERVICE,
  MARCATURA_CONSORZI_SERVICE,
  MarcaturaNonValidaError,
  MovimentoNonTrovatoError,
  RegolaConsorzioNonTrovataError,
} from '../../application/comunicazioni/marcatura-consorzi.port'
import { MarcaturaConsorziController } from './marcatura-consorzi.controller'

const TENANT_TOKEN = '5a5a5a5a-0000-4000-8000-00000000000a'
const TENANT_SELEZIONATO = '5a5a5a5a-0000-4000-8000-00000000000b'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const ID = '4c4c4c4c-0000-4000-8000-000000000007'
const ID2 = '4c4c4c4c-0000-4000-8000-000000000008'
const SEDE = '3b3b3b3b-0000-4000-8000-000000000006'

describe('MarcaturaConsorziController - catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let moduli: string[]
  let marcatura: Record<string, jest.Mock>
  let estratto: Record<string, jest.Mock>

  beforeEach(async () => {
    ruolo = 'ADMIN'
    moduli = ['comunicazioni']
    marcatura = {
      elencaRegole: jest.fn().mockResolvedValue([{ id: null, consorzio: 'CONOU', sistema: true }]),
      creaRegola: jest.fn().mockResolvedValue({ id: ID }),
      modificaRegola: jest.fn().mockResolvedValue({ id: ID }),
      eliminaRegola: jest.fn().mockResolvedValue(undefined),
      impostaOverride: jest.fn().mockResolvedValue({ marcature: [], esclusi: [] }),
      rimuoviOverride: jest.fn().mockResolvedValue({ marcature: [], esclusi: [] }),
      consorziDeiMovimenti: jest.fn().mockResolvedValue({}),
    }
    estratto = {
      estratto: jest
        .fn()
        .mockResolvedValue({ nomeFile: 'estratto.csv', csv: '﻿"a"\r\n', righe: 0 }),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [MarcaturaConsorziController],
      providers: [
        { provide: MARCATURA_CONSORZI_SERVICE, useValue: marcatura },
        { provide: ESTRATTO_CONSORZI_SERVICE, useValue: estratto },
        {
          provide: RuoloEffettivoService,
          useValue: { ruoloEffettivo: jest.fn(async () => ruolo) },
        },
        { provide: ModuliAttiviService, useValue: { moduliAttivi: jest.fn(async () => moduli) } },
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

  const http = () => request(app.getHttpServer())

  it('senza il modulo comunicazioni ogni rotta risponde 403', async () => {
    moduli = []
    await http().get('/comunicazioni/consorzi/regole').expect(403)
    await http()
      .post('/comunicazioni/consorzi/regole')
      .send({ consorzio: 'CONOU', cer: '13' })
      .expect(403)
    expect(marcatura.elencaRegole).not.toHaveBeenCalled()
  })

  it('regole: lettura per ogni ruolo, con puoModificare dal ruolo effettivo; azienda selezionata', async () => {
    ruolo = 'VIEWER'
    const r = await http()
      .get('/comunicazioni/consorzi/regole')
      .set('X-Tenant-ID', TENANT_SELEZIONATO)
      .expect(200)
    expect(r.body.puoModificare).toBe(false)
    expect(marcatura.elencaRegole).toHaveBeenCalledWith(TENANT_SELEZIONATO)
    ruolo = 'ADMIN'
    expect(
      (await http().get('/comunicazioni/consorzi/regole').expect(200)).body.puoModificare
    ).toBe(true)
    ruolo = 'OPERATOR'
    expect(
      (await http().get('/comunicazioni/consorzi/regole').expect(200)).body.puoModificare
    ).toBe(false)
  })

  it('scrittura riservata a ADMIN e SUPER_ADMIN: OPERATOR e VIEWER 403, servizio non chiamato', async () => {
    for (const r of ['OPERATOR', 'VIEWER']) {
      ruolo = r
      await http()
        .post('/comunicazioni/consorzi/regole')
        .send({ consorzio: 'CONOU', cer: '13' })
        .expect(403)
      await http()
        .put(`/comunicazioni/consorzi/regole/${ID}`)
        .send({ consorzio: 'CONOU', cer: '13' })
        .expect(403)
      await http().delete(`/comunicazioni/consorzi/regole/${ID}`).expect(403)
      await http()
        .put(`/comunicazioni/consorzi/movimenti/${ID}/CONOU`)
        .send({ escluso: true })
        .expect(403)
      await http().delete(`/comunicazioni/consorzi/movimenti/${ID}/CONOU`).expect(403)
    }
    expect(marcatura.creaRegola).not.toHaveBeenCalled()
    expect(marcatura.impostaOverride).not.toHaveBeenCalled()
  })

  it('crea, modifica ed elimina una regola come ADMIN e SUPER_ADMIN', async () => {
    for (const r of ['ADMIN', 'SUPER_ADMIN']) {
      ruolo = r
      await http()
        .post('/comunicazioni/consorzi/regole')
        .set('X-Tenant-ID', TENANT_SELEZIONATO)
        .send({
          consorzio: 'CONOU',
          cer: '13 02',
          verso: 'CARICO',
          attiva: true,
          validaDal: '2026-01-01',
        })
        .expect(201)
      expect(marcatura.creaRegola).toHaveBeenLastCalledWith(
        TENANT_SELEZIONATO,
        UTENTE,
        expect.objectContaining({ consorzio: 'CONOU', cer: '13 02', verso: 'CARICO' })
      )
      await http()
        .put(`/comunicazioni/consorzi/regole/${ID}`)
        .send({ consorzio: 'COBAT', cer: '160601' })
        .expect(200)
      await http().delete(`/comunicazioni/consorzi/regole/${ID}`).expect(204)
    }
  })

  it('regola: corpo non valido -> 400 senza chiamare il servizio', async () => {
    await http()
      .post('/comunicazioni/consorzi/regole')
      .send({ consorzio: 'ORSO', cer: '13' })
      .expect(400)
    await http().post('/comunicazioni/consorzi/regole').send({ consorzio: 'CONOU' }).expect(400)
    await http()
      .post('/comunicazioni/consorzi/regole')
      .send({ consorzio: 'CONOU', cer: '13', verso: 'X' })
      .expect(400)
    await http()
      .post('/comunicazioni/consorzi/regole')
      .send({ consorzio: 'CONOU', cer: '13', validaDal: 'ieri' })
      .expect(400)
    await http()
      .post('/comunicazioni/consorzi/regole')
      .send({ consorzio: 'CONOU', cer: '13', tenantId: ID })
      .expect(400)
    await http()
      .put('/comunicazioni/consorzi/regole/non-uuid')
      .send({ consorzio: 'CONOU', cer: '13' })
      .expect(400)
    expect(marcatura.creaRegola).not.toHaveBeenCalled()
    expect(marcatura.modificaRegola).not.toHaveBeenCalled()
  })

  it('errori del servizio: non valido 400, regola e movimento non trovati 404', async () => {
    marcatura.creaRegola.mockRejectedValueOnce(new MarcaturaNonValidaError('CER non valido.'))
    const r = await http()
      .post('/comunicazioni/consorzi/regole')
      .send({ consorzio: 'CONOU', cer: '13' })
      .expect(400)
    expect(r.body.error ?? r.body.code).toBeDefined()
    marcatura.eliminaRegola.mockRejectedValueOnce(new RegolaConsorzioNonTrovataError())
    await http().delete(`/comunicazioni/consorzi/regole/${ID}`).expect(404)
    marcatura.impostaOverride.mockRejectedValueOnce(new MovimentoNonTrovatoError())
    await http()
      .put(`/comunicazioni/consorzi/movimenti/${ID}/CONOU`)
      .send({ escluso: false })
      .expect(404)
  })

  it('movimenti: elenco di id separati da virgola, validati e limitati', async () => {
    await http().get(`/comunicazioni/consorzi/movimenti?ids=${ID},${ID2}`).expect(200)
    expect(marcatura.consorziDeiMovimenti).toHaveBeenCalledWith(TENANT_TOKEN, [ID, ID2])
    await http().get('/comunicazioni/consorzi/movimenti?ids=abc').expect(400)
    await http().get('/comunicazioni/consorzi/movimenti').expect(400)
    const troppi = Array.from({ length: 201 }, () => ID).join(',')
    await http().get(`/comunicazioni/consorzi/movimenti?ids=${troppi}`).expect(400)
  })

  it('override: consorzio solo fra quelli ammessi, escluso booleano', async () => {
    await http()
      .put(`/comunicazioni/consorzi/movimenti/${ID}/COBAT`)
      .send({ escluso: true })
      .expect(200)
    expect(marcatura.impostaOverride).toHaveBeenCalledWith(TENANT_TOKEN, UTENTE, ID, 'COBAT', true)
    await http()
      .put(`/comunicazioni/consorzi/movimenti/${ID}/ORSO`)
      .send({ escluso: true })
      .expect(400)
    await http()
      .put(`/comunicazioni/consorzi/movimenti/${ID}/COBAT`)
      .send({ escluso: 'si' })
      .expect(400)
    await http().delete(`/comunicazioni/consorzi/movimenti/${ID}/COBAT`).expect(200)
    expect(marcatura.rimuoviOverride).toHaveBeenCalledWith(TENANT_TOKEN, ID, 'COBAT')
  })

  it('estratto: CSV con intestazioni di download, lettura per ogni ruolo, parametri validati', async () => {
    ruolo = 'VIEWER'
    const r = await http()
      .get(
        `/comunicazioni/consorzi/estratto?consorzio=CONOU&da=2026-01-01&a=2026-03-31&unitaLocaleId=${SEDE}`
      )
      .expect(200)
    expect(r.headers['content-type']).toMatch(/text\/csv/)
    expect(r.headers['content-disposition']).toContain('estratto.csv')
    expect(estratto.estratto).toHaveBeenCalledWith(TENANT_TOKEN, {
      consorzio: 'CONOU',
      da: '2026-01-01',
      a: '2026-03-31',
      unitaLocaleId: SEDE,
    })
    await http()
      .get('/comunicazioni/consorzi/estratto?consorzio=ORSO&da=2026-01-01&a=2026-03-31')
      .expect(400)
    await http()
      .get('/comunicazioni/consorzi/estratto?consorzio=CONOU&da=1/1/2026&a=2026-03-31')
      .expect(400)
    await http().get('/comunicazioni/consorzi/estratto?consorzio=CONOU&da=2026-01-01').expect(400)
  })
})
