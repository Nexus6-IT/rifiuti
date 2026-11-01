/**
 * Codifiche di addebito (gruppi, categorie, categorie statistiche, centri di ricavo) (4.2a, D4/R11). L'azienda e' quella SELEZIONATA
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
import { CodificheAddebitoService } from '../../application/listino/codifiche-addebito.service'
import {
  CreaCodificaAddebitoDto,
  ModificaCodificaAddebitoDto,
  ElencoCodificheAddebitoQueryDto,
  ProssimoCodiceAddebitoQueryDto,
} from './dto/codifica-addebito.dto'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'

@ApiTags('listino')
@ApiBearerAuth()
@Controller('codifiche-addebito')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CodificheAddebitoController {
  constructor(private readonly codifiche: CodificheAddebitoService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({
    summary: 'Codifiche di un genere (gruppi, categorie, categorie statistiche o centri di ricavo)',
  })
  @ApiResponse({ status: 400, description: 'Genere mancante o non ammesso' })
  list(@Req() req: any, @Query() query: ElencoCodificheAddebitoQueryDto) {
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
  async prossimoCodice(@Req() req: any, @Query() query: ProssimoCodiceAddebitoQueryDto) {
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
  crea(@Req() req: any, @Body() dto: CreaCodificaAddebitoDto) {
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
    @Body() dto: ModificaCodificaAddebitoDto
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
