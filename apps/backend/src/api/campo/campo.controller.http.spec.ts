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
import { PushCampoService } from '../../application/campo/push-campo.service'
import { AutistiService } from '../../application/campo/autisti.service'
import {
  AutistaDatiNonValidiError,
  AutistaDuplicatoError,
  AutistaNonCollegatoError,
} from '../../application/campo/errori-campo'
import { GiroService } from '../../application/campo/giro.service'
import { EventiCampoService } from '../../application/campo/eventi-campo.service'
import {
  EventoCampoDiAltroUtenteError,
  EventoCampoNonTrovatoError,
  FotoCampoGiaUsataError,
  FotoCampoHashNonCorrispondenteError,
  FotoCampoLimiteEventoError,
  FotoCampoNonTrovataError,
  FotoCampoTipoNonAmmessoError,
  FotoCampoTroppoGrandeError,
  RicevutaAlterataError,
  RicevutaDiAltroUtenteError,
  RicevutaLimiteRitiroError,
  RicevutaNonConsentitaError,
  RicevutaNonTrovataError,
  RicevutaTroppoGrandeError,
} from '../../application/campo/errori-campo'
import { AllegatiCampoService } from '../../application/campo/allegati-campo.service'
import { MAX_BYTE_FOTO_CAMPO } from '../../application/campo/allegati-campo.input'
import { RicevuteRitiroService } from '../../application/campo/ricevute-ritiro.service'
import { pngDiProva } from '../../test-support/png-di-prova'
import { RitiroNonTrovatoError } from '../../application/ritiri/errori-ritiri'
import { EsitiCampoController } from './esiti-campo.controller'
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
const EVENTO = '4c4c4c4c-0000-4000-8000-000000000007'
const FOTO = '5d5d5d5d-0000-4000-8000-000000000008'
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 7)])
const SHA = 'b'.repeat(64)
const RICEVUTA = '5d5d5d5d-0000-4000-8000-000000000009'
const corpoRicevuta = {
  id: RICEVUTA,
  ritiroId: ID,
  firmatarioNome: 'Mario Rossi',
  firmatoIl: '2026-12-01T08:30:00.000Z',
  firmaPng: pngDiProva().toString('base64'),
}
const corpoEvento = {
  id: EVENTO,
  ritiroId: ID,
  tipo: 'RITIRO_ESEGUITO',
  versioneVista: 2,
  dataVista: '2026-12-01',
  sedeVista: '33333333-3333-4333-8333-333333333333',
  rilevatoIl: '2026-12-01T08:30:00.000Z',
}

