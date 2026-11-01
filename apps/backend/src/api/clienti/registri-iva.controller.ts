/**
 * Registri IVA sezionali (4.1a, D24/D17). L'azienda e' quella SELEZIONATA
 * (`requireRequestTenantId`); `@Roles` esplicito su ogni rotta: letture a tutti i ruoli,
 * scritture a SUPER_ADMIN, ADMIN e OPERATOR.
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
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { RegistriIvaService } from '../../application/clienti/registri-iva.service'
import { CreaRegistroIvaDto, ModificaRegistroIvaDto } from './dto/registro-iva.dto'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'

@ApiTags('clienti')
@ApiBearerAuth()
@Controller('registri-iva')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RegistriIvaController {
  constructor(private readonly registri: RegistriIvaService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Registri IVA dell’azienda' })
  @ApiQuery({ name: 'incluseDisattivate', required: false, type: Boolean })
  list(@Req() req: any, @Query('incluseDisattivate') incluse?: string) {
    const tenantId = requireRequestTenantId(req)
    return this.registri.list(tenantId, incluse === 'true')
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un registro IVA' })
  @ApiResponse({ status: 404, description: 'Registro non trovato' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.registri.getById(tenantId, id)
  }

  @Post()
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un registro IVA' })
  @ApiResponse({ status: 400, description: 'Dati non validi (elenco dei messaggi)' })
  @ApiResponse({ status: 409, description: 'Codice già usato' })
  crea(@Req() req: any, @Body() dto: CreaRegistroIvaDto) {
    const tenantId = requireRequestTenantId(req)
    return this.registri.crea(tenantId, req.user.id, dto)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica, disattiva o riattiva un registro IVA' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo o codice già usato' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaRegistroIvaDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.registri.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina un registro IVA non in uso' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'In uso o modificato nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.registri.elimina(tenantId, req.user.id, id, versione)
  }
}
