/**
 * Archivio generale degli addebiti (4.2a, D6/D26). L'azienda e' quella SELEZIONATA
 * (`requireRequestTenantId`); `@Roles` esplicito su ogni rotta: letture a tutti i ruoli,
 * scritture a SUPER_ADMIN, ADMIN e OPERATOR. Le variazioni di prezzo (Task 10) stanno su rotte
 * proprie dichiarate PRIMA di `:id`.
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
import { AddebitiService } from '../../application/listino/addebiti.service'
import { VariazioniArchivioService } from '../../application/listino/variazioni-archivio.service'
import { CreaAddebitoDto, ElencoAddebitiQueryDto, ModificaAddebitoDto } from './dto/addebito.dto'
import {
  ApplicaVariazioneArchivioDto,
  CorpoVariazioneArchivioDto,
} from './dto/variazione-prezzi.dto'
import { RUOLI_LETTURA, RUOLI_SCRITTURA, RUOLI_VARIAZIONI } from './ruoli'

@ApiTags('listino')
@ApiBearerAuth()
@Controller('addebiti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AddebitiController {
  constructor(
    private readonly addebiti: AddebitiService,
    private readonly variazioni: VariazioniArchivioService
  ) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Archivio degli addebiti (paginato): { elementi, totale }' })
  list(@Req() req: any, @Query() query: ElencoAddebitiQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return this.addebiti.list(tenantId, {
      testo: query.testo,
      tipo: query.tipo,
      soloAttivi: query.soloAttivi === 'true',
      pagina: query.pagina ?? 1,
      dimensione: query.dimensione ?? 25,
    })
  }

  // Dichiarata PRIMA di `:id`, altrimenti "prossimo-codice" sarebbe letto come un id.
  @Get('prossimo-codice')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Primo codice a cinque cifre libero (informativo: non riserva nulla)' })
  @ApiResponse({ status: 400, description: 'Codici esauriti' })
  async prossimoCodice(@Req() req: any) {
    const tenantId = requireRequestTenantId(req)
    return { codice: await this.addebiti.prossimoCodice(tenantId) }
  }

  // Le variazioni stanno PRIMA di `:id`: "variazioni-prezzi" non deve essere letto come un id.
  @Post('variazioni-prezzi/anteprima')
  @Roles(...RUOLI_VARIAZIONI)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anteprima della variazione dei prezzi: righe, errori e impronta' })
  @ApiResponse({ status: 400, description: 'Criteri non validi o troppe righe' })
  anteprimaVariazione(@Req() req: any, @Body() dto: CorpoVariazioneArchivioDto) {
    const tenantId = requireRequestTenantId(req)
    return this.variazioni.anteprima(tenantId, dto)
  }

  @Post('variazioni-prezzi')
  @Roles(...RUOLI_VARIAZIONI)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Applica la variazione con l'impronta dell'anteprima: { aggiornati }" })
  @ApiResponse({ status: 400, description: "Errori nell'anteprima: nulla è scritto" })
  @ApiResponse({ status: 409, description: "L'archivio è cambiato dopo l'anteprima" })
  applicaVariazione(@Req() req: any, @Body() dto: ApplicaVariazioneArchivioDto) {
    const tenantId = requireRequestTenantId(req)
    return this.variazioni.applica(tenantId, req.user.id, dto)
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un addebito, con i sei listini' })
  @ApiResponse({ status: 404, description: 'Addebito non trovato' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.addebiti.getById(tenantId, id)
  }

  @Post()
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un addebito (codice assente = primo libero)' })
  @ApiResponse({ status: 400, description: 'Dati non validi (elenco dei messaggi)' })
  @ApiResponse({ status: 409, description: 'Codice già usato' })
  crea(@Req() req: any, @Body() dto: CreaAddebitoDto) {
    const tenantId = requireRequestTenantId(req)
    return this.addebiti.crea(tenantId, req.user.id, dto)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica, disattiva o riattiva un addebito (anche i sei listini)' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo o codice già usato' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaAddebitoDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.addebiti.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina un addebito non in uso' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'In uso o modificato nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.addebiti.elimina(tenantId, req.user.id, id, versione)
  }
}
