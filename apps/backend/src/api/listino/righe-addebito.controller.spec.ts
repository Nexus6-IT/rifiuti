/**
 * RigheAddebitoController con pipe, guard dei ruoli e filtro reali e servizio finto: validazione dei
 * DTO, UUID, azienda selezionata, ruoli (metadata e comportamento), utente, formato del 400 (R36) e
 * ordine delle rotte (`codifiche-rentri` prima di `:id`, R42).
 */
import {
  BadRequestException,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { RigheAddebitoController } from './righe-addebito.controller'
import { RigheAddebitoService } from '../../application/listino/righe-addebito.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const ID = '7e7e7e7e-0000-4000-8000-000000000004'

async function creaApp(servizio: Record<string, jest.Mock>, ruolo: () => string) {
  const logger: any = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  const moduleRef = await Test.createTestingModule({
    controllers: [RigheAddebitoController],
    providers: [
      { provide: RigheAddebitoService, useValue: servizio },
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

describe('RigheAddebitoController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = RigheAddebitoController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it.each(['getById', 'codificheRentri'])('%s: lettura a tutti i ruoli', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
    })

    it.each(['modifica', 'elimina'])('%s: scrittura senza VIEWER', nome => {
      expect(ruoli(nome)).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR'])
    })

    it('ogni rotta pubblica ha @Roles esplicito', () => {
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual(['codificheRentri', 'elimina', 'getById', 'modifica'])
      for (const n of metodi) expect(ruoli(n)?.length).toBeGreaterThan(0)
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let ruolo = 'OPERATOR'
    const R = 'righe-addebito'

    beforeEach(async () => {
      ruolo = 'OPERATOR'
      servizio = {
        getById: jest.fn().mockResolvedValue({ id: ID }),
        modifica: jest.fn().mockResolvedValue({ id: ID }),
        elimina: jest.fn().mockResolvedValue(undefined),
        codificheRentri: jest.fn().mockResolvedValue([{ codice: '1', descrizione: 'Solido' }]),
      }
      app = await creaApp(servizio, () => ruolo)
    })

    afterEach(async () => {
      await app.close()
    })

    const http = () => request(app.getHttpServer())

    it('GET :id: azienda selezionata', async () => {
      expect((await http().get(`/${R}/${ID}`)).status).toBe(200)
      expect(servizio.getById).toHaveBeenCalledWith(TENANT, ID)
    })

    it('GET codifiche-rentri e` prima di :id: non e` scambiata per un UUID (R42)', async () => {
      const r = await http().get(`/${R}/codifiche-rentri?tabella=stati-fisici`)
      expect(r.status).toBe(200)
      expect(r.body).toEqual([{ codice: '1', descrizione: 'Solido' }])
      expect(servizio.codificheRentri).toHaveBeenCalledWith('stati-fisici')
      await http().get(`/${R}/codifiche-rentri?tabella=attivita-rs`)
      expect(servizio.codificheRentri).toHaveBeenLastCalledWith('attivita-rs')
      expect(servizio.getById).not.toHaveBeenCalled()
    })

    it.each(['', '?tabella=', '?tabella=unita-misura', '?tabella=x'])(
      'GET codifiche-rentri%s: 400',
      async q => {
        expect((await http().get(`/${R}/codifiche-rentri${q}`)).status).toBe(400)
        expect(servizio.codificheRentri).not.toHaveBeenCalled()
      }
    )

    it('PATCH: corpo parziale con versione; null ammesso sui facoltativi; scaglioni opzionali', async () => {
      const corpo = { prezzo: 2, sconto: null, statoFisico: null, versione: 2 }
      expect((await http().patch(`/${R}/${ID}`).send(corpo)).status).toBe(200)
      expect(servizio.modifica).toHaveBeenLastCalledWith(TENANT, 'utente-1', ID, corpo)
      const dto = servizio.modifica.mock.calls[0][3]
      expect(dto).not.toHaveProperty('scaglioni')
      expect(dto).not.toHaveProperty('scadenze')
    })

    it.each([
      ['prezzoSpeciale testo', { prezzoSpeciale: 'true' }],
      ['codiceIvaId null', { codiceIvaId: null }],
      ['codiceIvaId non UUID', { codiceIvaId: 'x' }],
      ['scadenze oltre 12', { scadenze: Array.from({ length: 13 }, () => ({})) }],
      ['condizione testo', { condizione: 'a' }],
      ['campo extra', { elencoId: ID }],
    ])('PATCH %s: 400', async (_nome, corpo) => {
      const r = await http()
        .patch(`/${R}/${ID}`)
        .send({ ...corpo, versione: 1 })
      expect(r.status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('PATCH senza versione o con versione 0: 400', async () => {
      expect((await http().patch(`/${R}/${ID}`).send({ prezzo: '1' })).status).toBe(400)
      expect((await http().patch(`/${R}/${ID}`).send({ versione: 0 })).status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    // Il filtro globale inoltra solo `error`, `message` e `details`: `errori` top-level non arriva.
    it('un 400 del servizio arriva col codice R36 e gli `errori` per campo in `details`', async () => {
      servizio.modifica.mockRejectedValue(
        new BadRequestException({
          error: 'RIGA_ADDEBITO_NON_VALIDA',
          message: ['Indica il prezzo, anche zero.'],
          errori: [{ campo: 'prezzo', messaggio: 'Indica il prezzo, anche zero.' }],
          details: { errori: [{ campo: 'prezzo', messaggio: 'Indica il prezzo, anche zero.' }] },
        })
      )
      const r = await http().patch(`/${R}/${ID}`).send({ prezzo: null, versione: 1 })
      expect(r.status).toBe(400)
      expect(r.body).toMatchObject({
        error: 'RIGA_ADDEBITO_NON_VALIDA',
        message: ['Indica il prezzo, anche zero.'],
        details: { errori: [{ campo: 'prezzo', messaggio: 'Indica il prezzo, anche zero.' }] },
      })
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
      expect((await http().get(`/${R}/codifiche-rentri?tabella=attivita-rs`)).status).toBe(200)
      expect((await http().patch(`/${R}/${ID}`).send({ versione: 1, prezzo: '1' })).status).toBe(
        403
      )
      expect((await http().delete(`/${R}/${ID}?versione=1`)).status).toBe(403)
      expect(servizio.modifica).not.toHaveBeenCalled()
      expect(servizio.elimina).not.toHaveBeenCalled()
    })

    it('senza azienda determinabile: 403 e nessun servizio', async () => {
      expect((await http().get(`/${R}/${ID}`).set('x-senza-azienda', '1')).status).toBe(403)
      expect(
        (
          await http()
            .get(`/${R}/codifiche-rentri?tabella=stati-fisici`)
            .set('x-senza-azienda', '1')
        ).status
      ).toBe(403)
      expect(servizio.getById).not.toHaveBeenCalled()
      expect(servizio.codificheRentri).not.toHaveBeenCalled()
    })

    it('id non UUID: 400 (get, patch, delete)', async () => {
      expect((await http().get(`/${R}/non-un-uuid`)).status).toBe(400)
      expect((await http().patch(`/${R}/xx`).send({ versione: 1 })).status).toBe(400)
      expect((await http().delete(`/${R}/xx?versione=1`)).status).toBe(400)
      expect(servizio.getById).not.toHaveBeenCalled()
    })
  })
})
