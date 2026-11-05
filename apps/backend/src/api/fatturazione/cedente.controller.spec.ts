/**
 * CedenteController con pipe, guard dei ruoli e filtro reali e servizio finto: validazione del
 * DTO (compreso `null` sui campi facoltativi), azienda selezionata, ruoli, forma del 409.
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
import { CedenteService } from '../../application/fatturazione/cedente.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { CedenteController } from './cedente.controller'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000002'
const REGISTRO = '6b6b6b6b-0000-4000-8000-000000000003'

describe('CedenteController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = CedenteController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it('GET a tutti i ruoli, PUT solo ADMIN e SUPER_ADMIN; ogni rotta ha @Roles', () => {
      expect(ruoli('leggi')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
      expect(ruoli('imposta')).toEqual(['SUPER_ADMIN', 'ADMIN'])
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual(['imposta', 'leggi'])
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let ruolo = 'ADMIN'

    beforeEach(async () => {
      ruolo = 'ADMIN'
      servizio = {
        leggi: jest.fn().mockResolvedValue({ versione: 0 }),
        imposta: jest.fn().mockResolvedValue({ versione: 1 }),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [CedenteController],
        providers: [
          { provide: CedenteService, useValue: servizio },
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
    const R = '/cedente-fatturazione'
    const base = { regimeFiscale: 'RF01', versione: 0 }

    it('GET: azienda selezionata (non quella del token); senza azienda rifiutato', async () => {
      expect((await http().get(R)).status).toBe(200)
      expect(servizio.leggi).toHaveBeenCalledWith(TENANT)
      servizio.leggi.mockClear()
      const r = await http().get(R).set('x-senza-azienda', '1')
      expect(r.status).toBeGreaterThanOrEqual(400)
      expect(servizio.leggi).not.toHaveBeenCalled()
    })

    it.each(['VIEWER', 'OPERATOR'])('PUT come %s: 403, GET: 200', async r => {
      ruolo = r
      expect((await http().put(R).send(base)).status).toBe(403)
      expect(servizio.imposta).not.toHaveBeenCalled()
      expect((await http().get(R)).status).toBe(200)
    })

    it.each(['ADMIN', 'SUPER_ADMIN'])('PUT come %s: passa azienda, utente e corpo', async r => {
      ruolo = r
      const corpo = {
        ...base,
        reaUfficio: 'RM',
        capitaleSociale: '1000.50',
        socioUnico: 'SU',
        statoLiquidazione: 'LS',
        registroIvaPredefinitoId: REGISTRO,
        idTrasmittenteCodice: 'ABC1234',
      }
      const put = await http().put(R).send(corpo)
      expect(put.status).toBe(200)
      expect(servizio.imposta).toHaveBeenCalledWith(TENANT, 'utente-1', corpo)
    })

    it('PUT con null sui campi facoltativi: 200 e null inoltrato (cancella il campo)', async () => {
      const corpo = {
        regimeFiscale: 'RF19',
        reaUfficio: null,
        capitaleSociale: null,
        socioUnico: null,
        registroIvaPredefinitoId: null,
        idTrasmittenteCodice: null,
        versione: 3,
      }
      const put = await http().put(R).send(corpo)
      expect(put.status).toBe(200)
      expect(servizio.imposta).toHaveBeenCalledWith(TENANT, 'utente-1', corpo)
    })

    it.each([
      [{ ...base, regimeFiscale: 'RF03' }],
      [{ ...base, regimeFiscale: 'RF21' }],
      [{ ...base, regimeFiscale: 'XX' }],
      [{ versione: 0 }],
      [{ ...base, capitaleSociale: '1000,50' }],
      [{ ...base, capitaleSociale: 1000.5 }],
      [{ ...base, capitaleSociale: '1000.555' }],
      [{ ...base, capitaleSociale: '123456789012' }],
      [{ ...base, capitaleSociale: '123456789012.00' }],
      [{ ...base, socioUnico: 'XX' }],
      [{ ...base, statoLiquidazione: 'XX' }],
      [{ ...base, reaUfficio: 'roma' }],
      [{ ...base, registroIvaPredefinitoId: 'non-uuid' }],
      [{ ...base, idTrasmittenteCodice: 'x'.repeat(29) }],
      [{ regimeFiscale: 'RF01' }],
      [{ ...base, versione: -1 }],
      [{ ...base, altro: 1 }],
    ])('PUT con corpo non valido %j: 400', async corpo => {
      const put = await http().put(R).send(corpo)
      expect(put.status).toBe(400)
      expect(servizio.imposta).not.toHaveBeenCalled()
    })

    it('capitale sociale con 11 cifre intere: 200', async () => {
      const put = await http()
        .put(R)
        .send({ ...base, capitaleSociale: '12345678901.99' })
      expect(put.status).toBe(200)
    })

    it('409 VERSIONE_SUPERATA passa al client', async () => {
      servizio.imposta.mockRejectedValue(
        new ConflictException({ error: 'VERSIONE_SUPERATA', message: 'Ricarica.' })
      )
      const put = await http().put(R).send(base)
      expect(put.status).toBe(409)
      expect(put.body.error).toBe('VERSIONE_SUPERATA')
    })
  })
})
