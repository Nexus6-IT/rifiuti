/**
 * Rotte per collegare o aprire il registro su RENTRI (eREGI E2, T3) attraverso la catena HTTP reale:
 * guard finto -> TenantSwitchInterceptor -> ValidationPipe (come main.ts) -> controller -> filtro
 * globale. Il ruolo che conta e' quello effettivo nell'azienda selezionata.
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { RentriRegistroCollegamentoController } from './rentri-registro-collegamento.controller'
import { ApriRegistroRentriUseCase } from '../../application/rentri/registro/apri-registro-rentri.use-case'
import { CandidatiRegistroRentriUseCase } from '../../application/rentri/registro/candidati-registro-rentri.use-case'
import { CollegaRegistroRentriUseCase } from '../../application/rentri/registro/collega-registro-rentri.use-case'
import { ModificaRegistroRentriUseCase } from '../../application/rentri/registro/modifica-registro-rentri.use-case'
import { ChiudiRegistroRentriUseCase } from '../../application/rentri/registro/chiudi-registro-rentri.use-case'
import { AbbandonaAperturaRegistroRentriUseCase } from '../../application/rentri/registro/abbandona-apertura-registro-rentri.use-case'
import {
  AperturaRegistroInCorsoError,
  ChiusuraRegistroNonConfermataError,
  ChiusuraRegistroNonPossibileError,
  IdentificativoGiaUsatoError,
  NessunaAperturaDaAbbandonareError,
  RegistroNonCollegatoRentriError,
  RegistroRentriChiusoError,
  RegistroRentriNonCollegabileError,
  RegistroRentriNonTrovatoError,
  RegistroSenzaSedeRentriError,
  RichiestaTrasmissioneNonValidaError,
} from '../../application/rentri/registro/errori-azioni-rentri-registro'
import { RegistroNonTrovatoError } from '../../application/registro/registri.service'
import { RentriApiError } from '../../infrastructure/rentri/rentri-http-resilienza'
import { TenantSenzaCertificatoRentriError } from '../../infrastructure/rentri/rentri-credential.resolver'
import { LoggerService } from '../../core/logger/logger.service'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { MembershipService } from '../me/membership.service'
import { TenantSwitchInterceptor } from '../../core/interceptors/tenant-switch.interceptor'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const STUDIO = '5a5a5a5a-0000-4000-8000-000000000001'
const CLIENTE = 'c1c1c1c1-0000-4000-8000-000000000002'
const CONSULENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const REGISTRO = '7e7e7e7e-0000-4000-8000-000000000004'

function prismaFinto(ruoloNelCliente: string) {
  return {
    tenant: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ parentTenantId: null }),
    },
    consultantTenantAssociation: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(
          where.consultantUserId === CONSULENTE && where.tenantId === CLIENTE
            ? { id: 'a1', role: { name: ruoloNelCliente } }
            : null
        )
      ),
    },
  } as any
}

describe('RentriRegistroCollegamentoController — catena HTTP', () => {
  let app: INestApplication
  let candidati: { esegui: jest.Mock }
  let collega: { esegui: jest.Mock }
  let apri: { esegui: jest.Mock }
  let modifica: { esegui: jest.Mock }
  let chiudi: { esegui: jest.Mock }
  let abbandona: { esegui: jest.Mock }
  const utente = { id: CONSULENTE, email: 'c@studio.it', tenantId: STUDIO, role: 'ADMIN' }

  async function avvia(ruoloNelCliente: string) {
    const prisma = prismaFinto(ruoloNelCliente)
    candidati = { esegui: jest.fn().mockResolvedValue([{ identificativo: 'RAB12CD34E5' }]) }
    collega = { esegui: jest.fn().mockResolvedValue({ registroId: REGISTRO }) }
    apri = {
      esegui: jest
        .fn()
        .mockResolvedValue({ esito: 'APERTO', impostazioni: { registroId: REGISTRO } }),
    }
    modifica = {
      esegui: jest
        .fn()
        .mockResolvedValue({ esito: 'MODIFICATO', impostazioni: { registroId: REGISTRO } }),
    }
    chiudi = {
      esegui: jest
        .fn()
        .mockResolvedValue({ esito: 'CHIUSO', impostazioni: { registroId: REGISTRO } }),
    }
    abbandona = { esegui: jest.fn().mockResolvedValue({ registroId: REGISTRO }) }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [RentriRegistroCollegamentoController],
      providers: [
        { provide: CandidatiRegistroRentriUseCase, useValue: candidati },
        { provide: CollegaRegistroRentriUseCase, useValue: collega },
        { provide: ApriRegistroRentriUseCase, useValue: apri },
        { provide: ModificaRegistroRentriUseCase, useValue: modifica },
        { provide: ChiudiRegistroRentriUseCase, useValue: chiudi },
        { provide: AbbandonaAperturaRegistroRentriUseCase, useValue: abbandona },
        { provide: LoggerService, useValue: logger },
        { provide: RuoloEffettivoService, useValue: new RuoloEffettivoService(prisma) },
        {
          provide: MembershipService,
          useValue: new MembershipService(prisma, prisma, { generateTokenPair: jest.fn() } as any),
        },
        { provide: APP_INTERCEPTOR, useClass: TenantSwitchInterceptor },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest().user = utente
          return true
        },
      })
      .compile()
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
  }

  const http = () => request(app.getHttpServer())
  const cliente = (r: request.Test) => r.set('X-Tenant-ID', CLIENTE)
  const base = `/rentri/registro/registri/${REGISTRO}/rentri`

  afterEach(async () => {
    jest.clearAllMocks()
    await app?.close()
  })

  describe("ruoli nell'azienda selezionata", () => {
    it('VIEWER: nessuna delle tre rotte (403, nessun use case)', async () => {
      await avvia('VIEWER')
      expect((await cliente(http().get(`${base}/candidati`))).status).toBe(403)
      expect(
        (await cliente(http().post(`${base}/collega`).send({ identificativo: 'RAB12CD34E5' })))
          .status
      ).toBe(403)
      expect(
        (
          await cliente(
            http()
              .post(`${base}/apri`)
              .send({ attivita: ['Produzione'] })
          )
        ).status
      ).toBe(403)
      expect(candidati.esegui).not.toHaveBeenCalled()
      expect(collega.esegui).not.toHaveBeenCalled()
      expect(apri.esegui).not.toHaveBeenCalled()
    })

    it("OPERATOR: legge i candidati ma non collega ne' apre (403)", async () => {
      await avvia('OPERATOR')
      expect((await cliente(http().get(`${base}/candidati`))).status).toBe(200)
      expect(
        (await cliente(http().post(`${base}/collega`).send({ identificativo: 'RAB12CD34E5' })))
          .status
      ).toBe(403)
      expect(
        (
          await cliente(
            http()
              .post(`${base}/apri`)
              .send({ attivita: ['Produzione'] })
          )
        ).status
      ).toBe(403)
      expect(collega.esegui).not.toHaveBeenCalled()
      expect(apri.esegui).not.toHaveBeenCalled()
    })

    it("ruolo del token ADMIN ma VIEWER nell'azienda del cliente: conta il ruolo effettivo", async () => {
      await avvia('VIEWER')
      const r = await cliente(
        http().post(`${base}/collega`).send({ identificativo: 'RAB12CD34E5' })
      )
      expect(r.status).toBe(403)
      expect(collega.esegui).not.toHaveBeenCalled()
    })

    it('ADMIN effettivo: passa tenant del cliente, utente e ruolo effettivo', async () => {
      await avvia('ADMIN')
      const r = await cliente(
        http().post(`${base}/collega`).send({ identificativo: 'RAB12CD34E5' })
      )
      expect(r.status).toBe(200)
      expect(collega.esegui).toHaveBeenCalledWith(
        CLIENTE,
        CONSULENTE,
        'ADMIN',
        REGISTRO,
        'RAB12CD34E5'
      )
    })
  })

  describe('risposte', () => {
    it('candidati: { candidati: [...] }', async () => {
      await avvia('ADMIN')
      const r = await cliente(http().get(`${base}/candidati`))
      expect(r.body).toEqual({ candidati: [{ identificativo: 'RAB12CD34E5' }] })
      expect(candidati.esegui).toHaveBeenCalledWith(CLIENTE, REGISTRO)
    })

    it("apri: 201 se aperto, con attivita' e descrizione passate allo use case", async () => {
      await avvia('ADMIN')
      const r = await cliente(
        http()
          .post(`${base}/apri`)
          .send({ attivita: ['Recupero'], attivitaRecSmalt: ['R13'], descrizione: 'Nuovo' })
      )
      expect(r.status).toBe(201)
      expect(r.body.esito).toBe('APERTO')
      expect(apri.esegui).toHaveBeenCalledWith(CLIENTE, CONSULENTE, 'ADMIN', REGISTRO, {
        attivita: ['Recupero'],
        attivitaRecSmalt: ['R13'],
        descrizione: 'Nuovo',
      })
    })

    it("apri: 202 se l'esito e' incerto", async () => {
      await avvia('ADMIN')
      apri.esegui.mockResolvedValue({ esito: 'INCERTO', messaggio: 'incerto' })
      const r = await cliente(
        http()
          .post(`${base}/apri`)
          .send({ attivita: ['Produzione'] })
      )
      expect(r.status).toBe(202)
      expect(r.body).toEqual({ esito: 'INCERTO', messaggio: 'incerto' })
    })
  })

  describe('modifica, chiudi, abbandona apertura (eREGI E3)', () => {
    it('OPERATOR e VIEWER: 403 su tutte e tre, nessun use case', async () => {
      for (const ruolo of ['OPERATOR', 'VIEWER']) {
        await avvia(ruolo)
        expect((await cliente(http().put(base).send({ descrizione: 'x' }))).status).toBe(403)
        expect(
          (await cliente(http().post(`${base}/chiudi`).send({ conferma: 'RAB12CD34E5' }))).status
        ).toBe(403)
        expect((await cliente(http().post(`${base}/abbandona-apertura`))).status).toBe(403)
        expect(modifica.esegui).not.toHaveBeenCalled()
        expect(chiudi.esegui).not.toHaveBeenCalled()
        expect(abbandona.esegui).not.toHaveBeenCalled()
        await app.close()
      }
    })

    it('ADMIN effettivo: tenant del cliente, utente, ruolo e corpo arrivano allo use case', async () => {
      await avvia('ADMIN')
      const m = await cliente(
        http()
          .put(base)
          .send({ descrizione: 'Nuova', attivitaRecSmalt: ['R13'], forza: true })
      )
      expect(m.status).toBe(200)
      expect(modifica.esegui).toHaveBeenCalledWith(CLIENTE, CONSULENTE, 'ADMIN', REGISTRO, {
        descrizione: 'Nuova',
        attivitaRecSmalt: ['R13'],
        forza: true,
      })
      const c = await cliente(http().post(`${base}/chiudi`).send({ conferma: 'RAB12CD34E5' }))
      expect(c.status).toBe(200)
      expect(chiudi.esegui).toHaveBeenCalledWith(
        CLIENTE,
        CONSULENTE,
        'ADMIN',
        REGISTRO,
        'RAB12CD34E5'
      )
      const a = await cliente(http().post(`${base}/abbandona-apertura`))
      expect(a.status).toBe(200)
      expect(abbandona.esegui).toHaveBeenCalledWith(CLIENTE, CONSULENTE, 'ADMIN', REGISTRO)
    })

    it('esito INCERTO: 202 (modifica e chiusura)', async () => {
      await avvia('ADMIN')
      modifica.esegui.mockResolvedValue({ esito: 'INCERTO', messaggio: 'incerto' })
      chiudi.esegui.mockResolvedValue({ esito: 'INCERTO', messaggio: 'incerto' })
      expect((await cliente(http().put(base).send({ descrizione: 'x' }))).status).toBe(202)
      const c = await cliente(http().post(`${base}/chiudi`).send({ conferma: 'RAB12CD34E5' }))
      expect(c.status).toBe(202)
      expect(c.body).toEqual({ esito: 'INCERTO', messaggio: 'incerto' })
    })

    it('corpo non valido: 400 prima dello use case', async () => {
      await avvia('ADMIN')
      for (const corpo of [
        { extra: 1 },
        { descrizione: 'x'.repeat(251) },
        { attivitaRecSmalt: 'R1' },
        { forza: 'si' },
      ]) {
        expect((await cliente(http().put(base).send(corpo))).status).toBe(400)
      }
      for (const corpo of [{}, { conferma: '' }, { conferma: 1 }, { conferma: 'R', x: 1 }]) {
        expect((await cliente(http().post(`${base}/chiudi`).send(corpo))).status).toBe(400)
      }
      expect(modifica.esegui).not.toHaveBeenCalled()
      expect(chiudi.esegui).not.toHaveBeenCalled()
    })

    it('la chiusura bloccata porta i conteggi nel corpo del 409', async () => {
      await avvia('ADMIN')
      chiudi.esegui.mockRejectedValue(
        new ChiusuraRegistroNonPossibileError('Non si può chiudere', { DA_TRASMETTERE: 3 })
      )
      const r = await cliente(http().post(`${base}/chiudi`).send({ conferma: 'RAB12CD34E5' }))
      expect(r.status).toBe(409)
      expect(r.body.details.conteggi).toEqual({ DA_TRASMETTERE: 3 })
    })

    it.each([
      [new RegistroNonCollegatoRentriError(), 409],
      [new RegistroRentriChiusoError(), 409],
      [new ChiusuraRegistroNonConfermataError(), 409],
      [new NessunaAperturaDaAbbandonareError(), 409],
      [new RichiestaTrasmissioneNonValidaError('conferma'), 400],
      [new RentriApiError(404, undefined, undefined, false), 400],
    ])('%s -> %i', async (errore, stato) => {
      await avvia('ADMIN')
      chiudi.esegui.mockRejectedValue(errore)
      modifica.esegui.mockRejectedValue(errore)
      abbandona.esegui.mockRejectedValue(errore)
      expect(
        (await cliente(http().post(`${base}/chiudi`).send({ conferma: 'RAB12CD34E5' }))).status
      ).toBe(stato)
      expect((await cliente(http().put(base).send({ descrizione: 'x' }))).status).toBe(stato)
      expect((await cliente(http().post(`${base}/abbandona-apertura`))).status).toBe(stato)
    })
  })

  describe('validazione e traduzione degli errori', () => {
    it('corpo non valido: 400 prima dello use case', async () => {
      await avvia('ADMIN')
      for (const corpo of [
        {},
        { attivita: [] },
        { attivita: 'Produzione' },
        { attivita: ['Produzione'], extra: 1 },
        { attivita: ['Produzione'], descrizione: 'x'.repeat(251) },
      ]) {
        expect((await cliente(http().post(`${base}/apri`).send(corpo))).status).toBe(400)
      }
      expect((await cliente(http().post(`${base}/collega`).send({}))).status).toBe(400)
      expect(apri.esegui).not.toHaveBeenCalled()
      expect(collega.esegui).not.toHaveBeenCalled()
    })

    it('id registro non uuid: 400', async () => {
      await avvia('ADMIN')
      const r = await cliente(
        http()
          .post('/rentri/registro/registri/non-un-uuid/rentri/collega')
          .send({ identificativo: 'R' })
      )
      expect(r.status).toBe(400)
    })

    it.each([
      [new RegistroNonTrovatoError(), 404],
      [new RegistroRentriNonTrovatoError(), 400],
      [new RichiestaTrasmissioneNonValidaError('no'), 400],
      [new RegistroRentriNonCollegabileError('altra sede'), 409],
      [new RegistroSenzaSedeRentriError(), 409],
      [new AperturaRegistroInCorsoError(), 409],
      [new IdentificativoGiaUsatoError(), 409],
      [new RentriApiError(400, 'Dati non validi', 'dettaglio con RSSMRA80A01H501U', false), 400],
      [new RentriApiError(403, undefined, undefined, false), 403],
      [new RentriApiError(503, undefined, undefined, true), 503],
      [new RentriApiError(418, undefined, undefined, false), 502],
      [new TenantSenzaCertificatoRentriError(), 422],
    ])('%s -> %i, senza dettagli tecnici', async (errore, stato) => {
      await avvia('ADMIN')
      collega.esegui.mockRejectedValue(errore)
      const r = await cliente(
        http().post(`${base}/collega`).send({ identificativo: 'RAB12CD34E5' })
      )
      expect(r.status).toBe(stato)
      expect(String(r.body.message)).not.toMatch(/RSSMRA80A01H501U|[0-9a-f]{8}-0000/)
    })
  })
})
