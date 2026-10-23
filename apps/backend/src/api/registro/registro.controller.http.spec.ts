/**
 * Registro attraverso la catena HTTP reale: JwtAuthGuard (finto) → TenantSwitchInterceptor
 * globale → RegistroController → filtro globale delle eccezioni.
 *
 * Verifica che l'azienda selezionata con `X-Tenant-ID` sia quella su cui si scrive, che il
 * ruolo conti in quella azienda e che una selezione non più valida venga rifiutata invece di
 * ricadere in silenzio sull'azienda primaria del token (dove il movimento finirebbe nel
 * registro sbagliato, che non si può correggere).
 */

import { Test } from '@nestjs/testing'
import { ExecutionContext, INestApplication } from '@nestjs/common'
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core'
import request from 'supertest'
import { RegistroController } from './registro.controller'
import { RegistraMovimentoUseCase } from '../../application/registro/use-cases/registra-movimento.use-case'
import { ListMovimentiHandler } from '../../application/registro/queries/list-movimenti.handler'
import { ProgressivoInizialeService } from '../../application/registro/progressivo-iniziale.service'
import { RuoloEffettivoService } from '../me/ruolo-effettivo.service'
import { MembershipService } from '../me/membership.service'
import { TenantSwitchInterceptor } from '../../core/interceptors/tenant-switch.interceptor'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { Result } from '../../core/application/result'

const STUDIO = '5a5a5a5a-0000-4000-8000-000000000001'
const CLIENTE = 'c1c1c1c1-0000-4000-8000-000000000002'
const CONSULENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const IERI = new Date(Date.now() - 24 * 60 * 60 * 1000)

interface Associazione {
  tenantId: string
  isActive: boolean
  expiresAt: Date | null
  role: { name: string }
}

/**
 * Prisma finto che applica i filtri `where` di `checkAccess` e di `ruoloEffettivo`
 * (associazione attiva e non scaduta), con una sola associazione del consulente al cliente.
 */
function prismaFinto(associazione: Associazione) {
  const valida = (where: any): boolean => {
    if (where.consultantUserId !== CONSULENTE || where.tenantId !== associazione.tenantId) {
      return false
    }
    if (where.isActive === true && !associazione.isActive) return false
    return (where.OR ?? [{ expiresAt: null }]).some((c: any) =>
      c.expiresAt === null
        ? associazione.expiresAt === null
        : associazione.expiresAt !== null && associazione.expiresAt > c.expiresAt.gt
    )
  }
  return {
    tenant: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ parentTenantId: null }),
    },
    consultantTenantAssociation: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(valida(where) ? { id: 'a1', role: associazione.role } : null)
      ),
    },
  } as any
}

const movimento = {
  type: 'CARICO',
  movementDate: '2026-03-11',
  causale: 'PRODUZIONE_INTERNA',
  cerCode: '20 03 01',
  quantity: 100,
}

describe('RegistroController — catena HTTP con azienda selezionata', () => {
  let app: INestApplication
  let registra: { execute: jest.Mock }

  // ADMIN del proprio studio (ruolo del token), che lavora nell'azienda del cliente.
  const utente = { id: CONSULENTE, email: 'c@studio.it', tenantId: STUDIO, role: 'ADMIN' }

  async function avvia(associazione: Associazione) {
    const prisma = prismaFinto(associazione)
    registra = { execute: jest.fn().mockResolvedValue(Result.ok({ id: 'm1' })) }
    const logger: any = {
      setContext: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }
    const moduleRef = await Test.createTestingModule({
      controllers: [RegistroController],
      providers: [
        { provide: RegistraMovimentoUseCase, useValue: registra },
        { provide: ListMovimentiHandler, useValue: { execute: jest.fn() } },
        { provide: ProgressivoInizialeService, useValue: {} },
        { provide: RuoloEffettivoService, useValue: new RuoloEffettivoService(prisma) },
        {
          provide: MembershipService,
          useValue: new MembershipService(prisma, { generateTokenPair: jest.fn() } as any),
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
    await app.init()
  }

  afterEach(async () => {
    await app?.close()
  })

  it('associazione scaduta: 403 AZIENDA_SELEZIONATA_NON_ACCESSIBILE e nessuna scrittura nello studio', async () => {
    await avvia({ tenantId: CLIENTE, isActive: true, expiresAt: IERI, role: { name: 'OPERATOR' } })

    const risposta = await request(app.getHttpServer())
      .post('/registro')
      .set('X-Tenant-ID', CLIENTE)
      .send(movimento)

    expect(risposta.status).toBe(403)
    expect(risposta.body.error).toBe('AZIENDA_SELEZIONATA_NON_ACCESSIBILE')
    expect(registra.execute).not.toHaveBeenCalled()
  })

  it('associazione CONSULTANT (sola consultazione): 403 REGISTRO_RISERVATO_OPERATORI', async () => {
    await avvia({
      tenantId: CLIENTE,
      isActive: true,
      expiresAt: null,
      role: { name: 'CONSULTANT' },
    })

    const risposta = await request(app.getHttpServer())
      .post('/registro')
      .set('X-Tenant-ID', CLIENTE)
      .send(movimento)

    expect(risposta.status).toBe(403)
    expect(risposta.body.error).toBe('REGISTRO_RISERVATO_OPERATORI')
    expect(registra.execute).not.toHaveBeenCalled()
  })

  it("associazione OPERATOR: 201 e il movimento va nell'azienda selezionata", async () => {
    await avvia({ tenantId: CLIENTE, isActive: true, expiresAt: null, role: { name: 'OPERATOR' } })

    const risposta = await request(app.getHttpServer())
      .post('/registro')
      .set('X-Tenant-ID', CLIENTE)
      .send(movimento)

    expect(risposta.status).toBe(201)
    expect(registra.execute).toHaveBeenCalledTimes(1)
    expect(registra.execute.mock.calls[0][0].tenantId).toBe(CLIENTE)
    expect(registra.execute.mock.calls[0][0].userId).toBe(CONSULENTE)
  })
})
