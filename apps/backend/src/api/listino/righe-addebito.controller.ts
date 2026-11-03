/**
 * Righe di addebito per id (4.2b, D9, R39, R42): `@Controller('righe-addebito')`. L'elenco e il
 * contratto della riga si leggono con `eliminato_il IS NULL`: un contratto eliminato risponde 404.
 * Azienda SELEZIONATA; `@Roles` esplicito su ogni rotta (D26): letture a tutti i ruoli, scritture
 * senza VIEWER. `codifiche-rentri` e' dichiarata PRIMA di `:id`.
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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import {
  RigheAddebitoService,
  TABELLE_CODIFICHE_RENTRI,
  type TabellaCodificheRentri,
} from '../../application/listino/righe-addebito.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ModificaRigaAddebitoDto } from './dto/riga-addebito.dto'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'

@ApiTags('listino')
@ApiBearerAuth()
@Controller('righe-addebito')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RigheAddebitoController {
  constructor(private readonly righe: RigheAddebitoService) {}

  @Get('codifiche-rentri')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Stati fisici o operazioni RENTRI da scegliere nella riga (R42)' })
  @ApiQuery({ name: 'tabella', required: true, enum: TABELLE_CODIFICHE_RENTRI })
  @ApiResponse({ status: 400, description: 'Tabella non ammessa' })
  codificheRentri(@Req() req: any, @Query('tabella') tabella?: string) {
    requireRequestTenantId(req)
    if (!(TABELLE_CODIFICHE_RENTRI as readonly string[]).includes(tabella ?? '')) {
      throw new BadRequestException({
        error: 'CODIFICHE_RENTRI_TABELLA_NON_VALIDA',
        message: ['La tabella è stati-fisici oppure attivita-rs.'],
      })
    }
    return this.righe.codificheRentri(tabella as TabellaCodificheRentri)
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di una riga di addebito' })
  @ApiResponse({ status: 404, description: 'Riga non trovata' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.righe.getById(tenantId, id)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({
    summary:
      'Modifica una riga (campo assente = invariato, null = svuota; fasce e scadenze assenti = invariate)',
  })
  @ApiResponse({ status: 400, description: 'RIGA_ADDEBITO_NON_VALIDA con `errori` per campo' })
  @ApiResponse({
    status: 409,
    description: 'Modificata nel frattempo, regole fra righe, annullato',
  })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaRigaAddebitoDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.righe.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Elimina la riga con le sue fasce e scadenze; 200 { avvisi } (vuoto se nessuna riga la citava come condizione)',
  })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'Modificata nel frattempo o contratto annullato' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<{ avvisi: string[] }> {
    const tenantId = requireRequestTenantId(req)
    return this.righe.elimina(tenantId, req.user.id, id, versione)
  }
}
