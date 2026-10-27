/**
 * Causali del registro attraverso la catena HTTP reale: ValidationPipe di main.ts, filtro globale
 * delle eccezioni, controller. Il ruolo effettivo e il servizio sono finti (il servizio ha i suoi
 * test, anche contro Postgres).
 */
import { Test } from '@nestjs/testing'
import {
  ConflictException,
  ExecutionContext,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import request from 'supertest'
import { CausaliRegistroController } from './causali-registro.controller'
import { CausaliRegistroService } from '../../application/registro/causali/causali-registro.service'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const TENANT = '5a5a5a5a-0000-4000-8000-000000000001'
const UTENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const ID = '3b3b3b3b-0000-4000-8000-000000000006'
const BASE = '/registro/causali'

const valida = {
  codice: 'AZ_RESO',
  verso: 'CARICO',
  descrizione: 'Reso',
  ruoloMud: 'ESCLUSO',
}
const versione = { validaDal: '2026-11-01', ruoloMud: 'ESCLUSO' }

describe('CausaliRegistroController — catena HTTP', () => {
  let app: INestApplication
  let ruolo: string
  let servizio: Record<string, jest.Mock>

  beforeEach(async () => {
    ruolo = 'ADMIN'
    servizio = {
      opzioni: jest.fn().mockResolvedValue([{ codice: 'ALTRO_CARICO' }]),
      gestione: jest.fn().mockResolvedValue({ sistema: [], aziendali: [] }),
      disattiva: jest.fn().mockResolvedValue(undefined),
      riattiva: jest.fn().mockResolvedValue(undefined),
      crea: jest.fn().mockResolvedValue({ id: ID }),
      modifica: jest.fn().mockResolvedValue({ id: ID }),
      nuovaVersione: jest.fn().mockResolvedValue({ id: ID }),
      chiudi: jest.fn().mockResolvedValue({ id: ID }),
      elimina: jest.fn().mockResolvedValue(undefined),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [CausaliRegistroController],
      providers: [
        { provide: CausaliRegistroService, useValue: servizio },
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
          context.switchToHttp().getRequest().user = {
            id: UTENTE,
            tenantId: TENANT,
            role: 'ADMIN',
          }
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

  /** Tutte le rotte di gestione e di scrittura, con un corpo valido. */
  const riservate: Array<[string, string, object?]> = [
    ['GET', `${BASE}/gestione`],
    ['PUT', `${BASE}/sistema/CARICO/ALTRO_CARICO/disattivazione`],
    ['DELETE', `${BASE}/sistema/CARICO/ALTRO_CARICO/disattivazione`],
    ['POST', `${BASE}/aziendali`, valida],
    ['PATCH', `${BASE}/aziendali/${ID}`, { descrizione: 'x' }],
    ['POST', `${BASE}/aziendali/${ID}/versioni`, versione],
    ['PUT', `${BASE}/aziendali/${ID}/chiusura`, { validaAl: '2026-12-31' }],
    ['DELETE', `${BASE}/aziendali/${ID}`],
  ]

  describe('lettura delle opzioni', () => {
    it.each(['VIEWER', 'OPERATOR', 'ADMIN'])('%s legge le opzioni', async r => {
      ruolo = r
      const res = await http().get(`${BASE}?tipo=CARICO&data=2026-10-28`)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        tipo: 'CARICO',
        data: '2026-10-28',
        causali: [{ codice: 'ALTRO_CARICO' }],
      })
      expect(servizio.opzioni).toHaveBeenCalledWith(TENANT, 'CARICO', '2026-10-28')
    })

    it('senza data vale oggi (giorno italiano)', async () => {
      const res = await http().get(`${BASE}?tipo=SCARICO`)
      expect(res.body.data).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('tipo mancante o errato, data impossibile: 400', async () => {
      expect((await http().get(BASE)).status).toBe(400)
      expect((await http().get(`${BASE}?tipo=TR`)).status).toBe(400)
      expect((await http().get(`${BASE}?tipo=CARICO&data=2026-02-30`)).status).toBe(400)
      expect(servizio.opzioni).not.toHaveBeenCalled()
    })
  })

  describe('ruolo effettivo', () => {
    it.each(['VIEWER', 'OPERATOR'])(
      '%s: 403 su gestione e su ogni mutazione, senza toccare il servizio',
      async r => {
        ruolo = r
        for (const [metodo, url, corpo] of riservate) {
          const res = await (http() as any)[metodo.toLowerCase()](url).send(corpo)
          expect([metodo, url, res.status, res.body.error]).toEqual([
            metodo,
            url,
            403,
            'REGISTRO_CAUSALI_RISERVATE_AMMINISTRATORI',
          ])
          expect(res.body.message).toBe(
            "Solo un amministratore dell'azienda può gestire le causali del registro."
          )
        }
        for (const m of Object.values(servizio)) expect(m).not.toHaveBeenCalled()
      }
    )

    it.each(['ADMIN', 'SUPER_ADMIN'])('%s: 200/201/204 secondo la rotta', async r => {
      ruolo = r
      const p = `${BASE}/sistema`
      expect((await http().get(`${BASE}/gestione`)).status).toBe(200)
      expect((await http().put(`${p}/CARICO/ALTRO_CARICO/disattivazione`)).status).toBe(204)
      expect((await http().delete(`${p}/SCARICO/CESSIONE/disattivazione`)).status).toBe(204)
      expect((await http().post(`${BASE}/aziendali`).send(valida)).status).toBe(201)
      expect((await http().patch(`${BASE}/aziendali/${ID}`).send({ ordine: 5 })).status).toBe(200)
      expect((await http().post(`${BASE}/aziendali/${ID}/versioni`).send(versione)).status).toBe(
        201
      )
      expect(
        (await http().put(`${BASE}/aziendali/${ID}/chiusura`).send({ validaAl: '2026-12-31' }))
          .status
      ).toBe(200)
      expect((await http().delete(`${BASE}/aziendali/${ID}`)).status).toBe(204)
      expect(servizio.disattiva).toHaveBeenCalledWith(TENANT, UTENTE, 'CARICO', 'ALTRO_CARICO')
      expect(servizio.riattiva).toHaveBeenCalledWith(TENANT, UTENTE, 'SCARICO', 'CESSIONE')
      expect(servizio.chiudi).toHaveBeenCalledWith(TENANT, UTENTE, ID, '2026-12-31')
    })
  })

  describe('validazione', () => {
    it('id non UUID: 400 su PATCH, versioni, chiusura, DELETE', async () => {
      expect((await http().patch(`${BASE}/aziendali/xyz`).send({ ordine: 1 })).status).toBe(400)
      expect((await http().post(`${BASE}/aziendali/xyz/versioni`).send(versione)).status).toBe(400)
      expect(
        (await http().put(`${BASE}/aziendali/xyz/chiusura`).send({ validaAl: '2026-12-31' })).status
      ).toBe(400)
      expect((await http().delete(`${BASE}/aziendali/xyz`)).status).toBe(400)
      expect(servizio.modifica).not.toHaveBeenCalled()
    })

    it('verso della disattivazione non valido: 400', async () => {
      expect((await http().put(`${BASE}/sistema/TR/ALTRO_CARICO/disattivazione`)).status).toBe(400)
      expect(servizio.disattiva).not.toHaveBeenCalled()
    })

    it('corpo non valido: 400 senza arrivare al servizio', async () => {
      const corpi = [
        { ...valida, codice: 'RESO' },
        { ...valida, extra: 1 },
        { ...valida, validaDal: '2026-02-30' },
      ]
      for (const corpo of corpi) {
        expect((await http().post(`${BASE}/aziendali`).send(corpo)).status).toBe(400)
      }
      expect(servizio.crea).not.toHaveBeenCalled()
    })

    it('PATCH: null su codiceRentri e operazione arriva al servizio; null su descrizione e un 400', async () => {
      const ok = await http()
        .patch(`${BASE}/aziendali/${ID}`)
        .send({ codiceRentri: null, operazione: null })
      expect(ok.status).toBe(200)
      const passato = servizio.modifica.mock.calls[0][3]
      expect(passato.codiceRentri).toBeNull()
      expect(passato.operazione).toBeNull()
      expect('descrizione' in passato).toBe(false)
      expect(
        (await http().patch(`${BASE}/aziendali/${ID}`).send({ descrizione: null })).status
      ).toBe(400)
      expect(servizio.modifica).toHaveBeenCalledTimes(1)
    })
  })

  describe('errori del servizio', () => {
    it('409 con il loro codice e il loro messaggio, invariati', async () => {
      servizio.modifica.mockRejectedValue(
        new ConflictException({
          message: 'Questa causale è già usata.',
          error: 'CAUSALE_USATA_NUOVA_VERSIONE',
        })
      )
      const res = await http().patch(`${BASE}/aziendali/${ID}`).send({ ruoloMud: 'ESCLUSO' })
      expect(res.status).toBe(409)
      expect(res.body.error).toBe('CAUSALE_USATA_NUOVA_VERSIONE')
      expect(res.body.message).toBe('Questa causale è già usata.')
    })

    it('404 passa invariato', async () => {
      servizio.elimina.mockRejectedValue(new NotFoundException('Causale non trovata.'))
      expect((await http().delete(`${BASE}/aziendali/${ID}`)).status).toBe(404)
    })
  })
})
