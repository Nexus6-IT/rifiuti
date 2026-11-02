/**
 * ElenchiContrattoController con pipe, guard dei ruoli e filtro reali e servizio finto: validazione dei DTO, UUID,
 * azienda selezionata, ruoli (metadata e comportamento), utente.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { ElenchiContrattoController } from './elenchi-contratto.controller'
import { ElenchiAddebitiService } from '../../application/listino/elenchi-addebiti.service'
import { AzioniListinoService } from '../../application/listino/azioni-listino.service'
import { RigheAddebitoService } from '../../application/listino/righe-addebito.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'

async function creaApp(
  servizio: Record<string, jest.Mock>,
  ruolo: () => string,
  righe: Record<string, jest.Mock> = {},
  azioni: Record<string, jest.Mock> = {}
) {
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const moduleRef = await Test.createTestingModule({
    controllers: [ElenchiContrattoController],
    providers: [
      { provide: ElenchiAddebitiService, useValue: servizio },
      { provide: RigheAddebitoService, useValue: righe },
      { provide: AzioniListinoService, useValue: azioni },
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
          role: ruolo(),
        }
        if (!senza) req.tenantId = TENANT
        return true
      },
    })
    .compile()
  const app = moduleRef.createNestApplication()
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
  )
  await app.init()
  return app
}

const corpoValido = { descrizione: 'Listino 2026' }

describe('ElenchiContrattoController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = ElenchiContrattoController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it.each(['list', 'prossimoCodice', 'proposta'])('%s: lettura a tutti i ruoli', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    })

    it.each(['provvigioni', 'sconti'])('%s: scrittura senza VIEWER', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])
    })

    it('crea: scrittura senza VIEWER', () => {
      expect(ruoli('crea')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])
    })

    it('ogni rotta pubblica ha @Roles esplicito', () => {
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual([
        'crea',
        'list',
        'proposta',
        'prossimoCodice',
        'provvigioni',
        'sconti',
      ])
      for (const n of metodi) expect(ruoli(n)?.length).toBeGreaterThan(0)
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let righe: Record<string, jest.Mock>
    let azioni: Record<string, jest.Mock>
    let ruolo = 'OPERATOR'
    const R = `contratti-clienti/${ID}/elenchi`

    beforeEach(async () => {
      ruolo = 'OPERATOR'
      servizio = {
        list: jest.fn().mockResolvedValue({ contesto: {}, elenchi: [] }),
        prossimoCodice: jest.fn().mockResolvedValue('002'),
        crea: jest.fn().mockResolvedValue({ id: ID }),
      }
      righe = { proposta: jest.fn().mockResolvedValue({ prezzo: '1.00' }) }
      azioni = {
        sostituisciDa: jest.fn().mockResolvedValue({ copiate: 1 }),
        aggiungiRighe: jest.fn().mockResolvedValue({ copiate: 1 }),
        impostaProvvigioni: jest.fn().mockResolvedValue({ aggiornate: 1 }),
        sostituisciSconto: jest.fn().mockResolvedValue({ aggiornate: 1 }),
      }
      app = await creaApp(servizio, () => ruolo, righe, azioni)
    })

    afterEach(async () => {
      await app.close()
    })

    const http = () => request(app.getHttpServer())

    it('GET: azienda selezionata (non quella del token), con e senza validiAl', async () => {
      expect((await http().get(`/${R}`)).status).toBe(200)
      expect(servizio.list).toHaveBeenLastCalledWith(TENANT, ID, undefined)
      await http().get(`/${R}?validiAl=2026-06-01`)
      expect(servizio.list).toHaveBeenLastCalledWith(TENANT, ID, '2026-06-01')
    })

    it('GET prossimo-codice: non e letto come altro, risponde { codice }', async () => {
      const r = await http().get(`/${R}/prossimo-codice`)
      expect(r.status).toBe(200)
      expect(r.body).toEqual({ codice: '002' })
      expect(servizio.prossimoCodice).toHaveBeenCalledWith(TENANT, ID)
    })

    it('POST senza codice: 201, il corpo passa invariato; utente dal token', async () => {
      const r = await http().post(`/${R}`).send(corpoValido)
      expect(r.status).toBe(201)
      expect(servizio.crea).toHaveBeenCalledWith(TENANT, 'utente-1', ID, corpoValido)
    })

    it('POST: predefinito arriva come booleano vero anche se inviato come stringa', async () => {
      await http()
        .post(`/${R}`)
        .send({ ...corpoValido, predefinito: 'true' })
      expect(servizio.crea.mock.calls[0][3].predefinito).toBe(true)
      await http()
        .post(`/${R}`)
        .send({ ...corpoValido, predefinito: 'false' })
      expect(servizio.crea.mock.calls[1][3].predefinito).toBe(false)
      await http()
        .post(`/${R}`)
        .send({ ...corpoValido, predefinito: true })
      expect(servizio.crea.mock.calls[2][3].predefinito).toBe(true)
    })

    it('POST con tutti i campi facoltativi, anche null', async () => {
      const corpo = {
        codice: '002',
        descrizione: 'Listino',
        nota1: 'a',
        nota2: null,
        validoDal: '2026-01-01',
        validoAl: '2026-12-31',
        predefinito: false,
        codiceCig: 'ABCDE12345',
        codiceCup: null,
        idDocumentoPa: 'DOC1',
        dataDocumentoPa: '2026-01-01',
      }
      expect((await http().post(`/${R}`).send(corpo)).status).toBe(201)
      expect(servizio.crea.mock.calls[0][3]).toEqual(corpo)
    })

    it.each([
      ['descrizione mancante', {}],
      ['descrizione numerica', { descrizione: 5 }],
      ['codice numerico', { descrizione: 'x', codice: 1 }],
      ['predefinito non booleano', { descrizione: 'x', predefinito: 'si' }],
      ['predefinito null', { descrizione: 'x', predefinito: null }],
      ['campo extra', { descrizione: 'x', tenantId: 'x' }],
    ])('POST %s: 400 senza chiamare il servizio', async (_nome, corpo) => {
      expect((await http().post(`/${R}`).send(corpo)).status).toBe(400)
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('un VIEWER legge ma non scrive (403)', async () => {
      ruolo = 'VIEWER'
      expect((await http().get(`/${R}`)).status).toBe(200)
      expect((await http().get(`/${R}/prossimo-codice`)).status).toBe(200)
      expect((await http().post(`/${R}`).send(corpoValido)).status).toBe(403)
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      expect((await http().get(`/${R}`).set('x-senza-azienda', '1')).status).toBe(403)
      expect(
        (await http().post(`/${R}`).set('x-senza-azienda', '1').send(corpoValido)).status
      ).toBe(403)
      expect(servizio.list).not.toHaveBeenCalled()
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('id contratto non UUID: 400', async () => {
      expect((await http().get('/contratti-clienti/xx/elenchi')).status).toBe(400)
      expect((await http().post('/contratti-clienti/xx/elenchi').send(corpoValido)).status).toBe(
        400
      )
      expect(servizio.list).not.toHaveBeenCalled()
    })

    describe('righe-proposta (Task 21)', () => {
      it('GET :id/righe-proposta: addebitoId o cerCode passano al servizio; VIEWER ammesso', async () => {
        ruolo = 'VIEWER'
        const r = await http().get(`/contratti-clienti/${ID}/righe-proposta?addebitoId=${ID}`)
        expect(r.status).toBe(200)
        expect(righe.proposta).toHaveBeenLastCalledWith(TENANT, ID, {
          addebitoId: ID,
          cerCode: undefined,
        })
        await http().get(`/contratti-clienti/${ID}/righe-proposta?cerCode=20%2003%2001`)
        expect(righe.proposta).toHaveBeenLastCalledWith(TENANT, ID, {
          addebitoId: undefined,
          cerCode: '20 03 01',
        })
      })

      it('id non UUID 400; senza azienda 403', async () => {
        expect((await http().get('/contratti-clienti/xx/righe-proposta')).status).toBe(400)
        expect(
          (await http().get(`/contratti-clienti/${ID}/righe-proposta`).set('x-senza-azienda', '1'))
            .status
        ).toBe(403)
        expect(righe.proposta).not.toHaveBeenCalled()
      })
    })
    describe('provvigioni e sconti su tutto il contratto (Task 23)', () => {
      const C = `/contratti-clienti/${ID}`

      it('POST provvigioni: 200; null e vuoto passano al servizio (svuotano)', async () => {
        const r = await http()
          .post(`${C}/provvigioni`)
          .send({ provvigione: '5+2', tipoProvvigione: 'LORDO' })
        expect(r.status).toBe(200)
        expect(azioni.impostaProvvigioni).toHaveBeenLastCalledWith(TENANT, 'utente-1', ID, {
          provvigione: '5+2',
          tipoProvvigione: 'LORDO',
        })
        await http().post(`${C}/provvigioni`).send({ provvigione: null, tipoProvvigione: null })
        expect(azioni.impostaProvvigioni.mock.calls[1][3]).toEqual({
          provvigione: null,
          tipoProvvigione: null,
        })
        await http().post(`${C}/provvigioni`).send({ provvigione: 5, tipoProvvigione: 'LORDO' })
        expect(azioni.impostaProvvigioni.mock.calls[2][3].provvigione).toBe(5)
      })

      it('POST sconti: 200 e i valori arrivano al servizio', async () => {
        const r = await http()
          .post(`${C}/sconti`)
          .send({ scontoAttuale: '10 + 5', scontoNuovo: '' })
        expect(r.status).toBe(200)
        expect(azioni.sostituisciSconto).toHaveBeenCalledWith(TENANT, 'utente-1', ID, {
          scontoAttuale: '10 + 5',
          scontoNuovo: '',
        })
      })

      it.each([
        ['provvigioni', { provvigione: true }],
        ['provvigioni', { provvigione: [] }],
        ['provvigioni', { tipoProvvigione: 5 }],
        ['provvigioni', { provvigione: '5', extra: 1 }],
        ['sconti', {}],
        ['sconti', { scontoAttuale: null }],
        ['sconti', { scontoAttuale: '5', scontoNuovo: {} }],
      ])('POST %s con corpo non valido: 400 e nessun servizio', async (rotta, corpo) => {
        expect((await http().post(`${C}/${rotta}`).send(corpo)).status).toBe(400)
        expect(azioni.impostaProvvigioni).not.toHaveBeenCalled()
        expect(azioni.sostituisciSconto).not.toHaveBeenCalled()
      })

      it('un VIEWER non scrive (403); senza azienda 403; id non UUID 400', async () => {
        ruolo = 'VIEWER'
        expect((await http().post(`${C}/provvigioni`).send({ provvigione: null })).status).toBe(403)
        expect((await http().post(`${C}/sconti`).send({ scontoAttuale: '5' })).status).toBe(403)
        ruolo = 'OPERATOR'
        expect(
          (
            await http()
              .post(`${C}/sconti`)
              .set('x-senza-azienda', '1')
              .send({ scontoAttuale: '5' })
          ).status
        ).toBe(403)
        expect((await http().post('/contratti-clienti/xx/provvigioni').send({})).status).toBe(400)
        expect(azioni.impostaProvvigioni).not.toHaveBeenCalled()
        expect(azioni.sostituisciSconto).not.toHaveBeenCalled()
      })
    })
  })
})
