/**
 * Controller `/comunicazioni/dati` attraverso la catena HTTP reale (ValidationPipe, filtro globale,
 * modulo commerciale). Ruolo effettivo e servizi sono finti: i servizi hanno le loro spec Postgres.
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { ModuloAttivoInterceptor } from '../../core/interceptors/modulo-attivo.interceptor'
import { ModuliAttiviService } from '../../application/admin/moduli-attivi.service'
import {
  ANAGRAFICA_COMUNICAZIONI_SERVICE,
  AnagraficaComunicazioniNonValidaError,
  SedeDittaNonTrovataError,
} from '../../application/comunicazioni/anagrafica-comunicazioni.port'
import {
  CONFIGURAZIONE_COMUNICAZIONI_SERVICE,
  ConfigurazioneComunicazioniNonValidaError,
  UnitaLocaleNonTrovataError,
} from '../../application/comunicazioni/configurazione-comunicazioni.port'
import {
  DATI_TRACCIATO_SERVICE,
  DatiTracciatoNonValidiError,
} from '../../application/comunicazioni/dati-tracciato.port'
import { MovimentoNonTrovatoError } from '../../application/comunicazioni/marcatura-consorzi.port'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { DatiComunicazioniController } from './dati-comunicazioni.controller'

const TENANT_TOKEN = '5a5a5a5a-0000-4000-8000-00000000000a'
const TENANT_SELEZIONATO = '5a5a5a5a-0000-4000-8000-00000000000b'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const ID = '4c4c4c4c-0000-4000-8000-000000000007'

describe('DatiComunicazioniController - catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let dati: Record<string, jest.Mock>
  let anagrafica: Record<string, jest.Mock>
  let configurazione: Record<string, jest.Mock>
  let moduliAttivi: jest.Mock

  beforeEach(async () => {
    ruolo = 'ADMIN'
    dati = {
      leggi: jest.fn().mockResolvedValue(null),
      imposta: jest.fn().mockResolvedValue({ tracciato: 'CONOU', dati: {}, versioneSchema: 1 }),
      cancella: jest.fn().mockResolvedValue(undefined),
    }
    anagrafica = {
      leggi: jest.fn().mockResolvedValue({ sedeDittaId: ID, eComune: false }),
      risolviIstat: jest.fn().mockResolvedValue({ codice: null, motivo: 'COMUNE_NON_TROVATO' }),
      imposta: jest.fn().mockResolvedValue({ sedeDittaId: ID, eComune: true }),
    }
    configurazione = {
      leggi: jest.fn().mockResolvedValue({ consorzio: 'CONOU', salvata: false, dati: {} }),
      imposta: jest.fn().mockResolvedValue({ consorzio: 'CONOU', salvata: true, dati: {} }),
    }
    moduliAttivi = jest.fn().mockResolvedValue(['comunicazioni'])
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [DatiComunicazioniController],
      providers: [
        { provide: DATI_TRACCIATO_SERVICE, useValue: dati },
        { provide: ANAGRAFICA_COMUNICAZIONI_SERVICE, useValue: anagrafica },
        { provide: CONFIGURAZIONE_COMUNICAZIONI_SERVICE, useValue: configurazione },
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

  describe('dati del movimento', () => {
    it('lettura per ogni ruolo, con l’azienda selezionata; dice se si puo modificare', async () => {
      ruolo = 'VIEWER'
      const r = await request(app.getHttpServer())
        .get(`/comunicazioni/dati/movimenti/${ID}/CONOU`)
        .set('X-Tenant-ID', TENANT_SELEZIONATO)
        .expect(200)
      expect(dati.leggi).toHaveBeenCalledWith(TENANT_SELEZIONATO, ID, 'CONOU')
      expect(r.body).toEqual({ dati: null, puoModificare: false })
    })

    it('scrittura: ADMIN e OPERATOR ok, corpo passato com’e’ al servizio', async () => {
      for (const r of ['ADMIN', 'OPERATOR']) {
        ruolo = r
        await request(app.getHttpServer())
          .put(`/comunicazioni/dati/movimenti/${ID}/COBAT`)
          .send({ tipoMovimento: 3 })
          .expect(200)
      }
      expect(dati.imposta).toHaveBeenCalledWith(TENANT_TOKEN, UTENTE, ID, 'COBAT', {
        tipoMovimento: 3,
      })
    })

    it('scrittura e cancellazione: ruolo di sola lettura -> 403, servizio non chiamato', async () => {
      ruolo = 'VIEWER'
      await request(app.getHttpServer())
        .put(`/comunicazioni/dati/movimenti/${ID}/ORR`)
        .send({})
        .expect(403)
      await request(app.getHttpServer())
        .delete(`/comunicazioni/dati/movimenti/${ID}/ORR`)
        .expect(403)
      expect(dati.imposta).not.toHaveBeenCalled()
      expect(dati.cancella).not.toHaveBeenCalled()
    })

    it('cancella: 204', async () => {
      await request(app.getHttpServer())
        .delete(`/comunicazioni/dati/movimenti/${ID}/CONOU`)
        .expect(204)
      expect(dati.cancella).toHaveBeenCalledWith(TENANT_TOKEN, ID, 'CONOU')
    })

    it('id non UUID o tracciato sconosciuto -> 400', async () => {
      await request(app.getHttpServer()).get('/comunicazioni/dati/movimenti/xx/CONOU').expect(400)
      await request(app.getHttpServer()).get(`/comunicazioni/dati/movimenti/${ID}/ORSO`).expect(400)
      expect(dati.leggi).not.toHaveBeenCalled()
    })

    it('dati non validi -> 400 con l’elenco degli errori; movimento di un’altra azienda -> 404', async () => {
      dati.imposta.mockRejectedValue(new DatiTracciatoNonValidiError(['prodotto: uno tra A, B']))
      const r = await request(app.getHttpServer())
        .put(`/comunicazioni/dati/movimenti/${ID}/CONOU`)
        .send({ prodotto: 'Z' })
        .expect(400)
      expect(JSON.stringify(r.body)).toContain('DATI_COMUNICAZIONE_NON_VALIDI')
      expect(JSON.stringify(r.body)).toContain('prodotto: uno tra A, B')
      dati.leggi.mockRejectedValue(new MovimentoNonTrovatoError())
      const nf = await request(app.getHttpServer())
        .get(`/comunicazioni/dati/movimenti/${ID}/CONOU`)
        .expect(404)
      expect(JSON.stringify(nf.body)).toContain('MOVIMENTO_NON_TROVATO')
    })
  })

  describe('anagrafica della sede ditta', () => {
    it('lettura con l’ISTAT risolto; scrittura validata dal DTO e dal servizio', async () => {
      ruolo = 'VIEWER'
      const r = await request(app.getHttpServer())
        .get(`/comunicazioni/dati/sedi-ditta/${ID}`)
        .expect(200)
      expect(r.body.istat).toEqual({ codice: null, motivo: 'COMUNE_NON_TROVATO' })
      expect(r.body.puoModificare).toBe(false)
      ruolo = 'ADMIN'
      await request(app.getHttpServer())
        .put(`/comunicazioni/dati/sedi-ditta/${ID}`)
        .send({ eComune: true, codiceAteco: '38.11.00' })
        .expect(200)
      expect(anagrafica.imposta).toHaveBeenCalledWith(TENANT_TOKEN, ID, {
        eComune: true,
        codiceAteco: '38.11.00',
      })
    })

    it('campi sconosciuti o di tipo sbagliato -> 400; ruolo di sola lettura -> 403', async () => {
      await request(app.getHttpServer())
        .put(`/comunicazioni/dati/sedi-ditta/${ID}`)
        .send({ altro: 1 })
        .expect(400)
      await request(app.getHttpServer())
        .put(`/comunicazioni/dati/sedi-ditta/${ID}`)
        .send({ eComune: 'si' })
        .expect(400)
      ruolo = 'VIEWER'
      await request(app.getHttpServer())
        .put(`/comunicazioni/dati/sedi-ditta/${ID}`)
        .send({})
        .expect(403)
      expect(anagrafica.imposta).not.toHaveBeenCalled()
    })

    it('dati non validi -> 400 con gli errori; sede di un’altra azienda -> 404', async () => {
      anagrafica.imposta.mockRejectedValue(
        new AnagraficaComunicazioniNonValidaError(['codiceAteco: formato'])
      )
      const r = await request(app.getHttpServer())
        .put(`/comunicazioni/dati/sedi-ditta/${ID}`)
        .send({})
        .expect(400)
      expect(JSON.stringify(r.body)).toContain('codiceAteco: formato')
      anagrafica.leggi.mockRejectedValue(new SedeDittaNonTrovataError())
      await request(app.getHttpServer()).get(`/comunicazioni/dati/sedi-ditta/${ID}`).expect(404)
    })
  })

  describe('configurazione della sede', () => {
    it('lettura e scrittura per consorzio', async () => {
      await request(app.getHttpServer()).get(`/comunicazioni/dati/sedi/${ID}/CONOU`).expect(200)
      expect(configurazione.leggi).toHaveBeenCalledWith(TENANT_TOKEN, ID, 'CONOU')
      await request(app.getHttpServer())
        .put(`/comunicazioni/dati/sedi/${ID}/ORSO`)
        .send({ modalita: 'DETTAGLIATA' })
        .expect(200)
      expect(configurazione.imposta).toHaveBeenCalledWith(TENANT_TOKEN, ID, 'ORSO', {
        modalita: 'DETTAGLIATA',
      })
    })

    it('consorzio sconosciuto -> 400; ruolo di sola lettura -> 403; dati non validi -> 400; sede altrui -> 404', async () => {
      await request(app.getHttpServer()).get(`/comunicazioni/dati/sedi/${ID}/COREPLA`).expect(400)
      ruolo = 'VIEWER'
      await request(app.getHttpServer())
        .put(`/comunicazioni/dati/sedi/${ID}/CONOU`)
        .send({})
        .expect(403)
      ruolo = 'ADMIN'
      configurazione.imposta.mockRejectedValue(
        new ConfigurazioneComunicazioniNonValidaError(['codiceDeposito: x'])
      )
      await request(app.getHttpServer())
        .put(`/comunicazioni/dati/sedi/${ID}/CONOU`)
        .send({})
        .expect(400)
      configurazione.leggi.mockRejectedValue(new UnitaLocaleNonTrovataError())
      await request(app.getHttpServer()).get(`/comunicazioni/dati/sedi/${ID}/CONOU`).expect(404)
    })
  })

  it('senza il modulo comunicazioni: 403 MODULO_NON_ATTIVO su ogni rotta, servizi non chiamati', async () => {
    moduliAttivi.mockResolvedValue(['registro'])
    const s = app.getHttpServer()
    const risposte = [
      await request(s).get(`/comunicazioni/dati/movimenti/${ID}/CONOU`),
      await request(s).put(`/comunicazioni/dati/movimenti/${ID}/CONOU`).send({}),
      await request(s).delete(`/comunicazioni/dati/movimenti/${ID}/CONOU`),
      await request(s).get(`/comunicazioni/dati/sedi-ditta/${ID}`),
      await request(s).put(`/comunicazioni/dati/sedi-ditta/${ID}`).send({}),
      await request(s).get(`/comunicazioni/dati/sedi/${ID}/CONOU`),
      await request(s).put(`/comunicazioni/dati/sedi/${ID}/CONOU`).send({}),
    ]
    expect(risposte.map(r => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403])
    expect(JSON.stringify(risposte[0].body)).toContain('MODULO_NON_ATTIVO')
    for (const m of [
      ...Object.values(dati),
      ...Object.values(anagrafica),
      ...Object.values(configurazione),
    ]) {
      expect(m).not.toHaveBeenCalled()
    }
  })
})
