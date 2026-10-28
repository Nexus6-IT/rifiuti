/**
 * Deposito temporaneo e soglie attraverso la catena HTTP reale: ValidationPipe di main.ts, filtro
 * globale delle eccezioni, controller. Il ruolo effettivo e i servizi sono finti (i servizi hanno i
 * loro test, anche contro Postgres), ma la validazione delle soglie e' quella vera (`validaSoglie`).
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import request from 'supertest'
import { GiacenzeController } from './giacenze.controller'
import { GiacenzeService } from './giacenze.service'
import { SoglieDepositoService, SoglieNonValideError } from './soglie-deposito.service'
import { RegistroNonTrovatoError } from '../registro/registri.service'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { SOGLIE_PREDEFINITE, validaSoglie } from '../../domain/waste-movement/deposito-temporaneo'

const TENANT_TOKEN = '5a5a5a5a-0000-4000-8000-00000000000a'
const TENANT_SELEZIONATO = '5a5a5a5a-0000-4000-8000-00000000000b'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const REG = '3b3b3b3b-0000-4000-8000-000000000006'
const BASE = '/giacenze/deposito-temporaneo'
const SOGLIE = `${BASE}/soglie`
const SOGLIE_REG = `${SOGLIE}/registri/${REG}`

const valida = {
  criterio: 'TEMPORALE',
  giorniMax: null,
  kgMaxTotale: 25000,
  kgMaxPericolosi: 8000,
  preavvisoGiorni: 10,
  preavvisoPercentuale: 75,
}

describe('GiacenzeController (deposito temporaneo e soglie) - catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let giacenze: Record<string, jest.Mock>
  let soglie: Record<string, jest.Mock>
  let logger: any

  beforeEach(async () => {
    ruolo = 'ADMIN'
    giacenze = {
      getGiacenze: jest.fn().mockResolvedValue([]),
      getDepositoTemporaneo: jest.fn().mockResolvedValue({ oggi: '2026-10-28', registri: [] }),
      getDepositoTemporaneoAlerts: jest.fn().mockResolvedValue([
        {
          tipo: 'DURATA',
          livello: 'SUPERATO',
          registroId: REG,
          registroDescrizione: 'Sede A',
          messaggio: 'm',
        },
      ]),
    }
    soglie = {
      leggiConfigurazione: jest
        .fn()
        .mockResolvedValue({ predefinite: SOGLIE_PREDEFINITE, azienda: null, registri: [] }),
      imposta: jest.fn(async (_t: string, _u: string, _r: string | null, dati: any) => {
        const m = validaSoglie(dati)
        if (m.length > 0) throw new SoglieNonValideError(m)
        return { ...dati, note: null, aggiornatoIl: new Date('2026-10-28T10:00:00Z') }
      }),
      elimina: jest.fn().mockResolvedValue(undefined),
    }
    logger = { setContext: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    const moduleRef = await Test.createTestingModule({
      controllers: [GiacenzeController],
      providers: [
        { provide: GiacenzeService, useValue: giacenze },
        { provide: SoglieDepositoService, useValue: soglie },
        {
          provide: RuoloEffettivoService,
          useValue: { ruoloEffettivo: jest.fn(async () => ruolo) },
        },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest()
          req.user = { id: UTENTE, tenantId: TENANT_TOKEN, role: 'ADMIN' }
          // come TenantSwitchInterceptor: l'azienda selezionata con X-Tenant-ID
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
    await app?.close()
  })

  const http = () => request(app.getHttpServer())

  const scritture: Array<[string, string, object?]> = [
    ['PUT', SOGLIE, valida],
    ['DELETE', SOGLIE],
    ['PUT', SOGLIE_REG, valida],
    ['DELETE', SOGLIE_REG],
  ]

  describe('letture', () => {
    it.each(['VIEWER', 'OPERATOR', 'ADMIN'])('%s legge le quattro GET', async r => {
      ruolo = r
      expect((await http().get('/giacenze')).status).toBe(200)
      expect((await http().get(BASE)).status).toBe(200)
      expect((await http().get(`${BASE}/alerts`)).status).toBe(200)
      const res = await http().get(SOGLIE)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ puoImpostare: r === 'ADMIN', azienda: null })
    })

    it('la GET di deposito usa l azienda selezionata (X-Tenant-ID), non quella del token', async () => {
      await http().get(BASE).set('X-Tenant-ID', TENANT_SELEZIONATO)
      expect(giacenze.getDepositoTemporaneo).toHaveBeenCalledWith(TENANT_SELEZIONATO, {
        registroId: undefined,
      })
      await http().get(SOGLIE).set('X-Tenant-ID', TENANT_SELEZIONATO)
      expect(soglie.leggiConfigurazione).toHaveBeenCalledWith(TENANT_SELEZIONATO)
      await http().get(BASE)
      expect(giacenze.getDepositoTemporaneo).toHaveBeenLastCalledWith(TENANT_TOKEN, {
        registroId: undefined,
      })
    })

    it('passa registroId alla vista; non UUID: 400; `oggi` non e un parametro dell API', async () => {
      await http().get(`${BASE}?registroId=${REG}`)
      expect(giacenze.getDepositoTemporaneo).toHaveBeenCalledWith(TENANT_TOKEN, {
        registroId: REG,
      })
      expect((await http().get(`${BASE}?registroId=xyz`)).status).toBe(400)
      expect((await http().get(`${BASE}?oggi=2020-01-01`)).status).toBe(400)
      expect(giacenze.getDepositoTemporaneo).toHaveBeenCalledTimes(1)
    })

    it('/alerts con e senza registroId restituisce gli avvisi piatti con registroDescrizione', async () => {
      const senza = await http().get(`${BASE}/alerts`)
      expect(senza.body).toEqual([
        expect.objectContaining({ registroId: REG, registroDescrizione: 'Sede A' }),
      ])
      expect(giacenze.getDepositoTemporaneoAlerts).toHaveBeenLastCalledWith(TENANT_TOKEN, undefined)
      await http().get(`${BASE}/alerts?registroId=${REG}`)
      expect(giacenze.getDepositoTemporaneoAlerts).toHaveBeenLastCalledWith(TENANT_TOKEN, REG)
      expect((await http().get(`${BASE}/alerts?registroId=xyz`)).status).toBe(400)
    })

    it('la GET soglie porta predefinite, azienda e registri dal servizio', async () => {
      const res = await http().get(SOGLIE)
      expect(res.body).toEqual({
        puoImpostare: true,
        predefinite: SOGLIE_PREDEFINITE,
        azienda: null,
        registri: [],
      })
    })
  })

  describe('registro inesistente o di un altra azienda nelle letture', () => {
    it.each([BASE, `${BASE}/alerts`])('%s: 404 con messaggio senza id (non 500)', async url => {
      giacenze.getDepositoTemporaneo.mockRejectedValue(new RegistroNonTrovatoError())
      giacenze.getDepositoTemporaneoAlerts.mockRejectedValue(new RegistroNonTrovatoError())
      const res = await http().get(`${url}?registroId=${REG}`)
      expect(res.status).toBe(404)
      expect(res.body.message).toBe('Registro non trovato.')
    })
  })

  describe('ruolo effettivo', () => {
    it.each(['VIEWER', 'OPERATOR'])(
      '%s: 403 su PUT e DELETE, senza toccare il servizio',
      async r => {
        ruolo = r
        for (const [metodo, url, corpo] of scritture) {
          const res = await (http() as any)[metodo.toLowerCase()](url).send(corpo)
          expect([metodo, url, res.status, res.body.error]).toEqual([
            metodo,
            url,
            403,
            'DEPOSITO_SOGLIE_RISERVATE_AMMINISTRATORI',
          ])
          expect(res.body.message).toBe(
            "Solo un amministratore dell'azienda può modificare le soglie del deposito temporaneo."
          )
        }
        expect(soglie.imposta).not.toHaveBeenCalled()
        expect(soglie.elimina).not.toHaveBeenCalled()
      }
    )

    it.each(['ADMIN', 'SUPER_ADMIN'])('%s: 200 su PUT, 204 su DELETE', async r => {
      ruolo = r
      const put = await http().put(SOGLIE).send(valida)
      expect(put.status).toBe(200)
      expect(put.body).toMatchObject({ criterio: 'TEMPORALE', kgMaxTotale: 25000 })
      expect((await http().put(SOGLIE_REG).send(valida)).status).toBe(200)
      expect((await http().delete(SOGLIE)).status).toBe(204)
      expect((await http().delete(SOGLIE_REG)).status).toBe(204)
      expect(soglie.imposta).toHaveBeenNthCalledWith(
        1,
        TENANT_TOKEN,
        UTENTE,
        null,
        expect.objectContaining({ criterio: 'TEMPORALE' })
      )
      expect(soglie.imposta).toHaveBeenNthCalledWith(
        2,
        TENANT_TOKEN,
        UTENTE,
        REG,
        expect.anything()
      )
      expect(soglie.elimina).toHaveBeenNthCalledWith(1, TENANT_TOKEN, UTENTE, null)
      expect(soglie.elimina).toHaveBeenNthCalledWith(2, TENANT_TOKEN, UTENTE, REG)
    })

    it('DELETE su registro dell azienda senza riga: 204 (M8)', async () => {
      soglie.elimina.mockResolvedValue(undefined)
      expect((await http().delete(SOGLIE_REG)).status).toBe(204)
    })
  })

  describe('validazione', () => {
    it(':registroId non UUID: 400 su PUT e DELETE', async () => {
      expect((await http().put(`${SOGLIE}/registri/xyz`).send(valida)).status).toBe(400)
      expect((await http().delete(`${SOGLIE}/registri/xyz`)).status).toBe(400)
      expect(soglie.imposta).not.toHaveBeenCalled()
      expect(soglie.elimina).not.toHaveBeenCalled()
    })

    it('corpo non valido: 400 senza arrivare al servizio', async () => {
      const { giorniMax: _g, ...senzaGiorni } = valida
      const corpi = [
        { ...valida, extra: 1 },
        senzaGiorni,
        { ...valida, giorniMax: 93 },
        { ...valida, criterio: 'X' },
      ]
      for (const corpo of corpi) {
        expect((await http().put(SOGLIE).send(corpo)).status).toBe(400)
      }
      expect(soglie.imposta).not.toHaveBeenCalled()
    })

    it('giorniMax null accettato', async () => {
      expect(
        (
          await http()
            .put(SOGLIE)
            .send({ ...valida, giorniMax: null })
        ).status
      ).toBe(200)
    })

    it('preavviso 30 con giorniMax 30: passa il DTO, il servizio risponde 400 col messaggio', async () => {
      const res = await http()
        .put(SOGLIE)
        .send({ ...valida, giorniMax: 30, preavvisoGiorni: 30 })
      expect(res.status).toBe(400)
      expect(res.body.message).toMatch(/preavviso/i)
      expect(res.body.details.messaggi.length).toBeGreaterThan(0)
      expect(soglie.imposta).toHaveBeenCalledTimes(1)
    })
  })

  describe('registro di un altra azienda', () => {
    it('GET, PUT e DELETE: 404 con messaggio senza id', async () => {
      giacenze.getDepositoTemporaneo.mockRejectedValue(new RegistroNonTrovatoError())
      soglie.imposta.mockRejectedValue(new RegistroNonTrovatoError())
      soglie.elimina.mockRejectedValue(new RegistroNonTrovatoError())
      for (const res of [
        await http().get(`${BASE}?registroId=${REG}`),
        await http().put(SOGLIE_REG).send(valida),
        await http().delete(SOGLIE_REG),
      ]) {
        expect(res.status).toBe(404)
        expect(res.body.message).toBe('Registro non trovato.')
      }
    })
  })
})
