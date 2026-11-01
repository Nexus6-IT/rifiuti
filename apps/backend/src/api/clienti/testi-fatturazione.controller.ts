/**
 * Testi di fatturazione (4.1a, D25/D17). L'azienda e' quella SELEZIONATA
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
import { TestiFatturazioneService } from '../../application/clienti/testi-fatturazione.service'
import {
  CreaTestoFatturazioneDto,
  ModificaTestoFatturazioneDto,
} from './dto/testo-fatturazione.dto'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './condizioni-pagamento.controller'

@ApiTags('clienti')
@ApiBearerAuth()
@Controller('testi-fatturazione')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TestiFatturazioneController {
  constructor(private readonly testi: TestiFatturazioneService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Testi di fatturazione dell’azienda' })
  @ApiQuery({ name: 'incluseDisattivate', required: false, type: Boolean })
  list(@Req() req: any, @Query('incluseDisattivate') incluse?: string) {
    const tenantId = requireRequestTenantId(req)
    return this.testi.list(tenantId, incluse === 'true')
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un testo di fatturazione' })
  @ApiResponse({ status: 404, description: 'Testo non trovato' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.testi.getById(tenantId, id)
  }

  @Post()
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un testo di fatturazione' })
  @ApiResponse({ status: 400, description: 'Dati non validi (elenco dei messaggi)' })
  @ApiResponse({ status: 409, description: 'Codice già usato' })
  crea(@Req() req: any, @Body() dto: CreaTestoFatturazioneDto) {
    const tenantId = requireRequestTenantId(req)
    return this.testi.crea(tenantId, req.user.id, dto)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica, disattiva o riattiva un testo di fatturazione' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo o codice già usato' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaTestoFatturazioneDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.testi.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina un testo di fatturazione non in uso' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'In uso o modificato nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.testi.elimina(tenantId, req.user.id, id, versione)
  }
}