describe('Campo - catena HTTP', () => {
  let app: INestApplication
  let utente: { id: string; tenantId: string; role: string }
  let ruoloEffettivo: string
  let moduliAttivi: string[]
  let giro: { giro: jest.Mock }
  let eventi: { registra: jest.Mock; elenca: jest.Mock }
  let ricevute: {
    registra: jest.Mock
    configurazione: jest.Mock
    elenca: jest.Mock
    leggiPdf: jest.Mock
  }
  let foto: { registra: jest.Mock; leggi: jest.Mock }
  let autisti: Record<string, jest.Mock>
  let ritiri: Record<string, jest.Mock>
  let push: Record<string, jest.Mock>

  beforeEach(async () => {
    utente = { id: UTENTE, tenantId: TENANT, role: 'AUTISTA' }
    ruoloEffettivo = 'OPERATOR'
    moduliAttivi = ['campo', 'ritiri']
    giro = { giro: jest.fn().mockResolvedValue({ data: '2026-11-19', ritiri: [] }) }
    eventi = {
      registra: jest
        .fn()
        .mockResolvedValue({ id: EVENTO, esito: 'APPLICATO', motivoConflitto: null }),
      elenca: jest.fn().mockResolvedValue({ righe: [], totale: 0 }),
    }
    ricevute = {
      registra: jest.fn().mockResolvedValue({ id: RICEVUTA, invio: 'NON_RICHIESTO' }),
      configurazione: jest.fn().mockReturnValue({ invioEmail: false }),
      elenca: jest.fn().mockResolvedValue({ righe: [], totale: 0 }),
      leggiPdf: jest.fn().mockResolvedValue({
        nomeFile: 'ricevuta-ritiro-2026-12-01.pdf',
        contenuto: Buffer.from('%PDF-1.7 prova'),
      }),
    }
    foto = {
      registra: jest.fn().mockResolvedValue({ id: FOTO, eventoId: EVENTO }),
      leggi: jest.fn().mockResolvedValue({
        mimeType: 'image/jpeg',
        sha256: 'a'.repeat(64),
        contenuto: JPEG,
      }),
    }
    autisti = {
      elenca: jest.fn().mockResolvedValue([]),
      crea: jest.fn().mockResolvedValue({ id: ID }),
      aggiorna: jest.fn().mockResolvedValue({ id: ID }),
    }
    push = { liberaDiAutista: jest.fn().mockResolvedValue(2) }
    ritiri = { elenca: jest.fn().mockResolvedValue({ righe: [], totale: 0 }) }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [CampoController, AutistiController, RitiriController, EsitiCampoController],
      providers: [
        { provide: GiroService, useValue: giro },
        { provide: EventiCampoService, useValue: eventi },
        { provide: RicevuteRitiroService, useValue: ricevute },
        { provide: AllegatiCampoService, useValue: foto },
        { provide: AutistiService, useValue: autisti },
        { provide: RitiriService, useValue: ritiri },
        { provide: PushCampoService, useValue: push },
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

    it('invia un esito: il servizio riceve azienda, utente del token e corpo; risposta 200', async () => {
      const r = await http().post('/campo/eventi').send(corpoEvento).expect(200)
      expect(r.body).toEqual({ id: EVENTO, esito: 'APPLICATO', motivoConflitto: null })
      expect(eventi.registra).toHaveBeenCalledWith(TENANT, UTENTE, corpoEvento)
    })

    it('il corpo non puo indicare autista, utente o azienda (whitelist) e deve essere valido', async () => {
      for (const extra of [
        { autistaId: ID },
        { utenteId: ID },
        { tenantId: TENANT },
        { esito: 'APPLICATO' },
      ]) {
        await http()
          .post('/campo/eventi')
          .send({ ...corpoEvento, ...extra })
          .expect(400)
      }
      await http()
        .post('/campo/eventi')
        .send({ ...corpoEvento, id: 'x' })
        .expect(400)
      await http()
        .post('/campo/eventi')
        .send({ ...corpoEvento, tipo: 'ALTRO' })
        .expect(400)
      await http()
        .post('/campo/eventi')
        .send({ ...corpoEvento, versioneVista: 0 })
        .expect(400)
      await http()
        .post('/campo/eventi')
        .send({ ...corpoEvento, dati: 'x' })
        .expect(400)
      expect(eventi.registra).not.toHaveBeenCalled()
    })

    it('errori dell esito: 404 ritiro, 409 EVENTO_DI_ALTRO_UTENTE, 403 AUTISTA_NON_COLLEGATO', async () => {
      eventi.registra.mockRejectedValueOnce(new RitiroNonTrovatoError())
      await http().post('/campo/eventi').send(corpoEvento).expect(404)
      eventi.registra.mockRejectedValueOnce(new EventoCampoDiAltroUtenteError())
      const c = await http().post('/campo/eventi').send(corpoEvento).expect(409)
      expect(JSON.stringify(c.body)).toContain('EVENTO_DI_ALTRO_UTENTE')
      eventi.registra.mockRejectedValueOnce(new AutistaNonCollegatoError())
      const f = await http().post('/campo/eventi').send(corpoEvento).expect(403)
      expect(JSON.stringify(f.body)).toContain('AUTISTA_NON_COLLEGATO')
    })

    it('invia una ricevuta: il servizio riceve azienda, utente del token e corpo', async () => {
      const r = await http().post('/campo/ricevute').send(corpoRicevuta).expect(200)
      expect(r.body).toEqual({ id: RICEVUTA, invio: 'NON_RICHIESTO' })
      expect(ricevute.registra).toHaveBeenCalledWith(TENANT, UTENTE, corpoRicevuta)
      await http()
        .post('/campo/ricevute')
        .send({ ...corpoRicevuta, emailCliente: 'c@esempio.it' })
        .expect(200)
    })

    it('la ricevuta non puo indicare autista, utente, azienda, dati del ritiro o hash (whitelist) e deve avere la forma giusta', async () => {
      for (const extra of [
        { autistaId: ID },
        { utenteId: ID },
        { tenantId: TENANT },
        { cliente: 'Altro SRL' },
        { pdfSha256: 'a'.repeat(64) },
      ]) {
        await http()
          .post('/campo/ricevute')
          .send({ ...corpoRicevuta, ...extra })
          .expect(400)
      }
      for (const guasto of [
        { id: 'x' },
        { ritiroId: 'x' },
        { firmatarioNome: 12 },
        { firmatoIl: 5 },
        { firmaPng: 5 },
        { emailCliente: 5 },
      ]) {
        await http()
          .post('/campo/ricevute')
          .send({ ...corpoRicevuta, ...guasto })
          .expect(400)
      }
      expect(ricevute.registra).not.toHaveBeenCalled()
    })

    it('errori della ricevuta: 404, 409 con codice, 403', async () => {
      ricevute.registra.mockRejectedValueOnce(new RitiroNonTrovatoError())
      await http().post('/campo/ricevute').send(corpoRicevuta).expect(404)
      for (const [errore, codice] of [
        [new RicevutaDiAltroUtenteError(), 'RICEVUTA_DI_ALTRO_UTENTE'],
        [
          new RicevutaNonConsentitaError('Il ritiro non è più assegnato a te.'),
          'RICEVUTA_NON_CONSENTITA',
        ],
        [new RicevutaLimiteRitiroError(5), 'RICEVUTA_LIMITE_RITIRO'],
      ] as const) {
        ricevute.registra.mockRejectedValueOnce(errore)
        const c = await http().post('/campo/ricevute').send(corpoRicevuta).expect(409)
        expect(JSON.stringify(c.body)).toContain(codice)
      }
      ricevute.registra.mockRejectedValueOnce(new AutistaNonCollegatoError())
      await http().post('/campo/ricevute').send(corpoRicevuta).expect(403)
      // PDF oltre il limite: 422 definitivo (il telefono non ritenta), con codice.
      ricevute.registra.mockRejectedValueOnce(new RicevutaTroppoGrandeError())
      const g = await http().post('/campo/ricevute').send(corpoRicevuta).expect(422)
      expect(JSON.stringify(g.body)).toContain('RICEVUTA_TROPPO_GRANDE')
    })

    it('legge se l invio al cliente e acceso (spento per default)', async () => {
      const r = await http().get('/campo/ricevute/configurazione').expect(200)
      expect(r.body).toEqual({ invioEmail: false })
    })

    it('senza il modulo campo anche le ricevute sono chiuse; non legge l archivio d ufficio', async () => {
      moduliAttivi = ['ritiri']
      await http().post('/campo/ricevute').send(corpoRicevuta).expect(403)
      moduliAttivi = ['campo']
      for (const richiesta of [
        () => http().get('/esiti-campo/ricevute'),
        () => http().get(`/esiti-campo/ricevute/${RICEVUTA}/pdf`),
      ]) {
        const r = await richiesta()
        expect(r.status).toBe(403)
        expect(JSON.stringify(r.body)).toContain('ROTTA_NON_CONSENTITA_ALL_AUTISTA')
      }
      expect(ricevute.registra).not.toHaveBeenCalled()
      expect(ricevute.elenca).not.toHaveBeenCalled()
      expect(ricevute.leggiPdf).not.toHaveBeenCalled()
    })

    it('un esito con la posizione passa al servizio; senza posizione resta valido (app gia installate)', async () => {
      const conPosizione = {
        ...corpoEvento,
        dati: { nota: 'x', posizione: { lat: 45.1, lon: 9.2, accuratezza: 8 } },
      }
      await http().post('/campo/eventi').send(conPosizione).expect(200)
      expect(eventi.registra).toHaveBeenLastCalledWith(TENANT, UTENTE, conPosizione)
      await http().post('/campo/eventi').send(corpoEvento).expect(200)
    })

    describe('foto', () => {
      const invia = (
        b: Buffer = JPEG,
        campi: Record<string, string> = { id: FOTO, sha256: SHA }
      ) => {
        let r = http().post(`/campo/eventi/${EVENTO}/foto`)
        for (const [k, v] of Object.entries(campi)) r = r.field(k, v)
        return b.length ? r.attach('foto', b, { filename: 'f.jpg', contentType: 'image/jpeg' }) : r
      }

      it('il servizio riceve azienda, utente del token, evento, id, impronta e byte', async () => {
        const r = await invia().expect(200)
        expect(r.body).toEqual({ id: FOTO, eventoId: EVENTO })
        expect(foto.registra).toHaveBeenCalledWith(TENANT, UTENTE, EVENTO, {
          id: FOTO,
          sha256: SHA,
          contenuto: JPEG,
        })
      })

      it('senza file il servizio riceve contenuto assente (lo rifiuta: 400); campi mancanti o in piu: 400', async () => {
        await invia(Buffer.alloc(0)).expect(200)
        expect(foto.registra).toHaveBeenLastCalledWith(TENANT, UTENTE, EVENTO, {
          id: FOTO,
          sha256: SHA,
          contenuto: undefined,
        })
        foto.registra.mockClear()
        await invia(JPEG, { id: FOTO }).expect(400)
        await invia(JPEG, { id: FOTO, sha256: SHA, utenteId: UTENTE }).expect(400)
        await invia(JPEG, { id: 'x', sha256: SHA }).expect(400)
        await invia(JPEG, { id: FOTO, sha256: 'zz' }).expect(400)
        expect(foto.registra).not.toHaveBeenCalled()
      })

      it('un evento con id non uuid: 400', async () => {
        await http().post('/campo/eventi/x/foto').field('id', FOTO).field('sha256', SHA).expect(400)
      })

      it('oltre il tetto per foto multer si ferma: 413 FOTO_TROPPO_GRANDE senza arrivare al servizio', async () => {
        const r = await invia(Buffer.alloc(MAX_BYTE_FOTO_CAMPO + 2, 1)).expect(413)
        expect(JSON.stringify(r.body)).toContain('FOTO_TROPPO_GRANDE')
        expect(foto.registra).not.toHaveBeenCalled()
      })

      it.each([
        ['404 evento', new EventoCampoNonTrovatoError(), 404, 'Evento non trovato'],
        ['409 altro utente', new EventoCampoDiAltroUtenteError(), 409, 'EVENTO_DI_ALTRO_UTENTE'],
        ['409 foto gia usata', new FotoCampoGiaUsataError(), 409, 'FOTO_GIA_USATA'],
        ['413 troppo grande', new FotoCampoTroppoGrandeError('x'), 413, 'FOTO_TROPPO_GRANDE'],
        ['415 tipo', new FotoCampoTipoNonAmmessoError(), 415, 'FOTO_TIPO_NON_AMMESSO'],
        [
          '422 hash',
          new FotoCampoHashNonCorrispondenteError(),
          422,
          'FOTO_HASH_NON_CORRISPONDENTE',
        ],
        ['422 limite', new FotoCampoLimiteEventoError(3), 422, 'FOTO_LIMITE_EVENTO'],
      ])('errori del servizio: %s', async (_n, errore, stato, marcatore) => {
        foto.registra.mockRejectedValueOnce(errore)
        const r = await invia().expect(stato)
        expect(JSON.stringify(r.body)).toContain(marcatore)
      })

      it('un utente d ufficio non puo inviare foto: 403', async () => {
        utente.role = 'ADMIN'
        await invia().expect(403)
        expect(foto.registra).not.toHaveBeenCalled()
      })

      it('senza il modulo campo: 403 MODULO_NON_ATTIVO', async () => {
        moduliAttivi = ['ritiri']
        const r = await invia().expect(403)
        expect(JSON.stringify(r.body)).toContain('MODULO_NON_ATTIVO')
      })

      it('non scarica le foto d ufficio: 403', async () => {
        await http().get(`/esiti-campo/foto/${FOTO}`).expect(403)
        expect(foto.leggi).not.toHaveBeenCalled()
      })
    })

    it('non legge gli esiti d ufficio: 403 e il servizio non gira', async () => {
      const r = await http().get('/esiti-campo').expect(403)
      expect(JSON.stringify(r.body)).toContain('ROTTA_NON_CONSENTITA_ALL_AUTISTA')
      expect(eventi.elenca).not.toHaveBeenCalled()
    })

    it('senza il modulo campo anche l invio e chiuso (403 MODULO_NON_ATTIVO)', async () => {
      moduliAttivi = ['ritiri']
      const r = await http().post('/campo/eventi').send(corpoEvento).expect(403)
      expect(JSON.stringify(r.body)).toContain('MODULO_NON_ATTIVO')
      expect(eventi.registra).not.toHaveBeenCalled()
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

    it('non puo inviare esiti (e dell autista): 403 e il servizio non gira', async () => {
      const r = await http().post('/campo/eventi').send(corpoEvento).expect(403)
      expect(JSON.stringify(r.body)).toContain('GIRO_RISERVATO_AGLI_AUTISTI')
      expect(eventi.registra).not.toHaveBeenCalled()
    })

    it('legge gli esiti dal campo, con filtro e pagina; filtro non valido: 400', async () => {
      eventi.elenca.mockResolvedValue({ righe: [{ id: EVENTO }], totale: 1 })
      const r = await http().get('/esiti-campo?esito=DA_RICONCILIARE&pagina=2').expect(200)
      expect(r.body).toEqual({ righe: [{ id: EVENTO }], totale: 1 })
      expect(eventi.elenca).toHaveBeenCalledWith(TENANT, { esito: 'DA_RICONCILIARE', pagina: 2 })
      await http().get('/esiti-campo?esito=BOH').expect(400)
      await http().get('/esiti-campo?pagina=0').expect(400)
      ruoloEffettivo = 'VIEWER'
      await http().get('/esiti-campo').expect(200)
    })

    it('non puo inviare ricevute ne leggerne la configurazione (e dell autista): 403', async () => {
      await http().post('/campo/ricevute').send(corpoRicevuta).expect(403)
      await http().get('/campo/ricevute/configurazione').expect(403)
      expect(ricevute.registra).not.toHaveBeenCalled()
    })

    it('elenca le ricevute e scarica il PDF archiviato con intestazioni di sicurezza', async () => {
      ricevute.elenca.mockResolvedValue({ righe: [{ id: RICEVUTA }], totale: 1 })
      const e = await http().get(`/esiti-campo/ricevute?ritiroId=${ID}&pagina=2`).expect(200)
      expect(e.body).toEqual({ righe: [{ id: RICEVUTA }], totale: 1 })
      expect(ricevute.elenca).toHaveBeenCalledWith(TENANT, { ritiroId: ID, pagina: 2 })
      await http().get('/esiti-campo/ricevute?ritiroId=x').expect(400)
      await http().get('/esiti-campo/ricevute?pagina=0').expect(400)

      const r = await http().get(`/esiti-campo/ricevute/${RICEVUTA}/pdf`).expect(200)
      expect(r.headers['content-type']).toContain('application/pdf')
      expect(r.headers['content-disposition']).toBe(
        'attachment; filename="ricevuta-ritiro-2026-12-01.pdf"'
      )
      expect(r.headers['x-content-type-options']).toBe('nosniff')
      expect(r.headers['cache-control']).toBe('private, no-store')
      expect(r.headers['content-security-policy']).toBe('sandbox')
      expect(Buffer.from(r.body).toString()).toBe('%PDF-1.7 prova')
      expect(ricevute.leggiPdf).toHaveBeenCalledWith(TENANT, RICEVUTA)
      await http().get('/esiti-campo/ricevute/non-un-uuid/pdf').expect(400)
      ricevute.leggiPdf.mockRejectedValueOnce(new RicevutaNonTrovataError())
      await http().get(`/esiti-campo/ricevute/${RICEVUTA}/pdf`).expect(404)
      // Integrita' violata: errore con codice (non un 500 anonimo).
      ricevute.leggiPdf.mockRejectedValueOnce(new RicevutaAlterataError())
      const alt = await http().get(`/esiti-campo/ricevute/${RICEVUTA}/pdf`).expect(409)
      expect(JSON.stringify(alt.body)).toContain('RICEVUTA_ALTERATA')
    })

    it('scarica una foto: byte, tipo salvato, nosniff, sandbox e niente cache', async () => {
      ruoloEffettivo = 'VIEWER'
      const r = await http().get(`/esiti-campo/foto/${FOTO}`).expect(200)
      expect(r.headers['content-type']).toContain('image/jpeg')
      expect(r.headers['x-content-type-options']).toBe('nosniff')
      expect(r.headers['content-security-policy']).toBe('sandbox')
      expect(r.headers['cache-control']).toBe('private, no-store')
      expect(Buffer.from(r.body).equals(JPEG)).toBe(true)
      expect(foto.leggi).toHaveBeenCalledWith(TENANT, FOTO)
    })

    it('foto inesistente o id non valido: 404 / 400; senza il modulo campo 403', async () => {
      foto.leggi.mockRejectedValueOnce(new FotoCampoNonTrovataError())
      await http().get(`/esiti-campo/foto/${FOTO}`).expect(404)
      await http().get('/esiti-campo/foto/x').expect(400)
      moduliAttivi = ['ritiri']
      await http().get(`/esiti-campo/foto/${FOTO}`).expect(403)
    })

    it('gli esiti richiedono il modulo campo', async () => {
      moduliAttivi = ['ritiri']
      await http().get('/esiti-campo').expect(403)
    })

    it('elenca gli autisti e con attivi=true passa il filtro', async () => {
      autisti.elenca.mockResolvedValue([{ id: ID }])
      const r = await http().get('/autisti?attivi=true').expect(200)
      expect(r.body).toEqual({ righe: [{ id: ID }], puoOperare: true })
      expect(autisti.elenca).toHaveBeenCalledWith(TENANT, { soloAttivi: true })
      await http().get('/autisti?attivi=boh').expect(400)
    })

    it('libera le notifiche di un autista: solo ADMIN, 200 con il numero, utente e azienda dal token', async () => {
      ruoloEffettivo = 'ADMIN'
      const r = await http().delete(`/autisti/${ID}/notifiche`).expect(200)
      expect(r.body).toEqual({ rimosse: 2 })
      expect(push.liberaDiAutista).toHaveBeenCalledWith(TENANT, UTENTE, ID)
      for (const ruolo of ['OPERATOR', 'VIEWER']) {
        ruoloEffettivo = ruolo
        await http().delete(`/autisti/${ID}/notifiche`).expect(403)
      }
      expect(push.liberaDiAutista).toHaveBeenCalledTimes(1)
      ruoloEffettivo = 'ADMIN'
      await http().delete('/autisti/non-un-uuid/notifiche').expect(400)
    })

    it('un AUTISTA non puo liberare le notifiche di nessuno: 403', async () => {
      utente = { id: UTENTE, tenantId: TENANT, role: 'AUTISTA' }
      ruoloEffettivo = 'ADMIN'
      await http().delete(`/autisti/${ID}/notifiche`).expect(403)
      expect(push.liberaDiAutista).not.toHaveBeenCalled()
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
