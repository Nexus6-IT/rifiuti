import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import { MembershipService } from './membership.service';

class SwitchTenantDto {
  @IsUUID()
  tenantId!: string;
}

/**
 * Multi-azienda dell'utente autenticato.
 * - GET  /api/v1/me/tenants        → aziende accessibili
 * - POST /api/v1/me/switch-tenant  → cambia azienda (nuovo JWT)
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Get('tenants')
  listTenants(@CurrentUser() user: CurrentUserPayload) {
    return this.membership.listTenants(user);
  }

  @Post('switch-tenant')
  switchTenant(@CurrentUser() user: CurrentUserPayload, @Body() dto: SwitchTenantDto) {
    return this.membership.switchTenant(user, dto.tenantId);
  }
}
