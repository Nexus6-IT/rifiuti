/**
 * Codifiche del contratto (categorie, tipi, motivi di annullo) (4.1a, D26/D17). L'azienda e' quella SELEZIONATA
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
import { CodificheContrattoService } from '../../application/clienti/codifiche-contratto.service'
import {
  CreaCodificaContrattoDto,
  ModificaCodificaContrattoDto,
  ElencoCodificheQueryDto,
  ProssimoCodiceQueryDto,
} from './dto/codifica-contratto.dto'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

@ApiTags('clienti')
@ApiBearerAuth()
@Controller('codifiche-contratto')
@RichiedeModulo('contratti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CodificheContrattoController {
  constructor(private readonly codifiche: CodificheContrattoService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Codifiche di un genere (categorie, tipi o motivi di annullo)' })
  @ApiResponse({ status: 400, description: 'Genere mancante o non ammesso' })
  list(@Req() req: any, @Query() query: ElencoCodificheQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return this.codifiche.list(tenantId, {
      genere: query.genere,
      incluseDisattivate: query.incluseDisattivate === 'true',
    })
  }

  // Dichiarata PRIMA di `:id`, altrimenti "prossimo-codice" sarebbe letto come un id.
  @Get('prossimo-codice')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Primo codice libero del genere (informativo: non riserva nulla)' })
  @ApiResponse({ status: 400, description: 'Genere mancante, non ammesso o codici esauriti' })
  async prossimoCodice(@Req() req: any, @Query() query: ProssimoCodiceQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return { codice: await this.codifiche.prossimoCodice(tenantId, query.genere) }
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di una codifica' })
  @ApiResponse({ status: 404, description: 'Codifica non trovata' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.codifiche.getById(tenantId, id)
  }

  @Post()
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea una codifica' })
  @ApiResponse({ status: 400, description: 'Dati non validi (elenco dei messaggi)' })
  @ApiResponse({ status: 409, description: 'Codice già usato' })
  crea(@Req() req: any, @Body() dto: CreaCodificaContrattoDto) {
    const tenantId = requireRequestTenantId(req)
    return this.codifiche.crea(tenantId, req.user.id, dto)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica, disattiva o riattiva una codifica' })
  @ApiResponse({ status: 409, description: 'Modificata nel frattempo o codice già usato' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaCodificaContrattoDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.codifiche.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina una codifica non in uso' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'In uso o modificata nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.codifiche.elimina(tenantId, req.user.id, id, versione)
  }
}
