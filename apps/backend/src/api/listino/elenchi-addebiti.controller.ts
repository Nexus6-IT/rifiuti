/**
 * Elenchi degli addebiti per id (4.2b, D8, R39): `@Controller('elenchi-addebiti')`. Il contratto
 * dell'elenco e' letto con `eliminato_il IS NULL`: un contratto eliminato risponde 404 anche qui.
 * Azienda SELEZIONATA; `@Roles` esplicito su ogni rotta (D26).
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
import { ElenchiAddebitiService } from '../../application/listino/elenchi-addebiti.service'
import { AzioniListinoService } from '../../application/listino/azioni-listino.service'
import { RigheAddebitoService } from '../../application/listino/righe-addebito.service'
import { Roles } from '../../auth/decorators/roles.decorator'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { AggiungiRigheDto, SostituisciDaDto } from './dto/azioni-listino.dto'
import { ModificaElencoAddebitiDto } from './dto/elenco-addebiti.dto'
import { CreaRigaAddebitoDto } from './dto/riga-addebito.dto'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'

@ApiTags('listino')
@ApiBearerAuth()
@Controller('elenchi-addebiti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ElenchiAddebitiController {
  constructor(
    private readonly elenchi: ElenchiAddebitiService,
    private readonly righe: RigheAddebitoService,
    private readonly azioni: AzioniListinoService
  ) {}

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un elenco degli addebiti' })
  @ApiResponse({ status: 404, description: 'Elenco non trovato' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.elenchi.getById(tenantId, id)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica un elenco (campo assente = invariato, null = svuota)' })
  @ApiResponse({
    status: 409,
    description: 'Modificato nel frattempo, codice già usato, annullato',
  })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaElencoAddebitiDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.elenchi.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina l’elenco con righe, fasce, scadenze e allegati' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo o contratto annullato' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.elenchi.elimina(tenantId, req.user.id, id, versione)
  }

  // Le righe dell'elenco (4.2b, Task 21): due segmenti statici dopo `:id`, nessun conflitto con `:id`.
  @Get(':id/righe')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Righe di un elenco, con fasce e scadenze' })
  @ApiResponse({ status: 404, description: 'Elenco non trovato' })
  listRighe(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.righe.list(tenantId, id)
  }

  @Post(':id/righe')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Aggiunge una riga all’elenco' })
  @ApiResponse({ status: 400, description: 'RIGA_ADDEBITO_NON_VALIDA con `errori` per campo' })
  @ApiResponse({
    status: 409,
    description: 'Riga duplicata, regole fra righe, contratto annullato',
  })
  creaRiga(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreaRigaAddebitoDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.righe.crea(tenantId, req.user.id, id, dto)
  }

  // Copia di righe (Task 23, D18, R39): due segmenti statici dopo `:id`.
  @Post(':id/sostituisci-da')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sostituisce le righe con copie di quelle di un altro elenco (D18)' })
  @ApiResponse({
    status: 400,
    description: 'Su sé stesso, riga non valida (D17); `details.errori`',
  })
  @ApiResponse({ status: 404, description: 'Elenco di arrivo o di partenza non trovato' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo o contratto annullato' })
  sostituisciDa(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SostituisciDaDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.azioni.sostituisciDa(tenantId, req.user.id, id, dto)
  }

  @Post(':id/aggiungi-righe')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aggiunge copie delle righe scelte, saltando i duplicati (D18, R45)' })
  @ApiResponse({ status: 400, description: 'Riga non valida (D17); `details.errori`' })
  @ApiResponse({ status: 404, description: 'Elenco o riga non trovati' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo o contratto annullato' })
  aggiungiRighe(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AggiungiRigheDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.azioni.aggiungiRighe(tenantId, req.user.id, id, dto)
  }
}
