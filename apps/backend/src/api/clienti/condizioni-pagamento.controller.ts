/**
 * Condizioni di pagamento (4.1a, D6/D17). L'azienda e' quella SELEZIONATA
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
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { CondizioniPagamentoService } from '../../application/clienti/condizioni-pagamento.service'
import {
  CreaCondizionePagamentoDto,
  ModificaCondizionePagamentoDto,
} from './dto/condizione-pagamento.dto'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

@ApiTags('clienti')
@ApiBearerAuth()
@Controller('condizioni-pagamento')
@RichiedeModulo('contratti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CondizioniPagamentoController {
  constructor(private readonly condizioni: CondizioniPagamentoService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Condizioni di pagamento dell’azienda' })
  @ApiQuery({ name: 'incluseDisattivate', required: false, type: Boolean })
  list(@Req() req: any, @Query('incluseDisattivate') incluse?: string) {
    const tenantId = requireRequestTenantId(req)
    return this.condizioni.list(tenantId, incluse === 'true')
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di una condizione di pagamento' })
  @ApiResponse({ status: 404, description: 'Condizione non trovata' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.condizioni.getById(tenantId, id)
  }

  @Post()
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea una condizione di pagamento' })
  @ApiResponse({ status: 400, description: 'Dati non validi (elenco dei messaggi)' })
  @ApiResponse({ status: 409, description: 'Codice già usato' })
  crea(@Req() req: any, @Body() dto: CreaCondizionePagamentoDto) {
    const tenantId = requireRequestTenantId(req)
    return this.condizioni.crea(tenantId, req.user.id, dto)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica, disattiva o riattiva una condizione di pagamento' })
  @ApiResponse({ status: 409, description: 'Modificata nel frattempo o codice già usato' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaCondizionePagamentoDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.condizioni.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina una condizione di pagamento non in uso' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'In uso o modificata nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.condizioni.elimina(tenantId, req.user.id, id, versione)
  }
}
