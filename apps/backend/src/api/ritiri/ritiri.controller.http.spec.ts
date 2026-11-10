/**
 * Rotte dei ritiri attraverso la catena HTTP reale (ValidationPipe, filtro globale, interceptor dei
 * moduli, controller). Servizi e ruolo effettivo sono finti: hanno i loro test.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { RitiriController } from './ritiri.controller'
import { GENERA_FIR_DA_RITIRI } from './genera-fir.porta'
import { RitiriService } from '../../application/ritiri/ritiri.service'
import {
  RitiroConFirError,
  RitiroDatiNonValidiError,
  RitiroModificatoError,
  RitiroNonTrovatoError,
  RitiroStatoNonValidoError,
} from '../../application/ritiri/errori-ritiri'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { ModuloAttivoInterceptor } from '../../core/interceptors/modulo-attivo.interceptor'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const TENANT = '5a5a5a5a-0000-4000-8000-00000000000a'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const ID = '3b3b3b3b-0000-4000-8000-000000000006'
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const dati = {
  dataPrevista: '2026-12-01',
  produttoreId: U(1),
  produttoreSedeId: U(2),
  trasportatoreId: U(3),
  destinatarioId: U(4),
  destinatarioSedeId: U(5),
  cerCode: '20 03 01',
  descrizione: 'Rifiuti urbani',
  quantitaPresunta: '1250.50',
  codiceOperazione: 'R13',
}

describe('RitiriController - catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let moduliAttivi: string[]
  let servizio: Record<string, jest.Mock>
  let genera: { genera: jest.Mock }

  beforeEach(async () => {
    ruolo = 'OPERATOR'
    moduliAttivi = ['ritiri']
    servizio = {
      elenca: jest.fn().mockResolvedValue({ righe: [], totale: 0 }),
      dettaglio: jest.fn().mockResolvedValue({ id: ID }),
      crea: jest.fn().mockResolvedValue({ ritiri: [{ id: ID }], giaRegistrato: false }),
      modifica: jest.fn().mockResolvedValue({ id: ID }),
      annulla: jest.fn().mockResolvedValue({ id: ID }),
      nonEseguito: jest.fn().mockResolvedValue({ id: ID }),
      riprogramma: jest.fn().mockResolvedValue({ id: ID }),
    }
    genera = { genera: jest.fn().mockResolvedValue({ esiti: [] }) }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [RitiriController],
      providers: [
        { provide: RitiriService, useValue: servizio },
        { provide: GENERA_FIR_DA_RITIRI, useValue: genera },
        { provide: RuoloEffettivoService, useValue: { ruoloEffettivo: async () => ruolo } },
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
          req.user = { id: UTENTE, tenantId: TENANT, role: 'OPERATOR' }
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

  describe('modulo', () => {
    it('senza il modulo ritiri ogni rotta risponde 403 MODULO_NON_ATTIVO e il servizio non gira', async () => {
      moduliAttivi = ['fir', 'pese']
      const r = await http().get('/ritiri').expect(403)
      expect(JSON.stringify(r.body)).toContain('MODULO_NON_ATTIVO')
      await http().get(`/ritiri/${ID}`).expect(403)
      await http()
        .post('/ritiri')
        .send({ ...dati, chiaveIdempotenza: U(9) })
        .expect(403)
      await http()
        .post('/ritiri/genera-fir')
        .send({ ritiroIds: [ID] })
        .expect(403)
      expect(servizio.elenca).not.toHaveBeenCalled()
      expect(servizio.crea).not.toHaveBeenCalled()
      expect(genera.genera).not.toHaveBeenCalled()
    })
  })

  describe('lettura', () => {
    it('elenco: i filtri arrivano al servizio, paginazione numerica', async () => {
      await http()
        .get(
          '/ritiri?dal=2026-11-01&al=2026-11-30&statoVisibile=DA_GENERARE&pagina=2&dimensione=50'
        )
        .expect(200)
      expect(servizio.elenca).toHaveBeenCalledWith(
        TENANT,
        expect.objectContaining({
          dal: '2026-11-01',
          al: '2026-11-30',
          statoVisibile: 'DA_GENERARE',
          pagina: 2,
          dimensione: 50,
        })
      )
    })

    it('un lettore (VIEWER) legge elenco e dettaglio', async () => {
      ruolo = 'VIEWER'
      await http().get('/ritiri').expect(200)
      await http().get(`/ritiri/${ID}`).expect(200)
    })

    it('filtro con data o stato non validi: 400', async () => {
      await http().get('/ritiri?dal=ieri').expect(400)
      await http().get('/ritiri?statoVisibile=BOH').expect(400)
    })

    it('dettaglio con id non UUID: 400; ritiro assente: 404 senza id nel messaggio', async () => {
      await http().get('/ritiri/xyz').expect(400)
      servizio.dettaglio.mockRejectedValue(new RitiroNonTrovatoError())
      const r = await http().get(`/ritiri/${ID}`).expect(404)
      expect(r.body.message).toBe('Ritiro non trovato.')
    })
  })

  describe('scrittura e ruoli', () => {
    it.each(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])(
      '%s puo creare, modificare e annullare',
      async r => {
        ruolo = r
        await http()
          .post('/ritiri')
          .send({ ...dati, chiaveIdempotenza: U(9) })
          .expect(201)
        await http()
          .put(`/ritiri/${ID}`)
          .send({ ...dati, versione: 1 })
          .expect(200)
        await http().post(`/ritiri/${ID}/annulla`).send({ motivo: 'x', versione: 1 }).expect(200)
        await http()
          .post(`/ritiri/${ID}/non-eseguito`)
          .send({ motivo: 'x', versione: 1 })
          .expect(200)
        await http()
          .post(`/ritiri/${ID}/riprogramma`)
          .send({ dataPrevista: '2026-12-09', versione: 2 })
          .expect(200)
        await http()
          .post('/ritiri/genera-fir')
          .send({ ritiroIds: [ID] })
          .expect(200)
      }
    )

    it.each(['VIEWER', 'CONSULTANT'])('%s non scrive: 403 RITIRI_RISERVATI_OPERATORI', async r => {
      ruolo = r
      const risposte = [
        await http()
          .post('/ritiri')
          .send({ ...dati, chiaveIdempotenza: U(9) }),
        await http()
          .put(`/ritiri/${ID}`)
          .send({ ...dati, versione: 1 }),
        await http().post(`/ritiri/${ID}/annulla`).send({ motivo: 'x', versione: 1 }),
        await http().post(`/ritiri/${ID}/non-eseguito`).send({ motivo: 'x', versione: 1 }),
        await http()
          .post(`/ritiri/${ID}/riprogramma`)
          .send({ dataPrevista: '2026-12-09', versione: 2 }),
        await http()
          .post('/ritiri/genera-fir')
          .send({ ritiroIds: [ID] }),
      ]
      for (const x of risposte) {
        expect(x.status).toBe(403)
        expect(x.body.error).toBe('RITIRI_RISERVATI_OPERATORI')
      }
      expect(servizio.crea).not.toHaveBeenCalled()
      expect(servizio.modifica).not.toHaveBeenCalled()
      expect(genera.genera).not.toHaveBeenCalled()
    })
  })

  describe('contratto con il frontend', () => {
    it('crea: passa tenant, utente e dati (con ripetizione) al servizio', async () => {
      const corpo = {
        ...dati,
        chiaveIdempotenza: U(9),
        ripetizione: { ogniSettimane: 1, fino: '2027-01-31' },
      }
      await http().post('/ritiri').send(corpo).expect(201)
      expect(servizio.crea).toHaveBeenCalledWith(TENANT, UTENTE, expect.objectContaining(corpo))
    })

    it('modifica, annulla, non eseguito e riprogramma portano la versione letta', async () => {
      await http()
        .put(`/ritiri/${ID}`)
        .send({ ...dati, versione: 3 })
        .expect(200)
      expect(servizio.modifica).toHaveBeenCalledWith(
        TENANT,
        ID,
        expect.objectContaining({ versione: 3 })
      )
      await http().post(`/ritiri/${ID}/annulla`).send({ motivo: 'Cliente assente', versione: 4 })
      expect(servizio.annulla).toHaveBeenCalledWith(TENANT, UTENTE, ID, 'Cliente assente', 4)
      await http().post(`/ritiri/${ID}/non-eseguito`).send({ motivo: 'Strada chiusa', versione: 5 })
      expect(servizio.nonEseguito).toHaveBeenCalledWith(TENANT, ID, 'Strada chiusa', 5)
      await http()
        .post(`/ritiri/${ID}/riprogramma`)
        .send({ dataPrevista: '2026-12-09', versione: 6 })
      expect(servizio.riprogramma).toHaveBeenCalledWith(TENANT, ID, '2026-12-09', 6)
    })

    it('genera-fir: da 1 a 100 UUID, ordine invariato, utente dal token', async () => {
      const ids = [U(11), U(10)]
      await http().post('/ritiri/genera-fir').send({ ritiroIds: ids }).expect(200)
      expect(genera.genera).toHaveBeenCalledWith(TENANT, UTENTE, ids)
      await http().post('/ritiri/genera-fir').send({ ritiroIds: [] }).expect(400)
      await http()
        .post('/ritiri/genera-fir')
        .send({ ritiroIds: Array.from({ length: 101 }, (_, i) => U(i + 1)) })
        .expect(400)
      await http()
        .post('/ritiri/genera-fir')
        .send({ ritiroIds: ['x'] })
        .expect(400)
    })

    it('il codice operazione e obbligatorio nel corpo; un campo estraneo (tipoOperazione) e rifiutato', async () => {
      const { codiceOperazione: _c, ...senza } = dati
      await http()
        .post('/ritiri')
        .send({ ...senza, chiaveIdempotenza: U(9) })
        .expect(400)
      await http()
        .post('/ritiri')
        .send({ ...dati, chiaveIdempotenza: U(9), tipoOperazione: 'RECOVERY' })
        .expect(400)
      expect(servizio.crea).not.toHaveBeenCalled()
    })
  })

  describe('errori di dominio', () => {
    it('dati non validi: 400 con i messaggi', async () => {
      servizio.crea.mockRejectedValue(new RitiroDatiNonValidiError(['La quantita non e valida.']))
      const r = await http()
        .post('/ritiri')
        .send({ ...dati, chiaveIdempotenza: U(9) })
        .expect(400)
      expect(r.body.details.messaggi).toEqual(['La quantita non e valida.'])
    })

    it('409 con codice macchina: RITIRO_CON_FIR, RITIRO_MODIFICATO, RITIRO_STATO_NON_VALIDO', async () => {
      servizio.annulla.mockRejectedValueOnce(new RitiroConFirError())
      servizio.modifica.mockRejectedValueOnce(new RitiroModificatoError())
      servizio.nonEseguito.mockRejectedValueOnce(new RitiroStatoNonValidoError('Stato non valido.'))
      const a = await http()
        .post(`/ritiri/${ID}/annulla`)
        .send({ motivo: 'x', versione: 1 })
        .expect(409)
      const m = await http()
        .put(`/ritiri/${ID}`)
        .send({ ...dati, versione: 1 })
        .expect(409)
      const n = await http()
        .post(`/ritiri/${ID}/non-eseguito`)
        .send({ motivo: 'x', versione: 1 })
        .expect(409)
      expect(a.body.error).toBe('RITIRO_CON_FIR')
      expect(m.body.error).toBe('RITIRO_MODIFICATO')
      expect(n.body.error).toBe('RITIRO_STATO_NON_VALIDO')
    })
  })
})
