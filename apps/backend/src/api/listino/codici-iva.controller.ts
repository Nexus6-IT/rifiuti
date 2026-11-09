/**
 * Codici IVA delle vendite (4.2a, D3). L'azienda e' quella SELEZIONATA (`requireRequestTenantId`);
 * `@Roles` esplicito su ogni rotta: letture a tutti i ruoli, scritture a SUPER_ADMIN, ADMIN e
 * OPERATOR (R11).
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
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import { CodiciIvaService } from '../../application/listino/codici-iva.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { CreaCodiceIvaDto, ModificaCodiceIvaDto } from './dto/codice-iva.dto'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

@ApiTags('listino')
@ApiBearerAuth()
@Controller('codici-iva')
@RichiedeModulo('contratti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CodiciIvaController {
  constructor(private readonly codici: CodiciIvaService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Codici IVA dell’azienda' })
  @ApiQuery({ name: 'incluseDisattivate', required: false, type: Boolean })
  list(@Req() req: any, @Query('incluseDisattivate') incluse?: string) {
    const tenantId = requireRequestTenantId(req)
    return this.codici.list(tenantId, incluse === 'true')
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un codice IVA' })
  @ApiResponse({ status: 404, description: 'Codice IVA non trovato' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.codici.getById(tenantId, id)
  }

  @Post()
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un codice IVA' })
  @ApiResponse({ status: 400, description: 'Dati non validi (elenco dei messaggi)' })
  @ApiResponse({ status: 409, description: 'Codice già usato' })
  crea(@Req() req: any, @Body() dto: CreaCodiceIvaDto) {
    const tenantId = requireRequestTenantId(req)
    return this.codici.crea(tenantId, req.user.id, dto)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica, disattiva o riattiva un codice IVA' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo o codice già usato' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaCodiceIvaDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.codici.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina un codice IVA non in uso' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'In uso o modificato nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.codici.elimina(tenantId, req.user.id, id, versione)
  }
}
