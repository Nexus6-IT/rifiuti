/**
 * Auth Controller - TDD Tests
 * Controller for authentication endpoints (SPID login, token refresh, logout)
 */

import { Test, TestingModule } from '@nestjs/testing'
import { AuthController } from './auth.controller'
import { JwtTokensService } from '../services/jwt-tokens.service'
import { RedisService } from '../services/redis.service'
import { PrismaSistemaService } from '../../infrastructure/persistence/prisma-sistema.service'
import { ConfigService } from '@nestjs/config'
import { TenantContext } from '../../core/context/tenant-context'
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common'
import { RuoloEffettivoService } from '../../api/me/ruolo-effettivo.service'
import { createPrismaMock, MockPrisma } from '../../../test/utils/prisma-mock'
import {
  createConfigServiceMock,
  MockConfigService,
} from '../../../test/utils/config-service-mock.factory'
import {
  createMockUser,
  createMockSpidUser,
  createMockTokens,
  VALID_FISCAL_CODES,
} from '../../../test/utils/test-fixtures.factory'

describe('AuthController', () => {
  let controller: AuthController
  let jwtTokensService: jest.Mocked<JwtTokensService>
  let redisService: jest.Mocked<RedisService>
  let prismaService: MockPrisma
  let configService: MockConfigService
  let ruoloEffettivo: { accesso: jest.Mock }

  beforeEach(async () => {
    const mockJwtTokensService = {
      generateTokenPair: jest.fn(),
      generateAccessToken: jest.fn(),
      generateRefreshToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
      extractTokenFromHeader: jest.fn(),
    }

    const mockRedisService = {
      storeRefreshToken: jest.fn(),
      isRefreshTokenValid: jest.fn(),
      revokeRefreshToken: jest.fn(),
      revokeAccessToken: jest.fn(),
      revokeAllRefreshTokens: jest.fn(),
      impostaEpocaSessione: jest.fn(),
    }

    prismaService = createPrismaMock()
    ruoloEffettivo = { accesso: jest.fn() }
    configService = createConfigServiceMock()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: JwtTokensService, useValue: mockJwtTokensService },
        { provide: RedisService, useValue: mockRedisService },
        { provide: PrismaSistemaService, useValue: prismaService },
        { provide: ConfigService, useValue: configService },
        { provide: RuoloEffettivoService, useValue: ruoloEffettivo },
      ],
    }).compile()

    controller = module.get<AuthController>(AuthController)
    jwtTokensService = module.get(JwtTokensService)
    redisService = module.get(RedisService)
  })

  describe('spidLogin', () => {
    it('should initiate SPID login (handled by passport)', () => {
      // This endpoint is protected by AuthGuard('spid')
      // Passport will redirect to SPID IdP
      expect(controller.spidLogin).toBeDefined()
    })
  })

  describe('spidCallback', () => {
    // Il controller spidCallback ora reindirizza il browser alla SPA Angular
    // passando i token nel fragment (#) per non esporli in log/referer server.
    // I test verificano che res.redirect venga chiamato con l'URL corretto.

    it('dovrebbe reindirizzare alla SPA con i token nel fragment', async () => {
      const mockSpidUser = createMockSpidUser({
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        firstName: 'Mario',
        lastName: 'Rossi',
        isNewUser: false,
      })

      const mockDbUser = createMockUser({
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        tenantId: 'tenant-123',
        role: 'ADMIN',
        tenant: { id: 'tenant-123', name: 'Test Company' } as any,
      })

      const mockTokens = createMockTokens()

      prismaService.user.findUnique.mockResolvedValue(mockDbUser as any)
      jwtTokensService.generateTokenPair.mockReturnValue(mockTokens)
      redisService.storeRefreshToken.mockResolvedValue(undefined)

      const mockRes = { redirect: jest.fn() }

      await controller.spidCallback({ user: mockSpidUser }, mockRes as any)

      // Verifica che il redirect punti all'URL frontend con il fragment corretto
      expect(mockRes.redirect).toHaveBeenCalledTimes(1)
      const redirectUrl: string = mockRes.redirect.mock.calls[0][1]
      expect(redirectUrl).toContain('/auth/callback#')
      expect(redirectUrl).toContain('accessToken=')
      expect(redirectUrl).toContain('refreshToken=')
      expect(redirectUrl).toContain('expiresIn=')

      expect(jwtTokensService.generateTokenPair).toHaveBeenCalledWith({
        id: mockSpidUser.id,
        email: mockSpidUser.email,
        fiscalCode: mockSpidUser.fiscalCode,
        tenantId: 'tenant-123',
        role: 'ADMIN',
      })

      expect(redisService.storeRefreshToken).toHaveBeenCalledWith(
        mockSpidUser.id,
        mockTokens.refreshToken,
        7 * 24 * 60 * 60 // 7 giorni in secondi
      )
    })

    it('dovrebbe reindirizzare anche per un nuovo utente (isNewUser=true)', async () => {
      const mockNewUser = createMockSpidUser({
        id: 'user-new',
        email: 'newuser@example.com',
        fiscalCode: VALID_FISCAL_CODES.LUIGI_VERDI,
        firstName: 'Luigi',
        lastName: 'Verdi',
        isNewUser: true,
      })

      const mockDbUser = createMockUser({
        id: 'user-new',
        email: 'newuser@example.com',
        fiscalCode: VALID_FISCAL_CODES.LUIGI_VERDI,
        tenantId: null,
        role: 'VIEWER',
      })

      const mockTokens = createMockTokens()

      prismaService.user.findUnique.mockResolvedValue(mockDbUser as any)
      jwtTokensService.generateTokenPair.mockReturnValue(mockTokens)
      redisService.storeRefreshToken.mockResolvedValue(undefined)

      const mockRes = { redirect: jest.fn() }

      await controller.spidCallback({ user: mockNewUser }, mockRes as any)

      expect(mockRes.redirect).toHaveBeenCalledTimes(1)
      const redirectUrl: string = mockRes.redirect.mock.calls[0][1]
      expect(redirectUrl).toContain('/auth/callback#')
    })

    it('dovrebbe memorizzare il refresh token in Redis', async () => {
      const mockSpidUser = createMockSpidUser()

      const mockDbUser = createMockUser({
        tenantId: 'tenant-123',
        role: 'VIEWER',
      })

      const mockTokens = createMockTokens()

      prismaService.user.findUnique.mockResolvedValue(mockDbUser as any)
      jwtTokensService.generateTokenPair.mockReturnValue(mockTokens)
      redisService.storeRefreshToken.mockResolvedValue(undefined)

      const mockRes = { redirect: jest.fn() }
      await controller.spidCallback({ user: mockSpidUser }, mockRes as any)

      expect(redisService.storeRefreshToken).toHaveBeenCalledWith(
        'user-123',
        mockTokens.refreshToken,
        604800 // 7 giorni in secondi
      )
    })

    describe("ritorno verso l'app campo (RelayState in elenco chiuso)", () => {
      const FRONTEND = 'https://rifiuti.ignicraft.com'
      const TRENTA_GIORNI = 30 * 24 * 60 * 60

      const preparaUtente = (role: string) => {
        prismaService.user.findUnique.mockResolvedValue(
          createMockUser({ id: 'user-123', tenantId: 'tenant-123', role }) as any
        )
        jwtTokensService.generateTokenPair.mockReturnValue(createMockTokens())
        jwtTokensService.generateRefreshToken.mockReturnValue('refresh-30-giorni')
      }
      const chiama = async (relayState: unknown) => {
        const res = { redirect: jest.fn() }
        const req: any = { user: createMockSpidUser({ id: 'user-123' }) }
        if (relayState !== undefined) req.body = { RelayState: relayState }
        await controller.spidCallback(req, res as any)
        return res.redirect.mock.calls[0][1] as string
      }

      it('AUTISTA con RelayState=campo: torna a /campo/accesso con refresh a 30 giorni', async () => {
        preparaUtente('AUTISTA')
        const url = await chiama('campo')
        expect(url.startsWith(`${FRONTEND}/campo/accesso#`)).toBe(true)
        const frammento = new URLSearchParams(url.split('#')[1])
        expect(frammento.get('refreshToken')).toBe('refresh-30-giorni')
        expect(frammento.get('accessToken')).toBe('mock-access-token-jwt-string')
        expect(jwtTokensService.generateRefreshToken).toHaveBeenCalledWith(
          'user-123',
          'tenant-123',
          '30d',
          'campo'
        )
        expect(redisService.storeRefreshToken).toHaveBeenCalledWith(
          'user-123',
          'refresh-30-giorni',
          TRENTA_GIORNI
        )
      })

      it("la sessione unica resta: anche dal canale campo si revoca e si alza l'epoca", async () => {
        preparaUtente('AUTISTA')
        await chiama('campo')
        expect(redisService.revokeAllRefreshTokens).toHaveBeenCalledWith('user-123')
        expect(redisService.impostaEpocaSessione).toHaveBeenCalledWith('user-123')
      })

      it("utente d'ufficio dal canale campo: ritorna a campo ma il refresh resta di 7 giorni", async () => {
        preparaUtente('ADMIN')
        const url = await chiama('campo')
        expect(url.startsWith(`${FRONTEND}/campo/accesso#`)).toBe(true)
        expect(jwtTokensService.generateRefreshToken).not.toHaveBeenCalled()
        expect(redisService.storeRefreshToken).toHaveBeenCalledWith(
          'user-123',
          'mock-refresh-token-jwt-string',
          7 * 24 * 60 * 60
        )
      })

      it("AUTISTA senza RelayState (login dal frontend d'ufficio): 7 giorni e percorso predefinito", async () => {
        preparaUtente('AUTISTA')
        const url = await chiama(undefined)
        expect(url.startsWith(`${FRONTEND}/auth/callback#`)).toBe(true)
        expect(jwtTokensService.generateRefreshToken).not.toHaveBeenCalled()
        expect(redisService.storeRefreshToken).toHaveBeenCalledWith(
          'user-123',
          'mock-refresh-token-jwt-string',
          7 * 24 * 60 * 60
        )
      })

      it.each([
        'https://evil.example/',
        '//evil.example',
        '/campo/accesso',
        'ufficio',
        '',
        ['campo'],
        { campo: 1 },
      ])(
        'RelayState non ammesso %p: percorso predefinito, mai un redirect fuori elenco',
        async valore => {
          preparaUtente('AUTISTA')
          const url = await chiama(valore)
          expect(url.startsWith(`${FRONTEND}/auth/callback#`)).toBe(true)
          expect(url).not.toContain('evil')
          expect(jwtTokensService.generateRefreshToken).not.toHaveBeenCalled()
          expect(redisService.storeRefreshToken).toHaveBeenCalledWith(
            'user-123',
            'mock-refresh-token-jwt-string',
            7 * 24 * 60 * 60
          )
        }
      )
    })
  })

  describe('refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const mockRefreshToken = 'valid-refresh-token'
      const mockPayload = {
        sub: 'user-123',
        type: 'refresh' as const,
      }

      const mockDbUser = createMockUser({
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        tenantId: 'tenant-123',
        role: 'ADMIN',
      })

      const mockNewAccessToken = 'new-access-token'

      jwtTokensService.verifyRefreshToken.mockReturnValue(mockPayload)
      redisService.isRefreshTokenValid.mockResolvedValue(true)
      prismaService.user.findUnique.mockResolvedValue(mockDbUser as any)
      jwtTokensService.generateAccessToken.mockReturnValue(mockNewAccessToken)

      const result = await controller.refresh({ refreshToken: mockRefreshToken })

      expect(result).toEqual({
        accessToken: 'new-access-token',
        expiresIn: 900,
      })

      expect(jwtTokensService.verifyRefreshToken).toHaveBeenCalledWith(mockRefreshToken)
      expect(redisService.isRefreshTokenValid).toHaveBeenCalledWith('user-123', mockRefreshToken)
    })

    it('should throw UnauthorizedException if refresh token is invalid', async () => {
      const mockRefreshToken = 'invalid-refresh-token'

      jwtTokensService.verifyRefreshToken.mockReturnValue(null)

      await expect(controller.refresh({ refreshToken: mockRefreshToken })).rejects.toThrow(
        UnauthorizedException
      )
      await expect(controller.refresh({ refreshToken: mockRefreshToken })).rejects.toThrow(
        'Invalid refresh token'
      )
    })

    it('should throw UnauthorizedException if refresh token is revoked', async () => {
      const mockRefreshToken = 'revoked-refresh-token'
      const mockPayload = {
        sub: 'user-123',
        type: 'refresh' as const,
      }

      jwtTokensService.verifyRefreshToken.mockReturnValue(mockPayload)
      redisService.isRefreshTokenValid.mockResolvedValue(false)

      await expect(controller.refresh({ refreshToken: mockRefreshToken })).rejects.toThrow(
        UnauthorizedException
      )
      await expect(controller.refresh({ refreshToken: mockRefreshToken })).rejects.toThrow(
        'Refresh token has been revoked'
      )
    })

    it('should generate new access token for valid refresh', async () => {
      const mockRefreshToken = 'valid-refresh-token'
      const mockPayload = {
        sub: 'user-123',
        type: 'refresh' as const,
      }

      const mockDbUser = createMockUser({
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        tenantId: 'tenant-123',
        role: 'OPERATOR',
      })

      jwtTokensService.verifyRefreshToken.mockReturnValue(mockPayload)
      redisService.isRefreshTokenValid.mockResolvedValue(true)
      prismaService.user.findUnique.mockResolvedValue(mockDbUser as any)
      jwtTokensService.generateAccessToken.mockReturnValue('new-access-token')

      await controller.refresh({ refreshToken: mockRefreshToken })

      expect(jwtTokensService.generateAccessToken).toHaveBeenCalledWith({
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        tenantId: 'tenant-123',
        role: 'OPERATOR',
      })
      // token del tenant primario (senza azienda nel refresh token): nessuna verifica
      expect(ruoloEffettivo.accesso).not.toHaveBeenCalled()
    })

    it('refresh: utente dal client di sistema', async () => {
      // @Public: nessun contesto azienda. Il lookup deve passare dal client di sistema.
      let tenantVisto: string | null = 'non-chiamato'
      redisService.isRefreshTokenValid.mockResolvedValue(true)
      jwtTokensService.verifyRefreshToken.mockReturnValue({
        sub: 'user-123',
        type: 'refresh',
      } as any)
      jwtTokensService.generateAccessToken.mockReturnValue('nuovo')
      prismaService.user.findUnique.mockImplementation((() => {
        tenantVisto = TenantContext.getStoreTenantId()
        return Promise.resolve(
          createMockUser({ id: 'user-123', tenantId: 'tenant-123', role: 'ADMIN' })
        )
      }) as any)

      await TenantContext.run({}, async () => controller.refresh({ refreshToken: 'rt' }))

      expect(tenantVisto).toBeNull()
      expect(Reflect.getMetadata('design:paramtypes', AuthController)[2]).toBe(PrismaSistemaService)
    })

    describe('refresh del canale campo (refresh lungo ricontrollato sul ruolo)', () => {
      const payloadCampo = {
        sub: 'user-123',
        tenantId: 'tenant-123',
        type: 'refresh',
        canale: 'campo',
      } as any

      it('utente ancora AUTISTA: rinnova (e il refresh token non viene toccato)', async () => {
        jwtTokensService.verifyRefreshToken.mockReturnValue(payloadCampo)
        redisService.isRefreshTokenValid.mockResolvedValue(true)
        prismaService.user.findUnique.mockResolvedValue(
          createMockUser({ id: 'user-123', tenantId: 'tenant-123', role: 'AUTISTA' }) as any
        )
        jwtTokensService.generateAccessToken.mockReturnValue('nuovo')

        const r = await controller.refresh({ refreshToken: 'rt-30' })

        expect(r.accessToken).toBe('nuovo')
        expect(redisService.revokeRefreshToken).not.toHaveBeenCalled()
        expect(redisService.storeRefreshToken).not.toHaveBeenCalled()
      })

      it.each(['ADMIN', 'OPERATOR', 'VIEWER'])(
        'utente diventato %s: revoca il refresh token e risponde 401',
        async ruolo => {
          jwtTokensService.verifyRefreshToken.mockReturnValue(payloadCampo)
          redisService.isRefreshTokenValid.mockResolvedValue(true)
          prismaService.user.findUnique.mockResolvedValue(
            createMockUser({ id: 'user-123', tenantId: 'tenant-123', role: ruolo }) as any
          )

          await expect(controller.refresh({ refreshToken: 'rt-30' })).rejects.toThrow(
            UnauthorizedException
          )
          expect(redisService.revokeRefreshToken).toHaveBeenCalledWith('user-123', 'rt-30')
          expect(jwtTokensService.generateAccessToken).not.toHaveBeenCalled()
        }
      )

      it("refresh senza claim canale (login d'ufficio): nessun vincolo sul ruolo", async () => {
        jwtTokensService.verifyRefreshToken.mockReturnValue({
          sub: 'user-123',
          type: 'refresh',
        } as any)
        redisService.isRefreshTokenValid.mockResolvedValue(true)
        prismaService.user.findUnique.mockResolvedValue(
          createMockUser({ id: 'user-123', tenantId: 'tenant-123', role: 'ADMIN' }) as any
        )
        jwtTokensService.generateAccessToken.mockReturnValue('nuovo')

        await expect(controller.refresh({ refreshToken: 'rt' })).resolves.toBeDefined()
        expect(redisService.revokeRefreshToken).not.toHaveBeenCalled()
      })
    })

    describe('azienda selezionata con lo switch (portata dal refresh token)', () => {
      const STUDIO = 'tenant-studio'
      const CLIENTE = 'tenant-cliente'
      const consulente = createMockUser({
        id: 'user-123',
        email: 'c@studio.it',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        tenantId: STUDIO,
        role: 'ADMIN',
      })

      beforeEach(() => {
        redisService.isRefreshTokenValid.mockResolvedValue(true)
        prismaService.user.findUnique.mockResolvedValue(consulente as any)
        jwtTokensService.generateAccessToken.mockReturnValue('new-access-token')
      })

      it("il refresh dopo lo switch conserva l'azienda del cliente", async () => {
        jwtTokensService.verifyRefreshToken.mockReturnValue({
          sub: 'user-123',
          tenantId: CLIENTE,
          type: 'refresh',
        })
        ruoloEffettivo.accesso.mockResolvedValue('VIEWER')

        await controller.refresh({ refreshToken: 'rt' })

        expect(ruoloEffettivo.accesso).toHaveBeenCalledWith(
          { id: 'user-123', role: 'ADMIN', tenantId: STUDIO },
          CLIENTE
        )
        expect(jwtTokensService.generateAccessToken).toHaveBeenCalledWith(
          expect.objectContaining({ id: 'user-123', tenantId: CLIENTE, role: 'ADMIN' })
        )
      })

      it('associazione scaduta: 403 AZIENDA_SELEZIONATA_NON_ACCESSIBILE, mai il tenant primario', async () => {
        jwtTokensService.verifyRefreshToken.mockReturnValue({
          sub: 'user-123',
          tenantId: CLIENTE,
          type: 'refresh',
        })
        ruoloEffettivo.accesso.mockResolvedValue(null)

        const errore: any = await controller.refresh({ refreshToken: 'rt' }).catch(e => e)

        expect(errore).toBeInstanceOf(ForbiddenException)
        expect(errore.getResponse()).toEqual({
          message: "L'azienda selezionata non è più accessibile: selezionane un'altra.",
          error: 'AZIENDA_SELEZIONATA_NON_ACCESSIBILE',
        })
        expect(jwtTokensService.generateAccessToken).not.toHaveBeenCalled()
      })

      it('errore del database nella verifica: 503 VERIFICA_AZIENDA_NON_DISPONIBILE, non 500', async () => {
        jwtTokensService.verifyRefreshToken.mockReturnValue({
          sub: 'user-123',
          tenantId: CLIENTE,
          type: 'refresh',
        })
        ruoloEffettivo.accesso.mockRejectedValue(new Error('connessione al database persa'))

        const errore: any = await controller.refresh({ refreshToken: 'rt' }).catch(e => e)

        expect(errore).toBeInstanceOf(ServiceUnavailableException)
        expect(errore.getResponse()).toEqual({
          message: "Verifica dell'azienda selezionata non disponibile, riprova.",
          error: 'VERIFICA_AZIENDA_NON_DISPONIBILE',
        })
        expect(jwtTokensService.generateAccessToken).not.toHaveBeenCalled()
      })

      it("refresh token con l'azienda primaria: invariato, nessuna verifica", async () => {
        jwtTokensService.verifyRefreshToken.mockReturnValue({
          sub: 'user-123',
          tenantId: STUDIO,
          type: 'refresh',
        })

        await controller.refresh({ refreshToken: 'rt' })

        expect(ruoloEffettivo.accesso).not.toHaveBeenCalled()
        expect(jwtTokensService.generateAccessToken).toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: STUDIO })
        )
      })

      it("SUPER_ADMIN: conserva l'azienda scelta senza verifica (come lo switch)", async () => {
        prismaService.user.findUnique.mockResolvedValue({
          ...consulente,
          role: 'SUPER_ADMIN',
        } as any)
        jwtTokensService.verifyRefreshToken.mockReturnValue({
          sub: 'user-123',
          tenantId: CLIENTE,
          type: 'refresh',
        })

        await controller.refresh({ refreshToken: 'rt' })

        expect(ruoloEffettivo.accesso).not.toHaveBeenCalled()
        expect(jwtTokensService.generateAccessToken).toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: CLIENTE, role: 'SUPER_ADMIN' })
        )
      })
    })
  })

  describe('logout', () => {
    it('should revoke refresh token and access token', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
        headers: {
          authorization: 'Bearer access-token-123',
        },
      }

      jwtTokensService.extractTokenFromHeader.mockReturnValue('access-token-123')
      redisService.revokeRefreshToken.mockResolvedValue()
      redisService.revokeAccessToken.mockResolvedValue()

      const result = await controller.logout(mockRequest, {
        refreshToken: 'refresh-token-456',
      })

      expect(result).toEqual({ message: 'Logged out successfully' })

      expect(jwtTokensService.extractTokenFromHeader).toHaveBeenCalledWith(
        'Bearer access-token-123'
      )
      expect(redisService.revokeRefreshToken).toHaveBeenCalledWith('user-123', 'refresh-token-456')
      expect(redisService.revokeAccessToken).toHaveBeenCalledWith('access-token-123', 900)
    })

    it('should handle logout without access token in header', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
        headers: {},
      }

      jwtTokensService.extractTokenFromHeader.mockReturnValue(null)
      redisService.revokeRefreshToken.mockResolvedValue()

      const result = await controller.logout(mockRequest, {
        refreshToken: 'refresh-token-456',
      })

      expect(result).toEqual({ message: 'Logged out successfully' })
      expect(redisService.revokeRefreshToken).toHaveBeenCalledWith('user-123', 'refresh-token-456')
      expect(redisService.revokeAccessToken).not.toHaveBeenCalled()
    })

    it('should revoke both tokens when both are provided', async () => {
      const mockRequest = {
        user: { id: 'user-123' },
        headers: {
          authorization: 'Bearer access-token-123',
        },
      }

      jwtTokensService.extractTokenFromHeader.mockReturnValue('access-token-123')
      redisService.revokeRefreshToken.mockResolvedValue()
      redisService.revokeAccessToken.mockResolvedValue()

      await controller.logout(mockRequest, {
        refreshToken: 'refresh-token-456',
      })

      expect(redisService.revokeRefreshToken).toHaveBeenCalled()
      expect(redisService.revokeAccessToken).toHaveBeenCalled()
    })
  })

  describe('getProfile', () => {
    it('should return current user profile', () => {
      const mockUser = {
        id: 'user-123',
        email: 'test@example.com',
        fiscalCode: VALID_FISCAL_CODES.MARIO_ROSSI,
        role: 'ADMIN',
        tenantId: 'tenant-123',
        permissions: [],
      }

      const mockRequest = {
        user: mockUser,
      }

      const result = controller.getProfile(mockRequest)

      expect(result).toEqual(mockUser)
    })
  })
})
