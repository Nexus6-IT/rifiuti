/**
 * Elenchi degli addebiti per id (4.2b, D8, R39): `@Controller('elenchi-addebiti')`. Il contratto
 * dell'elenco e' letto con `eliminato_il IS NULL`: un contratto eliminato risponde 404 anche qui.
 * Azienda SELEZIONATA; `@Roles` esplicito su ogni rotta (D26).
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ElenchiAddebitiService } from '../../application/listino/elenchi-addebiti.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ModificaElencoAddebitiDto } from './dto/elenco-addebiti.dto'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'

@ApiTags('listino')
@ApiBearerAuth()
@Controller('elenchi-addebiti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ElenchiAddebitiController {
  constructor(private readonly elenchi: ElenchiAddebitiService) {}

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un elenco degli addebiti' })
  @ApiResponse({ status: 404, description: 'Elenco non trovato' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.elenchi.getById(tenantId, id)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica un elenco (campo assente = invariato, null = svuota)' })
  @ApiResponse({
    status: 409,
    description: 'Modificato nel frattempo, codice già usato, annullato',
  })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaElencoAddebitiDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.elenchi.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina l’elenco con righe, fasce, scadenze e allegati' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo o contratto annullato' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.elenchi.elimina(tenantId, req.user.id, id, versione)
  }
}
