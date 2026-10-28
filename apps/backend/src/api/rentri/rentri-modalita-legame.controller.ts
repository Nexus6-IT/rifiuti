/**
 * RENTRI Modalità Legame Controller — REST API
 *
 * Endpoint admin per leggere/scegliere la modalità con cui il tenant lega i
 * FIR ai formulari RENTRI (AUTOMATICA | IBRIDA | MANUALE). È una scelta che
 * impegna l'azienda verso un ente pubblico (trasmissioni automatiche verso
 * RENTRI), non una preferenza d'uso: riservata a SUPER_ADMIN e ADMIN.
 */

import { Controller, Get, Patch, Body, HttpCode, HttpStatus, UseGuards, Req } from '@nestjs/common'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import {
  RentriModalitaLegameService,
  RentriModalitaLegameStatus,
} from '../../infrastructure/rentri/rentri-modalita-legame.service'
import { SetRentriModalitaLegameDto } from './dto/set-rentri-modalita-legame.dto'

@ApiTags('rentri')
@ApiBearerAuth()
// Global prefix is `api/v1` (vedi main.ts), quindi il path completo è
// `api/v1/rentri/modalita-legame`.
@Controller('rentri/modalita-legame')
// Scelta che impegna il tenant verso RENTRI: riservata agli amministratori.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
export class RentriModalitaLegameController {
  constructor(private readonly modalitaLegameService: RentriModalitaLegameService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Modalità di legame RENTRI del tenant corrente',
    description: 'Ritorna la modalità attuale e se il tenant ha un certificato RENTRI configurato.',
  })
  @ApiResponse({ status: 200, description: 'Modalità corrente' })
  @ApiResponse({ status: 401, description: 'Non autenticato' })
  @ApiResponse({ status: 403, description: 'Ruolo non autorizzato (richiede ADMIN o SUPER_ADMIN)' })
  async get(@Req() req: any): Promise<RentriModalitaLegameStatus> {
    const tenantId = requireRequestTenantId(req)
    return this.modalitaLegameService.getForTenant(tenantId)
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Imposta la modalità di legame RENTRI del tenant corrente',
    description:
      'AUTOMATICA e IBRIDA richiedono un certificato RENTRI valido già configurato. Il cambio vale solo per il futuro: non modifica i formulari già trasmessi/agganciati.',
  })
  @ApiResponse({ status: 200, description: 'Modalità aggiornata' })
  @ApiResponse({
    status: 400,
    description: 'Modalità non selezionabile: manca un certificato RENTRI configurato',
  })
  @ApiResponse({ status: 401, description: 'Non autenticato' })
  @ApiResponse({ status: 403, description: 'Ruolo non autorizzato (richiede ADMIN o SUPER_ADMIN)' })
  async set(
    @Body() dto: SetRentriModalitaLegameDto,
    @Req() req: any
  ): Promise<RentriModalitaLegameStatus> {
    const tenantId = requireRequestTenantId(req)
    return this.modalitaLegameService.setForTenant(tenantId, dto.modalitaLegame)
  }
}
