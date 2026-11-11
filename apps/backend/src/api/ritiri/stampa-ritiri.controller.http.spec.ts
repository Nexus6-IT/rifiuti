/**
 * Rotte di stampa dei ritiri attraverso la catena HTTP reale (ValidationPipe, filtro globale,
 * interceptor dei moduli). I controller sono montati NELL'ORDINE del modulo: `distinta.pdf` non deve
 * finire in `GET /ritiri/:id`. Il servizio e' finto: ha il suo test su Postgres.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { StampaRitiriController } from './stampa-ritiri.controller'
import { RitiriController } from './ritiri.controller'
import { GENERA_FIR_DA_RITIRI } from './genera-fir.porta'
import { RitiriService } from '../../application/ritiri/ritiri.service'
import { StampaRitiriService } from '../../application/ritiri/stampa-ritiri.service'
import {
  AutomezzoNonTrovatoError,
  ModelloAmbitoNonValidoError,
  NessunFirDaStampareError,
} from '../../application/ritiri/errori-ritiri'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { ModuloAttivoInterceptor } from '../../core/interceptors/modulo-attivo.interceptor'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const TENANT = '5a5a5a5a-0000-4000-8000-00000000000a'
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('StampaRitiriController - catena HTTP', () => {
  let app: INestApplication
  let moduliAttivi: string[]
  let stampa: { distinta: jest.Mock; stampaFir: jest.Mock }
  let dettaglio: jest.Mock
  const pdf = Buffer.from('%PDF-1.4 finto')

  beforeEach(async () => {
    moduliAttivi = ['ritiri']
    stampa = {
      distinta: jest.fn().mockResolvedValue({ buffer: pdf, nomeFile: 'distinta-ritiri-x.pdf' }),
      stampaFir: jest
        .fn()
        .mockResolvedValue({ buffer: pdf, nomeFile: 'FIR-ritiri.pdf', saltati: 2 }),
    }
    dettaglio = jest.fn().mockResolvedValue({ id: 'dal-dettaglio' })
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [StampaRitiriController, RitiriController],
      providers: [
        { provide: StampaRitiriService, useValue: stampa },
        { provide: RitiriService, useValue: { dettaglio } },
        { provide: GENERA_FIR_DA_RITIRI, useValue: { genera: jest.fn() } },
        { provide: RuoloEffettivoService, useValue: { ruoloEffettivo: async () => 'VIEWER' } },
        { provide: ModuliAttiviService, useValue: { moduliAttivi: async () => moduliAttivi } },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
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
          req.user = { id: U(1), tenantId: TENANT, role: 'VIEWER' }
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

  it('senza il modulo ritiri entrambe le rotte rispondono 403 e il servizio non gira', async () => {
    moduliAttivi = ['fir']
    await http().get('/ritiri/distinta.pdf?data=2026-12-01').expect(403)
    await http()
      .post('/ritiri/stampa-fir')
      .send({ ritiroIds: [U(2)] })
      .expect(403)
    expect(stampa.distinta).not.toHaveBeenCalled()
    expect(stampa.stampaFir).not.toHaveBeenCalled()
  })

  describe('GET /ritiri/distinta.pdf', () => {
    it('risponde un PDF con il nome file, senza passare da GET /ritiri/:id; la lettura e` di tutti i ruoli', async () => {
      const r = await http()
        .get(`/ritiri/distinta.pdf?data=2026-12-01&automezzoId=${U(3)}&modelloId=${U(4)}`)
        .expect(200)
      expect(r.headers['content-type']).toContain('application/pdf')
      expect(r.headers['content-disposition']).toBe('attachment; filename="distinta-ritiri-x.pdf"')
      expect(stampa.distinta).toHaveBeenCalledWith(TENANT, '2026-12-01', U(3), U(4))
      expect(dettaglio).not.toHaveBeenCalled()
    })

    it('data mancante o non valida, id non UUID: 400 e il servizio non gira', async () => {
      await http().get('/ritiri/distinta.pdf').expect(400)
      await http().get('/ritiri/distinta.pdf?data=1-12-2026').expect(400)
      await http().get('/ritiri/distinta.pdf?data=2026-12-01&automezzoId=x').expect(400)
      expect(stampa.distinta).not.toHaveBeenCalled()
    })

    it('automezzo altrui: 404; modello di ambito sbagliato: 400 con codice', async () => {
      stampa.distinta.mockRejectedValueOnce(new AutomezzoNonTrovatoError())
      await http().get('/ritiri/distinta.pdf?data=2026-12-01').expect(404)
      stampa.distinta.mockRejectedValueOnce(new ModelloAmbitoNonValidoError('Ambito sbagliato.'))
      const r = await http().get('/ritiri/distinta.pdf?data=2026-12-01').expect(400)
      expect(JSON.stringify(r.body)).toContain('MODELLO_STAMPA_AMBITO_NON_VALIDO')
    })
  })

  describe('POST /ritiri/stampa-fir', () => {
    it('risponde un PDF e il numero dei ritiri saltati nell`header', async () => {
      const r = await http()
        .post('/ritiri/stampa-fir')
        .send({ ritiroIds: [U(2), U(3)], modelloId: U(4) })
        .expect(200)
      expect(r.headers['content-type']).toContain('application/pdf')
      expect(r.headers['x-ritiri-saltati']).toBe('2')
      expect(stampa.stampaFir).toHaveBeenCalledWith(TENANT, [U(2), U(3)], U(4))
    })

    it('elenco vuoto, doppioni, piu` di 100, id non UUID: 400', async () => {
      await http().post('/ritiri/stampa-fir').send({ ritiroIds: [] }).expect(400)
      await http()
        .post('/ritiri/stampa-fir')
        .send({ ritiroIds: [U(2), U(2)] })
        .expect(400)
      await http()
        .post('/ritiri/stampa-fir')
        .send({ ritiroIds: ['x'] })
        .expect(400)
      await http()
        .post('/ritiri/stampa-fir')
        .send({ ritiroIds: Array.from({ length: 101 }, (_, i) => U(i + 1)) })
        .expect(400)
      expect(stampa.stampaFir).not.toHaveBeenCalled()
    })

    it('nessun FIR da stampare: 400 con codice NESSUN_FIR_DA_STAMPARE', async () => {
      stampa.stampaFir.mockRejectedValueOnce(new NessunFirDaStampareError())
      const r = await http()
        .post('/ritiri/stampa-fir')
        .send({ ritiroIds: [U(2)] })
        .expect(400)
      expect(JSON.stringify(r.body)).toContain('NESSUN_FIR_DA_STAMPARE')
    })
  })
})
