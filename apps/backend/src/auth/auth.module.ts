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
import { PrismaModule } from '../infrastructure/persistence/prisma.module'

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
  ],
  controllers: [AuthController],
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
