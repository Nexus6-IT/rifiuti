/**
 * Spese accessorie: spese di incasso e bollo (4.1a, D17/D23). L'azienda e' quella SELEZIONATA
 * (`requireRequestTenantId`); `@Roles` esplicito su ogni rotta: letture a tutti i ruoli,
 * scritture a SUPER_ADMIN, ADMIN e OPERATOR.
 */
import {
  BadRequestException,
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
import { SpeseAccessorieService } from '../../application/clienti/spese-accessorie.service'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'
import {
  CreaSpesaAccessoriaDto,
  ModificaSpesaAccessoriaDto,
  TIPI_SPESA,
} from './dto/spesa-accessoria.dto'

@ApiTags('clienti')
@ApiBearerAuth()
@Controller('spese-accessorie')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SpeseAccessorieController {
  constructor(private readonly spese: SpeseAccessorieService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Spese accessorie dell’azienda (filtro ?tipo)' })
  @ApiQuery({ name: 'incluseDisattivate', required: false, type: Boolean })
  @ApiQuery({ name: 'tipo', required: false, enum: TIPI_SPESA })
  list(
    @Req() req: any,
    @Query('incluseDisattivate') incluse?: string,
    @Query('tipo') tipo?: string
  ) {
    const tenantId = requireRequestTenantId(req)
    if (tipo !== undefined && !(TIPI_SPESA as readonly string[]).includes(tipo)) {
      throw new BadRequestException({
        message: ['Il tipo di spesa non è ammesso.'],
        error: 'SPESA_ACCESSORIA_NON_VALIDA',
      })
    }
    return this.spese.list(tenantId, {
      tipo: tipo as (typeof TIPI_SPESA)[number] | undefined,
      incluseDisattivate: incluse === 'true',
    })
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di una spesa accessoria' })
  @ApiResponse({ status: 404, description: 'Spesa non trovata' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.spese.getById(tenantId, id)
  }

  @Post()
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea una spesa accessoria' })
  @ApiResponse({ status: 400, description: 'Dati non validi (elenco dei messaggi)' })
  @ApiResponse({ status: 409, description: 'Codice già usato per quel tipo' })
  crea(@Req() req: any, @Body() dto: CreaSpesaAccessoriaDto) {
    const tenantId = requireRequestTenantId(req)
    return this.spese.crea(tenantId, req.user.id, dto)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica, disattiva o riattiva una spesa accessoria' })
  @ApiResponse({ status: 409, description: 'Modificata nel frattempo o codice già usato' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaSpesaAccessoriaDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.spese.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina una spesa accessoria non in uso' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'In uso o modificata nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.spese.elimina(tenantId, req.user.id, id, versione)
  }
}
