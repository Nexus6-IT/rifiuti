/**
 * Elenchi degli addebiti visti dal contratto (4.2b, D8, R39): `@Controller('contratti-clienti')`
 * con le rotte `:id/elenchi`. Le rotte che partono da un elenco stanno in
 * `elenchi-addebiti.controller.ts`. Azienda SELEZIONATA (`requireRequestTenantId`); `@Roles`
 * esplicito su ogni rotta: letture a tutti i ruoli, scritture senza VIEWER (D26).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { CreaElencoAddebitiDto } from './dto/elenco-addebiti.dto'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'

@ApiTags('listino')
@ApiBearerAuth()
@Controller('contratti-clienti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ElenchiContrattoController {
  constructor(private readonly elenchi: ElenchiAddebitiService) {}

  @Get(':id/elenchi')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Elenchi degli addebiti di un contratto, con il contesto' })
  @ApiQuery({ name: 'validiAl', required: false, description: 'YYYY-MM-DD: solo non scaduti' })
  @ApiResponse({ status: 404, description: 'Contratto non trovato' })
  list(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('validiAl') validiAl?: string
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.elenchi.list(tenantId, id, validiAl)
  }

  // Dichiarata PRIMA di qualunque rotta con un secondo segmento variabile.
  @Get(':id/elenchi/prossimo-codice')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Primo codice a tre cifre libero (informativo: non riserva nulla)' })
  @ApiResponse({ status: 400, description: 'Codici esauriti' })
  async prossimoCodice(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return { codice: await this.elenchi.prossimoCodice(tenantId, id) }
  }

  @Post(':id/elenchi')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un elenco degli addebiti (codice omesso = il primo libero)' })
  @ApiResponse({ status: 400, description: 'Dati non validi (elenco dei messaggi)' })
  @ApiResponse({ status: 409, description: 'Codice già usato o contratto annullato' })
  crea(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreaElencoAddebitiDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.elenchi.crea(tenantId, req.user.id, id, dto)
  }
}
