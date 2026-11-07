/**
 * ImpostazioniFatturazioneController con pipe, guard dei ruoli e filtro reali e servizio finto:
 * validazione del DTO, azienda selezionata, ruoli (metadata e comportamento), forma del 409.
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
import { ImpostazioniFatturazioneController } from './impostazioni-fatturazione.controller'
import { ImpostazioniFatturazioneService } from '../../application/legami-movimento/impostazioni-fatturazione.service'
import { ROLES_KEY } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'

describe('ImpostazioniFatturazioneController', () => {
  describe('metadata dei ruoli', () => {
    const reflector = new Reflector()
    const proto = ImpostazioniFatturazioneController.prototype as any
    const ruoli = (nome: string) => reflector.get<string[]>(ROLES_KEY, proto[nome])

    it('GET a tutti i ruoli, PUT solo ADMIN e SUPER_ADMIN', () => {
      expect(ruoli('leggi')).toEqual(['SUPER_ADMIN', 'ADMIN', 'OPERATOR', 'VIEWER'])
      expect(ruoli('imposta')).toEqual(['SUPER_ADMIN', 'ADMIN'])
      expect(ruoli('impostaDefinitive')).toEqual(['SUPER_ADMIN', 'ADMIN'])
    })

    it('ogni rotta pubblica ha @Roles esplicito', () => {
      const metodi = Object.getOwnPropertyNames(proto).filter(
        n => n !== 'constructor' && typeof proto[n] === 'function'
      )
      expect(metodi.sort()).toEqual(['imposta', 'impostaDefinitive', 'leggi'])
      for (const n of metodi) expect(ruoli(n)?.length).toBeGreaterThan(0)
    })
  })

  describe('HTTP', () => {
    let app: INestApplication
    let servizio: Record<string, jest.Mock>
    let ruolo = 'ADMIN'
    let ruoloEffettivo: jest.Mock

    beforeEach(async () => {
      ruolo = 'ADMIN'
      ruoloEffettivo = jest.fn().mockResolvedValue('ADMIN')
      servizio = {
        leggi: jest
          .fn()
          .mockResolvedValue({ fatturazioneDa: null, versione: 0, modificatoIl: null }),
        imposta: jest.fn().mockResolvedValue({ fatturazioneDa: '2026-01-01', versione: 1 }),
        impostaDefinitive: jest.fn().mockResolvedValue({ definitiveAttive: true, versione: 2 }),
      }
      const logger: any = {
        setContext: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }
      const moduleRef = await Test.createTestingModule({
        controllers: [ImpostazioniFatturazioneController],
        providers: [
          { provide: ImpostazioniFatturazioneService, useValue: servizio },
          { provide: RuoloEffettivoService, useValue: { accesso: jest.fn(), ruoloEffettivo } },
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
    const R = '/impostazioni-fatturazione'

    it('GET: azienda selezionata (non quella del token)', async () => {
      const r = await http().get(R)
      expect(r.status).toBe(200)
      expect(servizio.leggi).toHaveBeenCalledWith(TENANT)
    })

    it('GET senza azienda selezionata: rifiutato', async () => {
      const r = await http().get(R).set('x-senza-azienda', '1')
      expect(r.status).toBeGreaterThanOrEqual(400)
      expect(servizio.leggi).not.toHaveBeenCalled()
    })

    it.each(['VIEWER', 'OPERATOR'])('PUT come %s: 403, GET: 200', async r => {
      ruolo = r
      const put = await http().put(R).send({ fatturazioneDa: '2026-01-01', versione: 0 })
      expect(put.status).toBe(403)
      expect(servizio.imposta).not.toHaveBeenCalled()
      expect((await http().get(R)).status).toBe(200)
    })

    it.each(['ADMIN', 'SUPER_ADMIN'])('PUT come %s: passa azienda, utente e corpo', async r => {
      ruolo = r
      const corpo = { fatturazioneDa: '2026-01-01', versione: 0, confermaMovimenti: 3 }
      const put = await http().put(R).send(corpo)
      expect(put.status).toBe(200)
      expect(servizio.imposta).toHaveBeenCalledWith(TENANT, 'utente-1', corpo)
    })

    it('PUT con data null: ammesso (spegne)', async () => {
      const put = await http().put(R).send({ fatturazioneDa: null, versione: 2 })
      expect(put.status).toBe(200)
    })

    it.each([
      [{ versione: 1 }],
      [{ fatturazioneDa: 20260101, versione: 1 }],
      [{ fatturazioneDa: '2026-01-01' }],
      [{ fatturazioneDa: '2026-01-01', versione: -1 }],
      [{ fatturazioneDa: '2026-01-01', versione: 1.5 }],
      [{ fatturazioneDa: '2026-01-01', versione: 1, confermaMovimenti: 'tre' }],
      [{ fatturazioneDa: '2026-01-01', versione: 1, altro: 1 }],
    ])('PUT con corpo non valido %j: 400', async corpo => {
      const put = await http().put(R).send(corpo)
      expect(put.status).toBe(400)
      expect(servizio.imposta).not.toHaveBeenCalled()
    })

    it('409 CONFERMA_RICHIESTA: movimentiToccati dentro details, mai al primo livello', async () => {
      servizio.imposta.mockRejectedValue(
        new ConflictException({
          error: 'CONFERMA_RICHIESTA',
          message: 'Conferma.',
          details: { movimentiToccati: 3 },
        })
      )
      const put = await http().put(R).send({ fatturazioneDa: '2026-01-01', versione: 1 })
      expect(put.status).toBe(409)
      expect(put.body.error).toBe('CONFERMA_RICHIESTA')
      expect(put.body.details).toEqual({ movimentiToccati: 3 })
      expect(put.body.movimentiToccati).toBeUndefined()
    })

    describe('PUT /definitive', () => {
      const D = `${R}/definitive`

      it.each(['VIEWER', 'OPERATOR'])('come %s: 403, servizio mai chiamato', async r => {
        ruolo = r
        const put = await http().put(D).send({ attive: true, versione: 1 })
        expect(put.status).toBe(403)
        expect(servizio.impostaDefinitive).not.toHaveBeenCalled()
      })

      it.each(['ADMIN', 'SUPER_ADMIN'])('come %s: azienda dal request, utente e corpo', async r => {
        ruolo = r
        ruoloEffettivo.mockResolvedValue(r)
        const put = await http().put(D).send({ attive: true, versione: 1 })
        expect(put.status).toBe(200)
        expect(put.body).toEqual({ definitiveAttive: true, versione: 2 })
        expect(servizio.impostaDefinitive).toHaveBeenCalledWith(TENANT, 'utente-1', {
          attive: true,
          versione: 1,
        })
        expect(ruoloEffettivo).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'utente-1' }),
          TENANT
        )
      })

      it.each(['VIEWER', 'OPERATOR'])(
        'ADMIN nel token ma solo %s nell’azienda selezionata: 403',
        async effettivo => {
          ruoloEffettivo.mockResolvedValue(effettivo)
          const put = await http().put(D).send({ attive: true, versione: 1 })
          expect(put.status).toBe(403)
          expect(put.body.error).toBe('RUOLO_AZIENDA_SELEZIONATA_INSUFFICIENTE')
          expect(servizio.impostaDefinitive).not.toHaveBeenCalled()
        }
      )

      it('senza azienda selezionata: rifiutato', async () => {
        const put = await http()
          .put(D)
          .set('x-senza-azienda', '1')
          .send({ attive: true, versione: 1 })
        expect(put.status).toBeGreaterThanOrEqual(400)
        expect(servizio.impostaDefinitive).not.toHaveBeenCalled()
      })

      it.each([
        [{ versione: 1 }],
        [{ attive: 'si', versione: 1 }],
        [{ attive: true }],
        [{ attive: true, versione: -1 }],
        [{ attive: true, versione: 1.5 }],
        [{ attive: true, versione: 1, altro: 1 }],
      ])('corpo non valido %j: 400', async corpo => {
        const put = await http().put(D).send(corpo)
        expect(put.status).toBe(400)
        expect(servizio.impostaDefinitive).not.toHaveBeenCalled()
      })

      it('409 VERSIONE_SUPERATA propagato', async () => {
        servizio.impostaDefinitive.mockRejectedValue(
          new ConflictException({ error: 'VERSIONE_SUPERATA', message: 'x' })
        )
        const put = await http().put(D).send({ attive: false, versione: 0 })
        expect(put.status).toBe(409)
        expect(put.body.error).toBe('VERSIONE_SUPERATA')
      })
    })
  })
})
