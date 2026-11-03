/**
 * POST /auth/refresh attraverso la catena HTTP, con firma e verifica reali dei token.
 *
 * Dopo uno switch di azienda il refresh deve rinnovare l'accesso sull'azienda scelta (e solo
 * se è ancora accessibile), non sull'azienda primaria: il frontend ripete la richiesta
 * originale col token rinnovato, e un `POST /registro` ripetuto sull'azienda primaria
 * scriverebbe nel registro sbagliato.
 */

import { Test } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import request from 'supertest'
import { AuthController } from './auth.controller'
import { JwtTokensService } from '../services/jwt-tokens.service'
import { RedisService } from '../services/redis.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'
import { HttpExceptionFilter } from '../../core/filters/http-exception.filter'

const STUDIO = '5a5a5a5a-0000-4000-8000-000000000001'
const CLIENTE = 'c1c1c1c1-0000-4000-8000-000000000002'
const CONSULENTE = 'e1e1e1e1-0000-4000-8000-000000000003'
const IERI = new Date(Date.now() - 24 * 60 * 60 * 1000)

// Timeout piu' largo SOLO per questa spec: ogni test crea e compila un modulo Nest
// (`Test.createTestingModule(...).compile()`, risoluzione delle dipendenze) in `avvia()`. In
// `test:cov` sotto carico (runner con memoria satura, swap) il passo, che da solo dura pochi ms,
// ha superato i 30 s globali di `jest.config.js`. Misurato: ogni test al massimo ~120 ms.
jest.setTimeout(90_000)

describe('POST /auth/refresh — azienda scelta con lo switch', () => {
  let app: INestApplication
  let jwtTokens: JwtTokensService
  let jwt: JwtService
  const refreshValidi = new Set<string>()

  async function avvia(associazione: { expiresAt: Date | null } | null) {
    // Prisma finto: l'utente (primaria = studio) e la sua eventuale associazione al cliente.
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: CONSULENTE,
          email: 'c@studio.it',
          fiscalCode: null,
          tenantId: STUDIO,
          role: 'ADMIN',
        }),
      },
      tenant: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({ parentTenantId: null }),
      },
      consultantTenantAssociation: {
        findFirst: jest.fn(({ where }: any) => {
          if (!associazione || where.tenantId !== CLIENTE) return Promise.resolve(null)
          const valida =
            associazione.expiresAt === null || associazione.expiresAt > where.OR[1].expiresAt.gt
          return Promise.resolve(valida ? { id: 'a1', role: { name: 'OPERATOR' } } : null)
        }),
      },
    }
    // Redis finto in memoria (nessuna connessione a localhost:6379).
    const redis = {
      isRefreshTokenValid: jest.fn(async (_u: string, t: string) => refreshValidi.has(t)),
    }
    const config = { get: (_k: string, predefinito?: unknown) => predefinito }
    const logger: any = { setContext: jest.fn(), error: jest.fn(), warn: jest.fn() }

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'segreto-di-prova' })],
      controllers: [AuthController],
      providers: [
        JwtTokensService,
        { provide: ConfigService, useValue: config },
        { provide: RedisService, useValue: redis },
        { provide: PrismaSistemaService, useValue: prisma },
        { provide: RuoloEffettivoService, useValue: new RuoloEffettivoService(prisma) },
        { provide: APP_FILTER, useValue: new HttpExceptionFilter(logger) },
      ],
    }).compile()

    jwtTokens = moduleRef.get(JwtTokensService)
    jwt = moduleRef.get(JwtService)
    app = moduleRef.createNestApplication()
    await app.init()
  }

  /** Coppia di token come la emettono il login (studio) o lo switch (cliente), registrata. */
  function emetti(tenantId: string) {
    const coppia = jwtTokens.generateTokenPair({
      id: CONSULENTE,
      email: 'c@studio.it',
      tenantId,
      role: 'ADMIN',
    })
    refreshValidi.add(coppia.refreshToken)
    return coppia
  }

  afterEach(async () => {
    refreshValidi.clear()
    await app?.close()
  })

  it("dopo lo switch il token rinnovato resta sull'azienda del cliente", async () => {
    await avvia({ expiresAt: null })
    const { refreshToken } = emetti(CLIENTE)

    const risposta = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken })

    expect(risposta.status).toBe(201)
    expect(jwt.decode(risposta.body.accessToken)).toMatchObject({
      sub: CONSULENTE,
      tenantId: CLIENTE,
    })
  })

  it('associazione scaduta dopo lo switch: 403 AZIENDA_SELEZIONATA_NON_ACCESSIBILE', async () => {
    await avvia({ expiresAt: IERI })
    const { refreshToken } = emetti(CLIENTE)

    const risposta = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken })

    expect(risposta.status).toBe(403)
    expect(risposta.body.error).toBe('AZIENDA_SELEZIONATA_NON_ACCESSIBILE')
    expect(risposta.body.accessToken).toBeUndefined()
  })

  it("token del login (azienda primaria): rinnovato sull'azienda primaria, come prima", async () => {
    await avvia(null)
    const { refreshToken } = emetti(STUDIO)

    const risposta = await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken })

    expect(risposta.status).toBe(201)
    expect(jwt.decode(risposta.body.accessToken)).toMatchObject({ tenantId: STUDIO })
  })
})
