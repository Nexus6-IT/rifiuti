/**
 * (c) Fase 3, Task 7: l'invio manuale di un FIR importato attraverso la catena HTTP reale
 * (JwtAuthGuard finto -> TenantSwitchInterceptor -> controller -> filtro globale) risponde 409 con il
 * messaggio di D4 e NON accoda nessun job; il FIR normale equivalente si accoda (202).
 */
import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { RENTRISyncController } from './rentri-sync.controller'
import { TriggerBatchSyncUseCase } from '../../application/rentri/trigger-batch-sync.use-case'
import { GetSyncStatusUseCase } from '../../application/rentri/get-sync-status.use-case'
import { ConfermaLegameRENTRIUseCase } from '../../application/rentri/conferma-legame-rentri.use-case'
import { RiapriTrasmissioneRentriUseCase } from '../../application/rentri/riapri-trasmissione-rentri.use-case'
import { RENTRISyncQueue } from '../../infrastructure/queue/rentri-sync.queue'
import { RENTRISyncLogRepository } from '../../infrastructure/persistence/rentri-sync-log.repository'
import { FIRPrismaRepository } from '../../infrastructure/persistence/fir-prisma.repository'
import { FIR } from '../../domain/fir/aggregates/fir.aggregate'
import { UnitaMisura } from '../../domain/fir/value-objects/quantita'
import { LoggerService } from '../../core/logger/logger.service'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { MembershipService } from '../me/membership.service'
import { TenantSwitchInterceptor } from '../../core/interceptors/tenant-switch.interceptor'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'

const AZIENDA = '5a5a5a5a-0000-4000-8000-000000000001'
const UTENTE = 'c1c1c1c1-0000-4000-8000-000000000002'
const FIR_IMPORTATO = '7e7e7e7e-0000-4000-8000-000000000004'
const FIR_NORMALE = '3b3b3b3b-0000-4000-8000-000000000006'

jest.mock('../../core/monitoring/segnala-errore-job', () => ({ segnalaErroreJob: jest.fn() }))

function firEmesso(id: string, bloccato: boolean): FIR {
  const fir = FIR.create({
    produttoreId: 'produttore-1',
    tenantId: AZIENDA,
    rifiuto: { cerCode: '13 02 05*', quantita: 120, unitaMisura: UnitaMisura.KG },
    trasportatoreId: 'trasportatore-1',
    destinatarioId: 'destinatario-1',
  })
  fir.emetti('FIR-2026-000001', {
    firmatario: 'Mario Rossi',
    timestamp: new Date(),
    certificato: 'firma',
    userId: 'user-1',
    documentHash: 'h1',
    certificateHash: 'h2',
  } as any)
  Object.assign(fir, {
    _id: id,
    ...(bloccato
      ? { _bloccatoInvio: true, _motivoBloccoInvio: 'Importato: motivo interno da non esporre' }
      : {}),
  })
  return fir
}

describe('POST /rentri/sync/fir/:id: FIR importato', () => {
  let app: INestApplication
  let coda: { addSyncJob: jest.Mock }
  let riapri: { execute: jest.Mock }
  let repo: { findById: jest.Mock }
  const utente = { id: UTENTE, email: 'u@azienda.it', tenantId: AZIENDA, role: 'ADMIN' }

  beforeEach(async () => {
    coda = { addSyncJob: jest.fn().mockResolvedValue('job-1') }
    riapri = { execute: jest.fn().mockResolvedValue(undefined) }
    repo = {
      findById: jest.fn(async (id: string) =>
        id === FIR_IMPORTATO
          ? firEmesso(id, true)
          : id === FIR_NORMALE
            ? firEmesso(id, false)
            : null
      ),
    }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    const prisma: any = {
      tenant: {
        findFirst: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ parentTenantId: null }),
      },
      consultantTenantAssociation: { findFirst: jest.fn().mockResolvedValue(null) },
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [RENTRISyncController],
      providers: [
        { provide: TriggerBatchSyncUseCase, useValue: {} },
        { provide: GetSyncStatusUseCase, useValue: {} },
        { provide: ConfermaLegameRENTRIUseCase, useValue: {} },
        { provide: RENTRISyncQueue, useValue: coda },
        { provide: RENTRISyncLogRepository, useValue: {} },
        { provide: FIRPrismaRepository, useValue: repo },
        { provide: RiapriTrasmissioneRentriUseCase, useValue: riapri },
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
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile()
    app = moduleRef.createNestApplication()
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
    )
    await app.init()
  })

  afterEach(async () => {
    jest.clearAllMocks()
    await app?.close()
  })

  const http = () => request(app.getHttpServer())

  it('(c) FIR importato: 409 con il messaggio di D4, nessun job in coda', async () => {
    const r = await http().post(`/rentri/sync/fir/${FIR_IMPORTATO}`).send({})
    expect(r.status).toBe(409)
    expect(r.body.message).toBe(
      "FIR importato: l'invio a RENTRI è bloccato fino alla riconciliazione"
    )
    expect(r.body.error).toBe('FIR_BLOCCATO_ALL_INVIO')
    // senza id e senza il motivo interno
    expect(r.body.message).not.toContain(FIR_IMPORTATO)
    expect(JSON.stringify(r.body)).not.toContain('motivo interno')
    expect(coda.addSyncJob).not.toHaveBeenCalled()
  })

  it('(c) anche con la conferma di nuova trasmissione: 409 e nessuna riapertura', async () => {
    const r = await http()
      .post(`/rentri/sync/fir/${FIR_IMPORTATO}`)
      .send({ confermaNuovaTrasmissione: true })
    expect(r.status).toBe(409)
    expect(riapri.execute).not.toHaveBeenCalled()
    expect(coda.addSyncJob).not.toHaveBeenCalled()
  })

  it('prova di controllo: il FIR normale si accoda (202)', async () => {
    const r = await http().post(`/rentri/sync/fir/${FIR_NORMALE}`).send({})
    expect(r.status).toBe(202)
    expect(coda.addSyncJob).toHaveBeenCalledTimes(1)
  })
})
