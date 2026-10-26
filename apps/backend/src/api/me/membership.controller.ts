import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { IsUUID } from 'class-validator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { MembershipService } from './membership.service'
import { RedisService } from '../../auth/services/redis.service'
import { ConsentiSelezioneNonValida } from '../../core/decorators/consenti-selezione-non-valida.decorator'

/** Durata del refresh token, la stessa del login (`auth.controller.ts`). */
const SETTE_GIORNI_IN_SECONDI = 7 * 24 * 60 * 60

class SwitchTenantDto {
  @IsUUID()
  tenantId!: string
}

/**
 * Multi-azienda dell'utente autenticato.
 * - GET  /api/v1/me/tenants        → aziende accessibili
 * - GET  /api/v1/me/company        → identità anagrafica della società attiva
 * - POST /api/v1/me/switch-tenant  → cambia azienda (nuovo JWT)
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MembershipController {
  constructor(
    private readonly membership: MembershipService,
    private readonly redis: RedisService
  ) {}

  // Rotta di recupero: risponde anche con una selezione d'azienda non più valida.
  @ConsentiSelezioneNonValida()
  @Get('tenants')
  listTenants(@CurrentUser() user: CurrentUserPayload) {
    return this.membership.listTenants(user)
  }

  /**
   * Identità della società attiva (ragione sociale + partita IVA), usata dal
   * registro C/S per l'auto-tipo carico/scarico e l'auto-compilazione dal FIR.
   *
   * Risolve il tenant EFFETTIVO da `req.tenantId` (impostato dal
   * `TenantContextMiddleware` e sovrascritto dal `TenantSwitchInterceptor`),
   * NON da `req.user.tenantId` (che resta sempre il tenant primario del JWT).
   */
  @Get('company')
  getCompany(@Req() req: Request) {
    const tenantId =
      (req as unknown as { tenantId?: string }).tenantId ??
      // azienda primaria: solo ripiego se il middleware non ha impostato req.tenantId
      (req as unknown as { user?: { tenantId?: string } }).user?.tenantId ??
      null
    return this.membership.getActiveCompany(tenantId)
  }

  // Rotta di recupero: risponde anche con una selezione d'azienda non più valida.
  @ConsentiSelezioneNonValida()
  @Post('switch-tenant')
  async switchTenant(@CurrentUser() user: CurrentUserPayload, @Body() dto: SwitchTenantDto) {
    const tokens = await this.membership.switchTenant(user, dto.tenantId)
    // Il refresh token dello switch porta l'azienda scelta e va registrato come quello del
    // login (stessa durata): altrimenti `POST /auth/refresh` lo rifiuta come revocato e, con
    // il refresh token del login, l'utente tornerebbe in silenzio sull'azienda primaria.
    // I refresh token precedenti si revocano: uno vecchio (del login o di uno switch di prima)
    // rinnoverebbe la sessione su un'altra azienda.
    await this.redis.revokeAllRefreshTokens(user.id)
    await this.redis.storeRefreshToken(user.id, tokens.refreshToken, SETTE_GIORNI_IN_SECONDI)
    return tokens
  }
}
