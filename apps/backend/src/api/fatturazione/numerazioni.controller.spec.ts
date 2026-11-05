/**
 * NumerazioniController con pipe, guard dei ruoli e filtro reali e servizio finto: validazione dei
 * DTO, azienda selezionata, ruoli, forma del 409.
 */
import {
  ConflictException,
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER, Reflector } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import { NumerazioniService } from '../../application/fatturazione/numerazioni.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { NumerazioniController } from './numerazioni.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000002'
const REGISTRO = '6b6b6b6b-0000-4000-8000-000000000003'

describe('NumerazioniController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = NumerazioniController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it('GET a tutti i ruoli, PUT solo ADMIN e SUPER_ADMIN; ogni rotta ha @Roles', () => {
      expect(ruoli('elenco')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
      expect(ruoli('impostaPartenza')).toEqual(['SUPER_ADMIN', 'ADMIN'])
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual(['elenco', 'impostaPartenza'])
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let ruolo = 'ADMIN'

    beforeEach(async () => {
      ruolo = 'ADMIN'
      servizio = {
        elenco: jest.fn().mockResolvedValue([]),
        impostaPartenza: jest.fn().mockResolvedValue({ versione: 1 }),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [NumerazioniController],
        providers: [
          { provide: NumerazioniService, useValue: servizio },
          { provide: RuoloEffettivoService, useValue: { accesso: jest.fn() } },
          { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (ctx: ExecutionContext) => {
            const req = ctx.switchToHttp().getRequest()
            const senza = !!req.headers['x-senza-azienda']
            req.user = { id: 'utente-1', tenantId: senza ? undefined : 'altro-tenant', role: ruolo }
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
    const R = '/numerazioni-fattura'
    const base = { numeroPartenza: 120, dataPartenza: '2026-02-28', versione: 0 }

    it('GET: azienda selezionata e anno dalla query; senza anno usa quello corrente', async () => {
      expect((await http().get(`${R}?anno=2026`)).status).toBe(200)
      expect(servizio.elenco).toHaveBeenCalledWith(TENANT, 2026)
      servizio.elenco.mockClear()
      expect((await http().get(R)).status).toBe(200)
      expect(servizio.elenco).toHaveBeenCalledWith(TENANT, expect.any(Number))
    })

    it('GET senza azienda selezionata: rifiutato', async () => {
      const r = await http().get(R).set('x-senza-azienda', '1')
      expect(r.status).toBeGreaterThanOrEqual(400)
      expect(servizio.elenco).not.toHaveBeenCalled()
    })

    it.each(['anno=abc', 'anno=1999', 'anno=2101', 'anno=2026.5', 'altro=1'])(
      'GET con query non valida %s: 400',
      async q => {
        expect((await http().get(`${R}?${q}`)).status).toBe(400)
        expect(servizio.elenco).not.toHaveBeenCalled()
      }
    )

    it.each(['VIEWER', 'OPERATOR'])('PUT come %s: 403, GET: 200', async r => {
      ruolo = r
      expect((await http().put(`${R}/${REGISTRO}/2026`).send(base)).status).toBe(403)
      expect(servizio.impostaPartenza).not.toHaveBeenCalled()
      expect((await http().get(R)).status).toBe(200)
    })

    it.each(['ADMIN', 'SUPER_ADMIN'])(
      'PUT come %s: passa azienda, utente, registro, anno e corpo',
      async r => {
        ruolo = r
        const put = await http().put(`${R}/${REGISTRO}/2026`).send(base)
        expect(put.status).toBe(200)
        expect(servizio.impostaPartenza).toHaveBeenCalledWith(
          TENANT,
          'utente-1',
          REGISTRO,
          2026,
          base
        )
      }
    )

    it('PUT con dataPartenza null: 200 e null inoltrato', async () => {
      const corpo = { numeroPartenza: 0, dataPartenza: null, versione: 2 }
      expect((await http().put(`${R}/${REGISTRO}/2026`).send(corpo)).status).toBe(200)
      expect(servizio.impostaPartenza).toHaveBeenCalledWith(
        TENANT,
        'utente-1',
        REGISTRO,
        2026,
        corpo
      )
    })

    it.each([
      [{ ...base, numeroPartenza: -1 }],
      [{ ...base, numeroPartenza: 1.5 }],
      [{ ...base, numeroPartenza: '12' }],
      [{ ...base, numeroPartenza: 100_000_000 }],
      [{ ...base, dataPartenza: '28/02/2026' }],
      [{ ...base, versione: -1 }],
      [{ numeroPartenza: 1, dataPartenza: null }],
      [{ ...base, altro: 1 }],
    ])('PUT con corpo non valido %j: 400', async corpo => {
      expect((await http().put(`${R}/${REGISTRO}/2026`).send(corpo)).status).toBe(400)
      expect(servizio.impostaPartenza).not.toHaveBeenCalled()
    })

    it.each([`${R}/non-uuid/2026`, `${R}/${REGISTRO}/abc`, `${R}/${REGISTRO}/1800`])(
      'PUT con parametri non validi %s: 400',
      async url => {
        expect((await http().put(url).send(base)).status).toBe(400)
        expect(servizio.impostaPartenza).not.toHaveBeenCalled()
      }
    )

    it('409 PARTENZA_NON_MODIFICABILE passa al client', async () => {
      servizio.impostaPartenza.mockRejectedValue(
        new ConflictException({ error: 'PARTENZA_NON_MODIFICABILE', message: 'No.' })
      )
      const put = await http().put(`${R}/${REGISTRO}/2026`).send(base)
      expect(put.status).toBe(409)
      expect(put.body.error).toBe('PARTENZA_NON_MODIFICABILE')
    })
  })
})
