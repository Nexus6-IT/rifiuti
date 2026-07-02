import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { IsUUID } from 'class-validator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CurrentUser } from '../../auth/decorators/current-user.decorator'
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { MembershipService } from './membership.service'

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
  constructor(private readonly membership: MembershipService) {}

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
      (req as unknown as { user?: { tenantId?: string } }).user?.tenantId ??
      null
    return this.membership.getActiveCompany(tenantId)
  }

  @Post('switch-tenant')
  switchTenant(@CurrentUser() user: CurrentUserPayload, @Body() dto: SwitchTenantDto) {
    return this.membership.switchTenant(user, dto.tenantId)
  }
}
