/**
 * ElenchiAddebitiController con pipe, guard dei ruoli e filtro reali e servizio finto: validazione dei DTO, UUID,
 * azienda selezionata, ruoli (metadata e comportamento), utente.
 */
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { ElenchiAddebitiController } from './elenchi-addebiti.controller'
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
    controllers: [ElenchiAddebitiController],
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

describe('ElenchiAddebitiController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = ElenchiAddebitiController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it('getById: lettura a tutti i ruoli', () => {
      expect(ruoli('getById')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    })

    it.each(['modifica', 'elimina', 'creaRiga', 'sostituisciDa', 'aggiungiRighe'])(
      '%s: scrittura senza VIEWER',
      nome => {
        expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])
      }
    )

    it('listRighe: lettura a tutti i ruoli', () => {
      expect(ruoli('listRighe')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    })

    it('ogni rotta pubblica ha @Roles esplicito', () => {
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual([
        'aggiungiRighe',
        'creaRiga',
        'elimina',
        'getById',
        'listRighe',
        'modifica',
        'sostituisciDa',
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
    const R = 'elenchi-addebiti'

    beforeEach(async () => {
      ruolo = 'OPERATOR'
      servizio = {
        getById: jest.fn().mockResolvedValue({ id: ID }),
        modifica: jest.fn().mockResolvedValue({ id: ID }),
        elimina: jest.fn().mockResolvedValue(undefined),
      }
      righe = {
        list: jest.fn().mockResolvedValue([{ id: 'r1' }]),
        crea: jest.fn().mockResolvedValue({ id: 'r1' }),
      }
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

    it('GET :id: azienda selezionata', async () => {
      expect((await http().get(`/${R}/${ID}`)).status).toBe(200)
      expect(servizio.getById).toHaveBeenCalledWith(TENANT, ID)
    })

    it('PATCH: corpo parziale con versione; null ammesso sui facoltativi', async () => {
      expect(
        (await http().patch(`/${R}/${ID}`).send({ descrizione: 'Nuova', versione: 2 })).status
      ).toBe(200)
      expect(servizio.modifica).toHaveBeenLastCalledWith(TENANT, 'utente-1', ID, {
        descrizione: 'Nuova',
        versione: 2,
      })
      const corpo = { nota1: null, validoDal: null, validoAl: null, codiceCig: null, versione: 2 }
      await http().patch(`/${R}/${ID}`).send(corpo)
      expect(servizio.modifica.mock.calls[1][3]).toEqual(corpo)
    })

    it('PATCH: predefinito "true" diventa booleano vero', async () => {
      await http().patch(`/${R}/${ID}`).send({ predefinito: 'true', versione: 1 })
      expect(servizio.modifica.mock.calls[0][3].predefinito).toBe(true)
    })

    it.each([
      ['codice null', { codice: null }],
      ['descrizione null', { descrizione: null }],
      ['predefinito null', { predefinito: null }],
      ['predefinito non booleano', { predefinito: 1 }],
      ['campo extra', { contrattoId: ID }],
    ])('PATCH %s: 400', async (_nome, corpo) => {
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

    it('DELETE: 204 con ?versione; senza versione o non numerica 400', async () => {
      const r = await http().delete(`/${R}/${ID}?versione=3`)
      expect(r.status).toBe(204)
      expect(servizio.elimina).toHaveBeenCalledWith(TENANT, 'utente-1', ID, 3)
      expect((await http().delete(`/${R}/${ID}`)).status).toBe(400)
      expect((await http().delete(`/${R}/${ID}?versione=abc`)).status).toBe(400)
    })

    it('un VIEWER legge ma non scrive (403)', async () => {
      ruolo = 'VIEWER'
      expect((await http().get(`/${R}/${ID}`)).status).toBe(200)
      expect(
        (await http().patch(`/${R}/${ID}`).send({ versione: 1, descrizione: 'x' })).status
      ).toBe(403)
      expect((await http().delete(`/${R}/${ID}?versione=1`)).status).toBe(403)
      expect(servizio.modifica).not.toHaveBeenCalled()
      expect(servizio.elimina).not.toHaveBeenCalled()
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      expect((await http().get(`/${R}/${ID}`).set('x-senza-azienda', '1')).status).toBe(403)
      expect(servizio.getById).not.toHaveBeenCalled()
    })

    it('id non UUID: 400 (get, patch, delete)', async () => {
      expect((await http().get(`/${R}/non-un-uuid`)).status).toBe(400)
      expect((await http().patch(`/${R}/xx`).send({ versione: 1 })).status).toBe(400)
      expect((await http().delete(`/${R}/xx?versione=1`)).status).toBe(400)
      expect(servizio.getById).not.toHaveBeenCalled()
    })

    describe('righe dell’elenco (Task 21)', () => {
      it('GET :id/righe: azienda selezionata, un array; un VIEWER legge', async () => {
        ruolo = 'VIEWER'
        const r = await http().get(`/${R}/${ID}/righe`)
        expect(r.status).toBe(200)
        expect(r.body).toEqual([{ id: 'r1' }])
        expect(righe.list).toHaveBeenCalledWith(TENANT, ID)
      })

      it('POST :id/righe: 201 e il corpo arriva al servizio con utente e azienda', async () => {
        const corpo = {
          tipo: 'V',
          addebitoId: ID,
          codiceIvaId: ID,
          unitaMisura: 'KG',
          prezzo: '1.5',
          prezzoSpeciale: false,
          scaglioni: [{ ordine: 1, finoA: 100, prezzo: '2', tipoCalcolo: 'A' }],
          scadenze: [{ ordine: 1, giorno: 1, mese: 6, anno: null }],
          cerProposta: ['20 03 01'],
          riferimento: '',
        }
        const r = await http().post(`/${R}/${ID}/righe`).send(corpo)
        expect(r.status).toBe(201)
        expect(righe.crea).toHaveBeenCalledWith(
          TENANT,
          'utente-1',
          ID,
          expect.objectContaining(corpo)
        )
      })

      it('POST: un VIEWER non scrive (403); senza azienda 403; id non UUID 400', async () => {
        ruolo = 'VIEWER'
        expect((await http().post(`/${R}/${ID}/righe`).send({ tipo: 'V' })).status).toBe(403)
        ruolo = 'OPERATOR'
        expect(
          (await http().post(`/${R}/${ID}/righe`).set('x-senza-azienda', '1').send({})).status
        ).toBe(403)
        expect((await http().post(`/${R}/xx/righe`).send({})).status).toBe(400)
        expect((await http().get(`/${R}/xx/righe`)).status).toBe(400)
        expect(righe.crea).not.toHaveBeenCalled()
      })

      it.each([
        ['prezzoSpeciale come testo', { prezzoSpeciale: 'false' }],
        ['minimoPerCategoria numerico', { minimoPerCategoria: 1 }],
        ['addebitoId non UUID', { addebitoId: 'abc' }],
        ['categoriaId non UUID', { categoriaId: 'abc' }],
        ['cerProposta oltre 50', { cerProposta: Array.from({ length: 51 }, () => '20 03 01') }],
        ['scaglioni oltre 7', { scaglioni: Array.from({ length: 8 }, () => ({})) }],
        ['scaglione con campo extra', { scaglioni: [{ ordine: 1, x: 1 }] }],
        ['prezzo booleano', { prezzo: true }],
        ['campo extra', { elencoId: ID }],
      ])('POST %s: 400 dalla pipe, nessun servizio', async (_nome, extra) => {
        const r = await http()
          .post(`/${R}/${ID}/righe`)
          .send({ tipo: 'V', ...extra })
        expect(r.status).toBe(400)
        expect(righe.crea).not.toHaveBeenCalled()
      })

      it('POST: i booleani restano booleani veri (la pipe non converte le stringhe)', async () => {
        await http()
          .post(`/${R}/${ID}/righe`)
          .send({ tipo: 'V', prezzoSpeciale: true, minimoPerCategoria: false })
        const dto = righe.crea.mock.calls[0][3]
        expect(dto.prezzoSpeciale).toBe(true)
        expect(dto.minimoPerCategoria).toBe(false)
      })
    })
    describe('copia di righe (Task 23)', () => {
      const DA = '8f8f8f8f-0000-4000-8000-000000000005'

      it('POST :id/sostituisci-da: 200, il corpo arriva al servizio con utente e azienda', async () => {
        const r = await http()
          .post(`/${R}/${ID}/sostituisci-da`)
          .send({ daElencoId: DA, versione: 2 })
        expect(r.status).toBe(200)
        expect(azioni.sostituisciDa).toHaveBeenCalledWith(TENANT, 'utente-1', ID, {
          daElencoId: DA,
          versione: 2,
        })
      })

      it('POST :id/aggiungi-righe: 200 e gli id arrivano al servizio', async () => {
        const r = await http()
          .post(`/${R}/${ID}/aggiungi-righe`)
          .send({ righeIds: [DA, ID], versione: 1 })
        expect(r.status).toBe(200)
        expect(azioni.aggiungiRighe).toHaveBeenCalledWith(TENANT, 'utente-1', ID, {
          righeIds: [DA, ID],
          versione: 1,
        })
      })

      it.each([
        ['sostituisci-da', { daElencoId: 'non-uuid', versione: 1 }],
        ['sostituisci-da', { versione: 1 }],
        ['sostituisci-da', { daElencoId: DA }],
        ['sostituisci-da', { daElencoId: DA, versione: 0 }],
        ['sostituisci-da', { daElencoId: DA, versione: 1, altro: 1 }],
        ['aggiungi-righe', { righeIds: [], versione: 1 }],
        ['aggiungi-righe', { righeIds: ['xx'], versione: 1 }],
        ['aggiungi-righe', { righeIds: [DA] }],
        ['aggiungi-righe', { righeIds: Array(1001).fill(DA), versione: 1 }],
      ])('POST %s con corpo non valido: 400 e nessun servizio', async (rotta, corpo) => {
        expect((await http().post(`/${R}/${ID}/${rotta}`).send(corpo)).status).toBe(400)
        expect(azioni.sostituisciDa).not.toHaveBeenCalled()
        expect(azioni.aggiungiRighe).not.toHaveBeenCalled()
      })

      it('un VIEWER non copia (403); senza azienda 403; id non UUID 400', async () => {
        const corpo = { daElencoId: DA, versione: 1 }
        ruolo = 'VIEWER'
        expect((await http().post(`/${R}/${ID}/sostituisci-da`).send(corpo)).status).toBe(403)
        expect(
          (
            await http()
              .post(`/${R}/${ID}/aggiungi-righe`)
              .send({ righeIds: [DA], versione: 1 })
          ).status
        ).toBe(403)
        ruolo = 'OPERATOR'
        expect(
          (await http().post(`/${R}/${ID}/sostituisci-da`).set('x-senza-azienda', '1').send(corpo))
            .status
        ).toBe(403)
        expect((await http().post(`/${R}/xx/sostituisci-da`).send(corpo)).status).toBe(400)
        expect(azioni.sostituisciDa).not.toHaveBeenCalled()
        expect(azioni.aggiungiRighe).not.toHaveBeenCalled()
      })
    })
  })
})
