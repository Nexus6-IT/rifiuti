/**
 * Auth Module - SPID Authentication + JWT
 * Following ADR-004: Custom Auth for MVP
 */

import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { SpidStrategy } from './strategies/spid.strategy'
import { JwtStrategy } from './strategies/jwt.strategy'
import { JwtTokensService } from './services/jwt-tokens.service'
import { RedisService } from './services/redis.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { RolesGuard } from './guards/roles.guard'
import { AuthController } from './controllers/auth.controller'
import { DevAuthController } from './controllers/dev-auth.controller'
import { PrismaModule } from '../infrastructure/persistence/prisma.module'
import { RuoloEffettivoModule } from '../api/me/ruolo-effettivo.module'

// Difesa in profondità (2026-07-25): POST /auth/dev/login non deve nemmeno
// esistere come rotta in produzione. Il controller mantiene comunque il
// proprio check runtime su NODE_ENV, ma qui evitiamo che dipenda solo da
// quello — se NODE_ENV === 'production' il controller non viene registrato.
const devOnlyControllers = process.env.NODE_ENV === 'production' ? [] : [DevAuthController]

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION', '15m'),
          issuer: configService.get<string>('JWT_ISSUER', 'wasteflow.it'),
          audience: configService.get<string>('JWT_AUDIENCE', 'wasteflow-api'),
        },
      }),
      inject: [ConfigService],
    }),
    PrismaModule,
    // Ricontrollo dell'azienda del token al refresh (solo Prisma, nessun ciclo con MeModule).
    RuoloEffettivoModule,
  ],
  controllers: [AuthController, ...devOnlyControllers],
  providers: [
    // Strategies
    SpidStrategy,
    JwtStrategy,

    // Services
    JwtTokensService,
    RedisService,

    // Guards
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [JwtModule, PassportModule, JwtAuthGuard, RolesGuard, JwtTokensService, RedisService],
})
export class AuthModule {}
