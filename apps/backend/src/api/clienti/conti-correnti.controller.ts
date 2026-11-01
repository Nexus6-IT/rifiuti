/**
 * Conti correnti del gestore (4.1a, D17/D21). L'elenco ha l'IBAN mascherato, il dettaglio intero. L'azienda e' quella SELEZIONATA
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
import { ContiCorrentiService } from '../../application/clienti/conti-correnti.service'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'
import { CreaContoCorrenteDto, ModificaContoCorrenteDto } from './dto/conto-corrente.dto'

@ApiTags('clienti')
@ApiBearerAuth()
@Controller('conti-correnti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContiCorrentiController {
  constructor(private readonly conti: ContiCorrentiService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Conti correnti dell’azienda (IBAN mascherato)' })
  @ApiQuery({ name: 'incluseDisattivate', required: false, type: Boolean })
  list(@Req() req: any, @Query('incluseDisattivate') incluse?: string) {
    const tenantId = requireRequestTenantId(req)
    return this.conti.list(tenantId, incluse === 'true')
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un conto corrente (IBAN intero)' })
  @ApiResponse({ status: 404, description: 'Conto non trovato' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.conti.getById(tenantId, id)
  }

  @Post()
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un conto corrente' })
  @ApiResponse({ status: 400, description: 'Dati non validi (elenco dei messaggi)' })
  @ApiResponse({ status: 409, description: 'Codice o IBAN già usato' })
  crea(@Req() req: any, @Body() dto: CreaContoCorrenteDto) {
    const tenantId = requireRequestTenantId(req)
    return this.conti.crea(tenantId, req.user.id, dto)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica, disattiva o riattiva un conto corrente' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo, codice o IBAN già usato' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaContoCorrenteDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.conti.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina un conto corrente non in uso' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'In uso o modificato nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.conti.elimina(tenantId, req.user.id, id, versione)
  }
}
