/**
 * Rotte dell'app campo attraverso la catena HTTP reale (ValidationPipe, filtro globale,
 * RuoloAutistaInterceptor, interceptor dei moduli, controller). I servizi sono finti: hanno i loro
 * test. Prova anche che un AUTISTA riceve 403 sulle rotte d'ufficio (`/ritiri`, `/autisti`) senza
 * che il servizio giri.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { AutistiService } from '../../application/campo/autisti.service'
import {
  AutistaDatiNonValidiError,
  AutistaDuplicatoError,
  AutistaNonCollegatoError,
} from '../../application/campo/errori-campo'
import { GiroService } from '../../application/campo/giro.service'
import { RitiriService } from '../../application/ritiri/ritiri.service'
import { GENERA_FIR_DA_RITIRI } from '../ritiri/genera-fir.porta'
import { RitiriController } from '../ritiri/ritiri.controller'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { ModuloAttivoInterceptor } from '../../core/interceptors/modulo-attivo.interceptor'
import { RuoloAutistaInterceptor } from '../../core/interceptors/ruolo-autista.interceptor'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { AutistiController } from './autisti.controller'
import { CampoController } from './campo.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-00000000000a'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const ID = '3b3b3b3b-0000-4000-8000-000000000006'

describe('Campo - catena HTTP', () => {
  let app: INestApplication
  let utente: { id: string; tenantId: string; role: string }
  let ruoloEffettivo: string
  let moduliAttivi: string[]
  let giro: { giro: jest.Mock }
  let autisti: Record<string, jest.Mock>
  let ritiri: Record<string, jest.Mock>

  beforeEach(async () => {
    utente = { id: UTENTE, tenantId: TENANT, role: 'AUTISTA' }
    ruoloEffettivo = 'OPERATOR'
    moduliAttivi = ['campo', 'ritiri']
    giro = { giro: jest.fn().mockResolvedValue({ data: '2026-11-19', ritiri: [] }) }
    autisti = {
      elenca: jest.fn().mockResolvedValue([]),
      crea: jest.fn().mockResolvedValue({ id: ID }),
      aggiorna: jest.fn().mockResolvedValue({ id: ID }),
    }
    ritiri = { elenca: jest.fn().mockResolvedValue({ righe: [], totale: 0 }) }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [CampoController, AutistiController, RitiriController],
      providers: [
        { provide: GiroService, useValue: giro },
        { provide: AutistiService, useValue: autisti },
        { provide: RitiriService, useValue: ritiri },
        { provide: GENERA_FIR_DA_RITIRI, useValue: { genera: jest.fn() } },
        {
          provide: RuoloEffettivoService,
          useValue: { ruoloEffettivo: async () => ruoloEffettivo },
        },
        { provide: ModuliAttiviService, useValue: { moduliAttivi: async () => moduliAttivi } },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
        // Stesso ordine di AppModule: prima il ruolo autista, poi i moduli.
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
          req.user = utente
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

  describe('un AUTISTA', () => {
    it('vede il giro: il servizio riceve azienda, utente del token e data', async () => {
      await http().get('/campo/giro?data=2026-11-19').expect(200)
      expect(giro.giro).toHaveBeenCalledWith(TENANT, UTENTE, '2026-11-19')
    })

    it('non puo scegliere l autista: un id nella richiesta e rifiutato (whitelist)', async () => {
      await http().get(`/campo/giro?data=2026-11-19&autistaId=${ID}`).expect(400)
      expect(giro.giro).not.toHaveBeenCalled()
    })

    it('data non valida: 400', async () => {
      await http().get('/campo/giro?data=19-11-2026').expect(400)
      await http().get('/campo/giro').expect(400)
    })

    it('riceve 403 su /ritiri e /autisti (lettura e scrittura) e i servizi non girano', async () => {
      for (const richiesta of [
        () => http().get('/ritiri'),
        () => http().get(`/ritiri/${ID}`),
        () => http().post('/ritiri').send({}),
        () => http().get('/autisti'),
        () => http().post('/autisti').send({ nome: 'A', cognome: 'B' }),
        () => http().put(`/autisti/${ID}`).send({ nome: 'A', cognome: 'B' }),
      ]) {
        const res = await richiesta()
        expect(res.status).toBe(403)
        expect(JSON.stringify(res.body)).toContain('ROTTA_NON_CONSENTITA_ALL_AUTISTA')
      }
      expect(ritiri.elenca).not.toHaveBeenCalled()
      expect(autisti.elenca).not.toHaveBeenCalled()
      expect(autisti.crea).not.toHaveBeenCalled()
      expect(autisti.aggiorna).not.toHaveBeenCalled()
    })

    it('un utente non collegato a un autista riceve 403 AUTISTA_NON_COLLEGATO', async () => {
      giro.giro.mockRejectedValue(new AutistaNonCollegatoError())
      const r = await http().get('/campo/giro?data=2026-11-19').expect(403)
      expect(JSON.stringify(r.body)).toContain('AUTISTA_NON_COLLEGATO')
    })

    it('senza il modulo campo anche il giro e chiuso (403 MODULO_NON_ATTIVO)', async () => {
      moduliAttivi = ['ritiri']
      const r = await http().get('/campo/giro?data=2026-11-19').expect(403)
      expect(JSON.stringify(r.body)).toContain('MODULO_NON_ATTIVO')
      expect(giro.giro).not.toHaveBeenCalled()
    })
  })

  describe('un utente d ufficio', () => {
    beforeEach(() => {
      utente = { id: UTENTE, tenantId: TENANT, role: 'ADMIN' }
    })

    it('non puo usare il giro (e dell autista): 403', async () => {
      const r = await http().get('/campo/giro?data=2026-11-19').expect(403)
      expect(JSON.stringify(r.body)).toContain('GIRO_RISERVATO_AGLI_AUTISTI')
      expect(giro.giro).not.toHaveBeenCalled()
    })

    it('elenca gli autisti e con attivi=true passa il filtro', async () => {
      autisti.elenca.mockResolvedValue([{ id: ID }])
      const r = await http().get('/autisti?attivi=true').expect(200)
      expect(r.body).toEqual({ righe: [{ id: ID }], puoOperare: true })
      expect(autisti.elenca).toHaveBeenCalledWith(TENANT, { soloAttivi: true })
      await http().get('/autisti?attivi=boh').expect(400)
    })

    it('puoOperare e falso per un VIEWER', async () => {
      ruoloEffettivo = 'VIEWER'
      const r = await http().get('/autisti').expect(200)
      expect(r.body.puoOperare).toBe(false)
    })

    it('crea e aggiorna con il ruolo di scrittura; un VIEWER riceve 403', async () => {
      await http().post('/autisti').send({ nome: 'Luca', cognome: 'Bianchi' }).expect(201)
      expect(autisti.crea).toHaveBeenCalledWith(
        TENANT,
        UTENTE,
        expect.objectContaining({ nome: 'Luca' })
      )
      await http().put(`/autisti/${ID}`).send({ nome: 'Luca', cognome: 'Bianchi' }).expect(200)
      ruoloEffettivo = 'VIEWER'
      await http().post('/autisti').send({ nome: 'Luca', cognome: 'Bianchi' }).expect(403)
      await http().put(`/autisti/${ID}`).send({ nome: 'Luca', cognome: 'Bianchi' }).expect(403)
    })

    it('corpo non valido: 400; campo sconosciuto rifiutato', async () => {
      await http().post('/autisti').send({ cognome: 'Bianchi' }).expect(400)
      await http().post('/autisti').send({ nome: 'A', cognome: 'B', ruolo: 'ADMIN' }).expect(400)
      expect(autisti.crea).not.toHaveBeenCalled()
    })

    it('errori di dominio: 409 AUTISTA_DUPLICATO, 400 con i messaggi', async () => {
      autisti.crea.mockRejectedValueOnce(new AutistaDuplicatoError('Esiste già un autista.'))
      const dup = await http().post('/autisti').send({ nome: 'A', cognome: 'B' }).expect(409)
      expect(JSON.stringify(dup.body)).toContain('AUTISTA_DUPLICATO')
      autisti.crea.mockRejectedValueOnce(new AutistaDatiNonValidiError(['Utente non trovato.']))
      const bad = await http().post('/autisti').send({ nome: 'A', cognome: 'B' }).expect(400)
      expect(JSON.stringify(bad.body)).toContain('Utente non trovato.')
    })

    it('/autisti si legge anche con il solo modulo ritiri, ma non senza ne ritiri ne campo', async () => {
      moduliAttivi = ['ritiri']
      await http().get('/autisti').expect(200)
      moduliAttivi = ['fir']
      const r = await http().get('/autisti').expect(403)
      expect(JSON.stringify(r.body)).toContain('MODULO_NON_ATTIVO')
    })
  })
})
