/**
 * AddebitiController con pipe, guard dei ruoli e filtro reali e servizio finto: contratto HTTP
 * del Task 9 (R12/R24), validazione dei DTO, UUID, azienda selezionata, ruoli, utente.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { AddebitiController } from './addebiti.controller'
import { AddebitiService } from '../../application/listino/addebiti.service'
import { VariazioniArchivioService } from '../../application/listino/variazioni-archivio.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'
const GRUPPO = '8f8f8f8f-0000-4000-8000-000000000005'

const corpoValido = { descrizione: 'Trasporto', gruppoId: GRUPPO, unitaMisura: 'KG' }

describe('AddebitiController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = AddebitiController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it.each(['list', 'prossimoCodice', 'getById'])('%s: lettura a tutti i ruoli', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    })

    it.each(['crea', 'modifica', 'elimina'])('%s: scrittura senza VIEWER', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])
    })

    it.each(['anteprimaVariazione', 'applicaVariazione'])(
      '%s: solo SUPER_ADMIN e ADMIN (R11)',
      nome => {
        expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN'])
      }
    )

    it('ogni rotta pubblica ha @Roles esplicito', () => {
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual([
        'anteprimaVariazione',
        'applicaVariazione',
        'crea',
        'elimina',
        'getById',
        'list',
        'modifica',
        'prossimoCodice',
      ])
      for (const n of metodi) expect(ruoli(n)?.length).toBeGreaterThan(0)
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let variazioni: Record<string, jest.Mock>
    let ruolo = 'OPERATOR'

    beforeEach(async () => {
      ruolo = 'OPERATOR'
      servizio = {
        list: jest.fn().mockResolvedValue({ elementi: [], totale: 0 }),
        getById: jest.fn().mockResolvedValue({ id: ID }),
        crea: jest.fn().mockResolvedValue({ id: ID }),
        modifica: jest.fn().mockResolvedValue({ id: ID }),
        elimina: jest.fn().mockResolvedValue(undefined),
        prossimoCodice: jest.fn().mockResolvedValue('00001'),
      }
      variazioni = {
        anteprima: jest.fn().mockResolvedValue({ totale: 0, righe: [], errori: [], impronta: 'x' }),
        applica: jest.fn().mockResolvedValue({ aggiornati: 3 }),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [AddebitiController],
        providers: [
          { provide: AddebitiService, useValue: servizio },
          { provide: VariazioniArchivioService, useValue: variazioni },
          { provide: RuoloEffettivoService, useValue: { accesso: jest.fn() } },
          { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (ctx: ExecutionContext) => {
            const req = ctx.switchToHttp().getRequest()
            const senza = !!req.headers['x-senza-azienda']
            req.user = {
              id: 'utente-1',
              tenantId: senza ? undefined : 'altro-tenant-del-token',
              role: ruolo,
            }
            if (!senza) req.tenantId = TENANT
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
    const R = 'addebiti'

    it('GET: pagina e dimensione di default, azienda selezionata', async () => {
      const r = await http().get(`/${R}`)
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ elementi: [], totale: 0 })
      expect(servizio.list).toHaveBeenCalledWith(TENANT, {
        testo: undefined,
        tipo: undefined,
        soloAttivi: false,
        pagina: 1,
        dimensione: 25,
      })
    })

    it('GET con filtri: testo, tipo, soloAttivi, pagina, dimensione', async () => {
      await http().get(`/${R}?testo=trasp&tipo=V&soloAttivi=true&pagina=3&dimensione=10`)
      expect(servizio.list).toHaveBeenCalledWith(TENANT, {
        testo: 'trasp',
        tipo: 'V',
        soloAttivi: true,
        pagina: 3,
        dimensione: 10,
      })
    })

    it.each(['pagina=0', 'dimensione=101', 'dimensione=x', 'soloAttivi=forse', 'altro=1'])(
      'GET ?%s: 400',
      async q => {
        expect((await http().get(`/${R}?${q}`)).status).toBe(400)
        expect(servizio.list).not.toHaveBeenCalled()
      }
    )

    it('GET prossimo-codice e’ dichiarata prima di :id e risponde { codice }', async () => {
      const r = await http().get(`/${R}/prossimo-codice`)
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ codice: '00001' })
      expect(servizio.prossimoCodice).toHaveBeenCalledWith(TENANT)
      expect(servizio.getById).not.toHaveBeenCalled()
    })

    it('GET :id con id non UUID: 400', async () => {
      expect((await http().get(`/${R}/abc`)).status).toBe(400)
      expect(servizio.getById).not.toHaveBeenCalled()
    })

    it('GET :id', async () => {
      await http().get(`/${R}/${ID}`)
      expect(servizio.getById).toHaveBeenCalledWith(TENANT, ID)
    })

    it('POST senza codice né attivo: ammesso (R24), utente da req.user.id', async () => {
      const r = await http().post(`/${R}`).send(corpoValido)
      expect(r.status).toBe(201)
      expect(servizio.crea).toHaveBeenCalledWith(TENANT, 'utente-1', corpoValido)
    })

    it('POST completo con sei listini: prezzi come stringhe, null ammessi', async () => {
      const corpo = {
        ...corpoValido,
        codice: '12',
        tipo: 'V',
        tipoProvvigione: 'LORDO',
        codiceIvaId: null,
        notaUsoInterno: null,
        listini: [{ numero: 1, prezzo: '10.50', sconto: '10+5', provvigione: null }],
        attivo: true,
      }
      const r = await http().post(`/${R}`).send(corpo)
      expect(r.status).toBe(201)
      expect(servizio.crea).toHaveBeenCalledWith(TENANT, 'utente-1', corpo)
    })

    it.each([
      ['descrizione mancante', { ...corpoValido, descrizione: undefined }],
      ['gruppoId mancante', { ...corpoValido, gruppoId: undefined }],
      ['unitaMisura mancante', { ...corpoValido, unitaMisura: undefined }],
      ['codice numerico', { ...corpoValido, codice: 12 }],
      [
        'prezzo numerico (mai IsNumber)',
        { ...corpoValido, listini: [{ numero: 1, prezzo: 10.5 }] },
      ],
      ['sconto numerico', { ...corpoValido, listini: [{ numero: 1, sconto: 10 }] }],
      ['numero listino non intero', { ...corpoValido, listini: [{ numero: 'a' }] }],
      ['listini non array', { ...corpoValido, listini: 'x' }],
      ['campo extra nel listino', { ...corpoValido, listini: [{ numero: 1, altro: 1 }] }],
      ['campo extra', { ...corpoValido, tenantId: 'x' }],
      ['attivo non booleano', { ...corpoValido, attivo: 'si' }],
    ])('POST %s: 400 senza chiamare il servizio', async (_nome, corpo) => {
      const r = await http().post(`/${R}`).send(corpo)
      expect(r.status).toBe(400)
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('PATCH: corpo parziale con versione; null azzera i facoltativi', async () => {
      const corpo = { categoriaId: null, appunti: null, descrizione: 'Nuova', versione: 2 }
      const r = await http().patch(`/${R}/${ID}`).send(corpo)
      expect(r.status).toBe(200)
      expect(servizio.modifica).toHaveBeenCalledWith(TENANT, 'utente-1', ID, corpo)
    })

    it("PATCH con codice '' arriva al servizio (che risponde 400)", async () => {
      const r = await http().patch(`/${R}/${ID}`).send({ codice: '', versione: 1 })
      expect(r.status).toBe(200)
    })

    it.each([
      ['descrizione null', { descrizione: null }],
      ['gruppoId null', { gruppoId: null }],
      ['codice null', { codice: null }],
      ['attivo null', { attivo: null }],
      ['listini null', { listini: null }],
    ])('PATCH %s: 400 (null non azzera in silenzio)', async (_nome, corpo) => {
      const r = await http()
        .patch(`/${R}/${ID}`)
        .send({ ...corpo, versione: 1 })
      expect(r.status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('PATCH senza versione o con versione 0: 400', async () => {
      expect((await http().patch(`/${R}/${ID}`).send({ descrizione: 'x' })).status).toBe(400)
      expect((await http().patch(`/${R}/${ID}`).send({ versione: 0 })).status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('DELETE: 204 con ?versione', async () => {
      const r = await http().delete(`/${R}/${ID}?versione=3`)
      expect(r.status).toBe(204)
      expect(servizio.elimina).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 3)
    })

    it('DELETE senza versione o non numerica: 400', async () => {
      expect((await http().delete(`/${R}/${ID}`)).status).toBe(400)
      expect((await http().delete(`/${R}/${ID}?versione=x`)).status).toBe(400)
      expect(servizio.elimina).not.toHaveBeenCalled()
    })

    it('un VIEWER legge ma non scrive (403)', async () => {
      ruolo = 'VIEWER'
      expect((await http().get(`/${R}`)).status).toBe(200)
      expect((await http().post(`/${R}`).send(corpoValido)).status).toBe(403)
      expect((await http().patch(`/${R}/${ID}`).send({ versione: 1 })).status).toBe(403)
      expect((await http().delete(`/${R}/${ID}?versione=1`)).status).toBe(403)
      expect(servizio.crea).not.toHaveBeenCalled()
      expect(servizio.modifica).not.toHaveBeenCalled()
      expect(servizio.elimina).not.toHaveBeenCalled()
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      expect((await http().get(`/${R}`).set('x-senza-azienda', '1')).status).toBe(403)
      expect(
        (await http().post(`/${R}`).set('x-senza-azienda', '1').send(corpoValido)).status
      ).toBe(403)
      expect(servizio.list).not.toHaveBeenCalled()
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    describe('variazioni-prezzi', () => {
      const IMPRONTA = 'a'.repeat(64)
      const filtri = {
        addebitiIds: [ID],
        categorieIds: [GRUPPO, ID],
        tipi: ['V', 'F'],
        listini: [1, 6],
      }
      const corpoVar = { tipo: 'AUMENTO_PERCENTUALE', valore: '10', filtri }

      it('anteprima: 200, azienda selezionata, corpo del frontend passato al servizio', async () => {
        ruolo = 'ADMIN'
        const r = await http().post(`/${R}/variazioni-prezzi/anteprima`).send(corpoVar)
        expect(r.status).toBe(200)
        expect(variazioni.anteprima).toHaveBeenCalledWith(TENANT, corpoVar)
      })

      it('applica: 200 { aggiornati } con impronta, utente dalla sessione', async () => {
        ruolo = 'SUPER_ADMIN'
        const r = await http()
          .post(`/${R}/variazioni-prezzi`)
          .send({ ...corpoVar, impronta: IMPRONTA })
        expect(r.status).toBe(200)
        expect(r.body).toEqual({ aggiornati: 3 })
        expect(variazioni.applica).toHaveBeenCalledWith(
          TENANT,
          'utente-1',
          expect.objectContaining({ impronta: IMPRONTA, valore: '10' })
        )
      })

      it('sostituzione IVA e filtri vuoti: ammessi', async () => {
        ruolo = 'ADMIN'
        const r = await http()
          .post(`/${R}/variazioni-prezzi/anteprima`)
          .send({ tipo: 'SOSTITUZIONE_IVA', daCodiceIvaId: ID, aCodiceIvaId: GRUPPO, filtri: {} })
        expect(r.status).toBe(200)
      })

      it.each(['OPERATOR', 'VIEWER'])('%s: 403 su entrambe', async r => {
        ruolo = r
        expect((await http().post(`/${R}/variazioni-prezzi/anteprima`).send(corpoVar)).status).toBe(
          403
        )
        expect(
          (
            await http()
              .post(`/${R}/variazioni-prezzi`)
              .send({ ...corpoVar, impronta: IMPRONTA })
          ).status
        ).toBe(403)
        expect(variazioni.anteprima).not.toHaveBeenCalled()
        expect(variazioni.applica).not.toHaveBeenCalled()
      })

      it.each([
        ['valore numerico (R12)', { ...corpoVar, valore: 10 }],
        ['campo sconosciuto', { ...corpoVar, extra: 1 }],
        ['filtro sconosciuto', { ...corpoVar, filtri: { ...filtri, cliente: 'x' } }],
        ['tipo fuori elenco', { ...corpoVar, tipo: 'BOH' }],
        ['id non UUID', { ...corpoVar, filtri: { addebitiIds: ['1'] } }],
        ['listino 7', { ...corpoVar, filtri: { listini: [7] } }],
        ['filtri mancanti', { tipo: 'AUMENTO_PERCENTUALE', valore: '10' }],
      ])('anteprima: 400 con %s', async (_n, corpo) => {
        ruolo = 'ADMIN'
        expect((await http().post(`/${R}/variazioni-prezzi/anteprima`).send(corpo)).status).toBe(
          400
        )
        expect(variazioni.anteprima).not.toHaveBeenCalled()
      })

      it.each([
        ['assente', undefined],
        ['corta', 'abc'],
      ])('applica: 400 con impronta %s', async (_n, impronta) => {
        ruolo = 'ADMIN'
        const r = await http()
          .post(`/${R}/variazioni-prezzi`)
          .send({ ...corpoVar, impronta })
        expect(r.status).toBe(400)
        expect(variazioni.applica).not.toHaveBeenCalled()
      })

      it('senza azienda selezionata: nessuna chiamata al servizio', async () => {
        ruolo = 'ADMIN'
        const r = await http()
          .post(`/${R}/variazioni-prezzi/anteprima`)
          .set('x-senza-azienda', '1')
          .send(corpoVar)
        expect(r.status).toBeGreaterThanOrEqual(400)
        expect(variazioni.anteprima).not.toHaveBeenCalled()
      })

      it('"variazioni-prezzi" non è letto come un id (GET → 400 per UUID, non 404 del servizio)', async () => {
        const r = await http().get(`/${R}/variazioni-prezzi`)
        expect(r.status).toBe(400)
      })
    })
  })
})
