/**
 * Legame di un movimento (4.3b, Task 22, spec §8.1): `GET /registro/movimenti/:id/legame`. Il
 * movimento puo' essere uno qualunque della catena. 404 `LEGAME_MOVIMENTO_NON_TROVATO` se la
 * catena non ha un legame (o il movimento e` di un'altra azienda).
 */
import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { LegamiService } from '../../application/legami-movimento/conferma-legame.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RUOLI_LETTURA } from './ruoli'

@ApiTags('legami-movimento')
@ApiBearerAuth()
@Controller('registro/movimenti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MovimentoLegameController {
  constructor(private readonly legami: LegamiService) {}

  @Get(':id/legame')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Legame della catena del movimento (404 se non c’è)' })
  @ApiResponse({ status: 404, description: 'LEGAME_MOVIMENTO_NON_TROVATO' })
  legame(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.legami.perMovimento(requireRequestTenantId(req), id)
  }
}
