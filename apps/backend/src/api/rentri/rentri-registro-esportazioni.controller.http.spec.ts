/**
 * Rotte delle esportazioni XML del registro (eREGI E6, T3) attraverso la catena HTTP reale:
 * guard finto -> TenantSwitchInterceptor -> ValidationPipe (come main.ts) -> controller -> filtro
 * globale. Il ruolo che conta e' quello effettivo nell'azienda selezionata.
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { RentriRegistroEsportazioniController } from './rentri-registro-esportazioni.controller'
import { EsportazioneRegistroNonValidaError } from '../../application/rentri/registro/costruisci-esportazione-registro'
import {
  RegistroNonCollegatoRentriError,
  RegistroRentriChiusoError,
} from '../../application/rentri/registro/errori-azioni-rentri-registro'
import {
  CatenaEsportazioniNonCoerenteError,
  EregiNonDisponibileError,
  EsportazioneNonRivalidabileError,
  EsportazioneNonTrovataError,
  EsportazioneRifiutataInCatenaError,
} from '../../application/rentri/registro/errori-esportazioni-registro-rentri'
import { EsportazioniRegistroRentriService } from '../../application/rentri/registro/esportazioni-registro-rentri.service'
import { GeneraEsportazioneRegistroRentriUseCase } from '../../application/rentri/registro/genera-esportazione-registro-rentri.use-case'
import { ValidaEsportazioneRegistroRentriUseCase } from '../../application/rentri/registro/valida-esportazione-registro-rentri.use-case'
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
const ESPORTAZIONE = '9d9d9d9d-0000-4000-8000-000000000005'

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

describe('RentriRegistroEsportazioniController — catena HTTP', () => {
  let app: INestApplication
  let genera: { genera: jest.Mock }
  let valida: { rivalida: jest.Mock }
  let esportazioni: { elenca: jest.Mock; scarica: jest.Mock }
  const utente = { id: CONSULENTE, email: 'c@studio.it', tenantId: STUDIO, role: 'ADMIN' }

  async function avvia(ruoloNelCliente: string) {
    const prisma = prismaFinto(ruoloNelCliente)
    genera = {
      genera: jest.fn().mockResolvedValue({
        esito: 'CREATA',
        esportazione: { id: ESPORTAZIONE },
        fermataA: null,
      }),
    }
    valida = {
      rivalida: jest.fn().mockResolvedValue({ id: ESPORTAZIONE, stato: 'VALIDATA', messaggi: [] }),
    }
    esportazioni = {
      elenca: jest.fn().mockResolvedValue([{ id: ESPORTAZIONE }]),
      scarica: jest.fn().mockResolvedValue({
        nomeFile: 'RENR1234ABCDE0_000001_000003_20260401.SignedR.xml',
        xml: Buffer.from('<reg:Registro/>'),
      }),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [RentriRegistroEsportazioniController],
      providers: [
        { provide: GeneraEsportazioneRegistroRentriUseCase, useValue: genera },
        { provide: ValidaEsportazioneRegistroRentriUseCase, useValue: valida },
        { provide: EsportazioniRegistroRentriService, useValue: esportazioni },
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
  const base = '/rentri/registro'
  const elenco = `${base}/registri/${REGISTRO}/esportazioni`

  afterEach(async () => {
    jest.clearAllMocks()
    await app?.close()
  })

  describe("ruoli nell'azienda selezionata", () => {
    it('VIEWER: legge elenco e file, non genera ne rivalida (403, nessun use case)', async () => {
      await avvia('VIEWER')
      expect((await cliente(http().get(elenco))).status).toBe(200)
      expect((await cliente(http().get(`${base}/esportazioni/${ESPORTAZIONE}/file`))).status).toBe(
        200
      )
      expect((await cliente(http().post(elenco))).status).toBe(403)
      expect(
        (await cliente(http().post(`${base}/esportazioni/${ESPORTAZIONE}/rivalida`))).status
      ).toBe(403)
      expect(genera.genera).not.toHaveBeenCalled()
      expect(valida.rivalida).not.toHaveBeenCalled()
    })

    it('ruolo del token ADMIN ma VIEWER nell azienda del cliente: conta il ruolo effettivo', async () => {
      await avvia('VIEWER')
      expect((await cliente(http().post(elenco))).status).toBe(403)
      expect(genera.genera).not.toHaveBeenCalled()
    })

    it('OPERATOR: genera e rivalida, con tenant del cliente e utente', async () => {
      await avvia('OPERATOR')
      const r = await cliente(http().post(elenco))
      expect(r.status).toBe(201)
      expect(genera.genera).toHaveBeenCalledWith(CLIENTE, REGISTRO, { creataDa: CONSULENTE })
      const v = await cliente(http().post(`${base}/esportazioni/${ESPORTAZIONE}/rivalida`))
      expect(v.status).toBe(200)
      expect(valida.rivalida).toHaveBeenCalledWith(CLIENTE, ESPORTAZIONE)
    })
  })

  it('senza annotazioni da esportare o bloccata: 200 con l esito, non un errore', async () => {
    await avvia('ADMIN')
    genera.genera.mockResolvedValue({ esito: 'NIENTE_DA_ESPORTARE', esportazione: null })
    const a = await cliente(http().post(elenco))
    expect(a.status).toBe(200)
    expect(a.body.esito).toBe('NIENTE_DA_ESPORTARE')
    genera.genera.mockResolvedValue({
      esito: 'BLOCCATA',
      anno: 2026,
      progressivo: 3,
      motivi: ['Dato mancante'],
    })
    const b = await cliente(http().post(elenco))
    expect(b.status).toBe(200)
    expect(b.body).toMatchObject({ esito: 'BLOCCATA', progressivo: 3 })
  })

  it('il file e servito come application/xml in allegato, con il nome atteso', async () => {
    await avvia('VIEWER')
    const r = await cliente(http().get(`${base}/esportazioni/${ESPORTAZIONE}/file`))
    expect(r.status).toBe(200)
    expect(r.headers['content-type']).toMatch(/application\/xml/)
    expect(r.headers['content-disposition']).toBe(
      'attachment; filename="RENR1234ABCDE0_000001_000003_20260401.SignedR.xml"'
    )
    expect(r.headers['cache-control']).toBe('no-store')
    expect(r.text).toBe('<reg:Registro/>')
  })

  it('id non uuid: 400', async () => {
    await avvia('ADMIN')
    expect((await cliente(http().post(`${base}/registri/non-un-uuid/esportazioni`))).status).toBe(
      400
    )
    expect((await cliente(http().get(`${base}/esportazioni/non-un-uuid/file`))).status).toBe(400)
  })

  it.each([
    [new RegistroNonTrovatoError(), 404],
    [new RegistroNonCollegatoRentriError(), 409],
    [new RegistroRentriChiusoError(), 409],
    [new EsportazioneRifiutataInCatenaError(), 409],
    [new CatenaEsportazioniNonCoerenteError('motivo'), 409],
    [new EregiNonDisponibileError('forma inattesa'), 502],
    [new EsportazioneRegistroNonValidaError('xsd', ['Elemento X: non valido']), 422],
    [new TenantSenzaCertificatoRentriError(), 422],
    [new RentriApiError(403, undefined, undefined, false), 403],
    [new RentriApiError(503, undefined, undefined, true), 503],
    [new RentriApiError(418, undefined, undefined, false), 502],
  ])('generazione: %s -> %i, senza dettagli tecnici', async (errore, stato) => {
    await avvia('ADMIN')
    genera.genera.mockRejectedValue(errore)
    const r = await cliente(http().post(elenco))
    expect(r.status).toBe(stato)
    expect(String(r.body.message)).not.toMatch(/[0-9a-f]{8}-0000/)
  })

  it('rivalida: non trovata 404, gia con esito 409', async () => {
    await avvia('ADMIN')
    valida.rivalida.mockRejectedValueOnce(new EsportazioneNonTrovataError())
    expect(
      (await cliente(http().post(`${base}/esportazioni/${ESPORTAZIONE}/rivalida`))).status
    ).toBe(404)
    valida.rivalida.mockRejectedValueOnce(new EsportazioneNonRivalidabileError())
    expect(
      (await cliente(http().post(`${base}/esportazioni/${ESPORTAZIONE}/rivalida`))).status
    ).toBe(409)
  })

  it('file di un altra esportazione: 404', async () => {
    await avvia('ADMIN')
    esportazioni.scarica.mockRejectedValue(new EsportazioneNonTrovataError())
    expect((await cliente(http().get(`${base}/esportazioni/${ESPORTAZIONE}/file`))).status).toBe(
      404
    )
  })
})
