/**
 * Controller `/comunicazioni` attraverso la catena HTTP reale (ValidationPipe, filtro globale).
 * Ruolo effettivo e servizio O.R.SO. sono finti: il servizio ha i suoi test (49-t4).
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import { ModuloAttivoInterceptor } from '../../core/interceptors/modulo-attivo.interceptor'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import request from 'supertest'
import { ComunicazioniController } from './comunicazioni.controller'
import {
  COMUNICAZIONI_ORSO_SERVICE,
  ComunicazioneConBloccantiError,
  ComunicazioneNonTrovataError,
} from '../../application/comunicazioni/comunicazioni-orso.port'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const TENANT_TOKEN = '5a5a5a5a-0000-4000-8000-00000000000a'
const TENANT_SELEZIONATO = '5a5a5a5a-0000-4000-8000-00000000000b'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const SEDE = '3b3b3b3b-0000-4000-8000-000000000006'
const ID = '4c4c4c4c-0000-4000-8000-000000000007'

describe('ComunicazioniController - catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let orso: Record<string, jest.Mock>
  let ruoloEffettivo: jest.Mock
  let moduliAttivi: jest.Mock

  beforeEach(async () => {
    ruolo = 'ADMIN'
    orso = {
      anteprima: jest.fn().mockResolvedValue({ anno: 2026, mesi: [], bloccanti: false }),
      genera: jest.fn().mockResolvedValue({ id: ID, stato: 'GENERATA' }),
      elenca: jest.fn().mockResolvedValue([]),
      file: jest.fn().mockResolvedValue({ nomeFile: 'Orso 2026.xml', xml: '<ImpiantoMesi/>' }),
      segnaInviata: jest.fn().mockResolvedValue({ id: ID, stato: 'INVIATA' }),
    }
    ruoloEffettivo = jest.fn(async () => ruolo)
    moduliAttivi = jest.fn().mockResolvedValue(['comunicazioni'])
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [ComunicazioniController],
      providers: [
        { provide: COMUNICAZIONI_ORSO_SERVICE, useValue: orso },
        { provide: RuoloEffettivoService, useValue: { ruoloEffettivo } },
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

  it("anteprima: usa l'azienda selezionata, anno numerico, lettura per ogni ruolo", async () => {
    ruolo = 'VIEWER'
    await request(app.getHttpServer())
      .get(`/comunicazioni/orso/anteprima?unitaLocaleId=${SEDE}&anno=2026`)
      .set('X-Tenant-ID', TENANT_SELEZIONATO)
      .expect(200)
    expect(orso.anteprima).toHaveBeenCalledWith(TENANT_SELEZIONATO, SEDE, 2026)
  })

  it('anteprima: dice se il ruolo effettivo nell azienda puo generare (puoGenerare)', async () => {
    const chiama = async () =>
      (
        await request(app.getHttpServer())
          .get(`/comunicazioni/orso/anteprima?unitaLocaleId=${SEDE}&anno=2026`)
          .set('X-Tenant-ID', TENANT_SELEZIONATO)
          .expect(200)
      ).body
    ruolo = 'OPERATOR'
    expect((await chiama()).puoGenerare).toBe(true)
    ruolo = 'VIEWER'
    expect((await chiama()).puoGenerare).toBe(false)
  })

  it('anteprima: sede o anno non validi -> 400, servizio non chiamato', async () => {
    await request(app.getHttpServer())
      .get('/comunicazioni/orso/anteprima?unitaLocaleId=x&anno=2026')
      .expect(400)
    await request(app.getHttpServer())
      .get(`/comunicazioni/orso/anteprima?unitaLocaleId=${SEDE}&anno=abc`)
      .expect(400)
    expect(orso.anteprima).not.toHaveBeenCalled()
  })

  it('genera: ADMIN e OPERATOR ok (201), passa utente e corpo', async () => {
    for (const r of ['ADMIN', 'OPERATOR']) {
      ruolo = r
      await request(app.getHttpServer())
        .post('/comunicazioni/orso')
        .send({ unitaLocaleId: SEDE, anno: 2026 })
        .expect(201)
    }
    expect(orso.genera).toHaveBeenCalledWith(TENANT_TOKEN, UTENTE, SEDE, 2026)
  })

  it('genera e inviata: VIEWER -> 403 COMUNICAZIONI_RISERVATE_OPERATORI, servizio non chiamato', async () => {
    ruolo = 'VIEWER'
    const a = await request(app.getHttpServer())
      .post('/comunicazioni/orso')
      .send({ unitaLocaleId: SEDE, anno: 2026 })
      .expect(403)
    await request(app.getHttpServer()).post(`/comunicazioni/${ID}/inviata`).expect(403)
    expect(a.body.error).toBe('COMUNICAZIONI_RISERVATE_OPERATORI')
    expect(orso.genera).not.toHaveBeenCalled()
    expect(orso.segnaInviata).not.toHaveBeenCalled()
  })

  it('genera: corpo non valido -> 400', async () => {
    await request(app.getHttpServer())
      .post('/comunicazioni/orso')
      .send({ unitaLocaleId: SEDE, anno: 'x' })
      .expect(400)
    await request(app.getHttpServer())
      .post('/comunicazioni/orso')
      .send({ unitaLocaleId: SEDE, anno: 2026, extra: 1 })
      .expect(400)
    expect(orso.genera).not.toHaveBeenCalled()
  })

  it('genera con bloccanti: 400 COMUNICAZIONE_CON_BLOCCANTI', async () => {
    orso.genera.mockRejectedValue(
      new ComunicazioneConBloccantiError([{ codice: 'X', messaggio: 'm', movimentoIds: [] }])
    )
    const r = await request(app.getHttpServer())
      .post('/comunicazioni/orso')
      .send({ unitaLocaleId: SEDE, anno: 2026 })
      .expect(400)
    expect(JSON.stringify(r.body)).toContain('COMUNICAZIONE_CON_BLOCCANTI')
  })

  it('elenca: filtri validati e passati; consorzio sconosciuto -> 400', async () => {
    await request(app.getHttpServer())
      .get(`/comunicazioni?consorzio=ORSO&unitaLocaleId=${SEDE}&anno=2026`)
      .expect(200)
    expect(orso.elenca).toHaveBeenCalledWith(
      TENANT_TOKEN,
      expect.objectContaining({ consorzio: 'ORSO', unitaLocaleId: SEDE, anno: 2026 })
    )
    await request(app.getHttpServer()).get('/comunicazioni?consorzio=ALTRO').expect(400)
  })

  it('file: XML con Content-Disposition attachment e nome codificato', async () => {
    const r = await request(app.getHttpServer()).get(`/comunicazioni/${ID}/file`).expect(200)
    expect(r.headers['content-type']).toContain('application/xml')
    expect(r.headers['content-disposition']).toMatch(/^attachment; filename="Orso 2026\.xml"/)
    expect(r.text).toBe('<ImpiantoMesi/>')
    ruolo = 'VIEWER'
    await request(app.getHttpServer()).get(`/comunicazioni/${ID}/file`).expect(200)
  })

  it('file e inviata: id non UUID -> 400; comunicazione inesistente -> 404', async () => {
    await request(app.getHttpServer()).get('/comunicazioni/xx/file').expect(400)
    orso.segnaInviata.mockRejectedValue(new ComunicazioneNonTrovataError())
    const r = await request(app.getHttpServer()).post(`/comunicazioni/${ID}/inviata`).expect(404)
    expect(JSON.stringify(r.body)).toContain('COMUNICAZIONE_NON_TROVATA')
  })

  it('inviata: passa tenant, utente e id', async () => {
    await request(app.getHttpServer()).post(`/comunicazioni/${ID}/inviata`).expect(201)
    expect(orso.segnaInviata).toHaveBeenCalledWith(TENANT_TOKEN, UTENTE, ID)
  })

  it('senza il modulo comunicazioni: 403 MODULO_NON_ATTIVO su ogni rotta, servizio non chiamato', async () => {
    moduliAttivi.mockResolvedValue(['registro'])
    const server = app.getHttpServer()
    const risposte = [
      await request(server).get(`/comunicazioni/orso/anteprima?unitaLocaleId=${SEDE}&anno=2026`),
      await request(server).post('/comunicazioni/orso').send({ unitaLocaleId: SEDE, anno: 2026 }),
      await request(server).get('/comunicazioni'),
      await request(server).get(`/comunicazioni/${ID}/file`),
      await request(server).post(`/comunicazioni/${ID}/inviata`),
    ]
    expect(risposte.map(r => r.status)).toEqual([403, 403, 403, 403, 403])
    expect(JSON.stringify(risposte[0].body)).toContain('MODULO_NON_ATTIVO')
    for (const m of Object.values(orso)) expect(m).not.toHaveBeenCalled()
  })
})
