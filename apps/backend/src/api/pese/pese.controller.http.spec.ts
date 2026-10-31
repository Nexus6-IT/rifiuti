/**
 * Anagrafiche delle pese attraverso la catena HTTP reale (ValidationPipe, filtro globale,
 * controller). Ruolo effettivo e servizi sono finti: i servizi hanno i loro test.
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import request from 'supertest'
import { PeseController } from './pese.controller'
import { StrumentiPesaService } from '../../application/pese/strumenti-pesa.service'
import { AutomezziService } from '../../application/pese/automezzi.service'
import {
  AutomezzoDuplicatoError,
  DatiPesaNonValidiError,
  RegolaPesataError,
  TrasportatoreNonTrovatoError,
} from '../../application/pese/errori-pese'
import { AccessiPesaService } from '../../application/pese/accessi-pesa.service'
import { AllegatiPesaService } from '../../application/pese/allegati-pesa.service'
import { RettifichePesoService } from '../../application/pese/rettifiche-peso.service'
import { CollegamentiAccessoService } from '../../application/pese/collegamenti-accesso.service'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const TENANT_TOKEN = '5a5a5a5a-0000-4000-8000-00000000000a'
const TENANT_SELEZIONATO = '5a5a5a5a-0000-4000-8000-00000000000b'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const ID = '3b3b3b3b-0000-4000-8000-000000000006'
const PESATA = '4c4c4c4c-0000-4000-8000-000000000007'

describe('PeseController (anagrafiche) - catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let strumenti: Record<string, jest.Mock>
  let automezzi: Record<string, jest.Mock>
  let ruoloEffettivo: jest.Mock

  beforeEach(async () => {
    ruolo = 'ADMIN'
    strumenti = {
      elenca: jest.fn().mockResolvedValue([]),
      crea: jest.fn().mockResolvedValue({ id: ID }),
      aggiorna: jest.fn().mockResolvedValue({ id: ID }),
    }
    automezzi = {
      elenca: jest.fn().mockResolvedValue([]),
      crea: jest.fn().mockResolvedValue({ id: ID }),
      aggiorna: jest.fn().mockResolvedValue({ id: ID }),
      impostaTara: jest.fn().mockResolvedValue({ id: ID }),
    }
    ruoloEffettivo = jest.fn(async () => ruolo)
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [PeseController],
      providers: [
        { provide: StrumentiPesaService, useValue: strumenti },
        { provide: AutomezziService, useValue: automezzi },
        { provide: AccessiPesaService, useValue: {} },
        { provide: AllegatiPesaService, useValue: {} },
        { provide: RettifichePesoService, useValue: {} },
        { provide: CollegamentiAccessoService, useValue: {} },
        { provide: RuoloEffettivoService, useValue: { ruoloEffettivo } },
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

  const strumento = { descrizione: 'Pesa a ponte', portataMaxKg: 60000 }

  it("usa l'azienda selezionata (X-Tenant-ID) e il ruolo effettivo in quell'azienda", async () => {
    await request(app.getHttpServer())
      .post('/pese/strumenti')
      .set('X-Tenant-ID', TENANT_SELEZIONATO)
      .send(strumento)
      .expect(201)

    expect(ruoloEffettivo).toHaveBeenCalledWith(expect.anything(), TENANT_SELEZIONATO)
    expect(strumenti.crea).toHaveBeenCalledWith(TENANT_SELEZIONATO, UTENTE, strumento)
  })

  it('operatore che crea uno strumento: 403 PESE_RISERVATE_AMMINISTRATORI, servizio non chiamato', async () => {
    ruolo = 'OPERATOR'

    const r = await request(app.getHttpServer()).post('/pese/strumenti').send(strumento).expect(403)
    await request(app.getHttpServer()).put(`/pese/strumenti/${ID}`).send(strumento).expect(403)

    expect(r.body.error).toBe('PESE_RISERVATE_AMMINISTRATORI')
    expect(strumenti.crea).not.toHaveBeenCalled()
    expect(strumenti.aggiorna).not.toHaveBeenCalled()
  })

  it('operatore: gestisce gli automezzi; lettore (CONSULTANT) no, ma legge', async () => {
    ruolo = 'OPERATOR'
    await request(app.getHttpServer())
      .post('/pese/automezzi')
      .send({ targa: 'AB123CD' })
      .expect(201)
    ruolo = 'CONSULTANT'
    const r = await request(app.getHttpServer())
      .post('/pese/automezzi')
      .send({ targa: 'AB123CD' })
      .expect(403)
    expect(JSON.stringify(r.body)).toContain('PESE_RISERVATE_OPERATORI')
    const lista = await request(app.getHttpServer()).get('/pese/automezzi?targa=ab').expect(200)
    expect(lista.body).toMatchObject({ righe: [], puoOperare: false, puoRettificare: false })
    expect(automezzi.elenca).toHaveBeenCalledWith(TENANT_TOKEN, 'ab')
  })

  it('operatore: tara dichiarata 403, tara da pesata ok', async () => {
    ruolo = 'OPERATOR'

    const r = await request(app.getHttpServer())
      .put(`/pese/automezzi/${ID}/tara`)
      .send({ taraKg: 7000 })
      .expect(403)
    expect(JSON.stringify(r.body)).toContain('PESE_RISERVATE_AMMINISTRATORI')
    expect(automezzi.impostaTara).not.toHaveBeenCalled()

    await request(app.getHttpServer())
      .put(`/pese/automezzi/${ID}/tara`)
      .send({ pesataId: PESATA })
      .expect(200)
    expect(automezzi.impostaTara).toHaveBeenCalledWith(TENANT_TOKEN, UTENTE, ID, {
      pesataId: PESATA,
    })
  })

  it('amministratore: tara dichiarata ok; tara e pesata insieme o nessuna: 400', async () => {
    await request(app.getHttpServer())
      .put(`/pese/automezzi/${ID}/tara`)
      .send({ taraKg: 7000 })
      .expect(200)
    await request(app.getHttpServer())
      .put(`/pese/automezzi/${ID}/tara`)
      .send({ taraKg: 7000, pesataId: PESATA })
      .expect(400)
    await request(app.getHttpServer()).put(`/pese/automezzi/${ID}/tara`).send({}).expect(400)
    const nullo = await request(app.getHttpServer())
      .put(`/pese/automezzi/${ID}/tara`)
      .send({ taraKg: null })
      .expect(400)
    expect(JSON.stringify(nullo.body)).toContain('Indicare la tara oppure la pesata')
    expect(automezzi.impostaTara).toHaveBeenCalledTimes(1)
  })

  it('traduce gli errori di dominio: 400, 404, 409, 422', async () => {
    automezzi.crea.mockRejectedValueOnce(new DatiPesaNonValidiError(['Targa non valida.']))
    const r400 = await request(app.getHttpServer())
      .post('/pese/automezzi')
      .send({ targa: '!' })
      .expect(400)
    expect(JSON.stringify(r400.body)).toContain('Targa non valida.')

    automezzi.crea.mockRejectedValueOnce(new AutomezzoDuplicatoError())
    const r409 = await request(app.getHttpServer())
      .post('/pese/automezzi')
      .send({ targa: 'AB123CD' })
      .expect(409)
    expect(JSON.stringify(r409.body)).toContain('Esiste già un automezzo con queste targhe.')

    automezzi.crea.mockRejectedValueOnce(new TrasportatoreNonTrovatoError())
    const r404 = await request(app.getHttpServer())
      .post('/pese/automezzi')
      .send({ targa: 'AB123CD', trasportatoreId: ID })
      .expect(404)
    expect(JSON.stringify(r404.body)).not.toContain(ID)

    automezzi.impostaTara.mockRejectedValueOnce(
      new RegolaPesataError(['Una pesata instabile non è un peso.'])
    )
    await request(app.getHttpServer())
      .put(`/pese/automezzi/${ID}/tara`)
      .send({ pesataId: PESATA })
      .expect(422)
  })

  it('id non UUID: 400; campi sconosciuti: 400', async () => {
    await request(app.getHttpServer()).put('/pese/strumenti/xyz').send(strumento).expect(400)
    await request(app.getHttpServer())
      .post('/pese/automezzi')
      .send({ targa: 'AB123CD', tenantId: 'x' })
      .expect(400)
  })
})
