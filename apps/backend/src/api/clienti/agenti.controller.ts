/**
 * Agenti (4.1b, D17/D22). L'azienda e' quella SELEZIONATA (`requireRequestTenantId`); `@Roles`
 * esplicito su ogni rotta: letture a tutti i ruoli, scritture a SUPER_ADMIN, ADMIN e OPERATOR.
 * Elenco paginato lato server: `{ elementi, totale }`.
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
import { AgentiService } from '../../application/clienti/agenti.service'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'
import { CreaAgenteDto, ElencoAgentiQueryDto, ModificaAgenteDto } from './dto/agente.dto'

@ApiTags('clienti')
@ApiBearerAuth()
@Controller('agenti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgentiController {
  constructor(private readonly agenti: AgentiService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Agenti dell’azienda (paginato)' })
  list(@Req() req: any, @Query() query: ElencoAgentiQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return this.agenti.list(tenantId, {
      ...(query.testo !== undefined ? { testo: query.testo } : {}),
      ...(query.soloAttivi !== undefined ? { soloAttivi: query.soloAttivi === 'true' } : {}),
      pagina: query.pagina ?? 1,
      dimensione: query.dimensione ?? 25,
    })
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un agente' })
  @ApiResponse({ status: 404, description: 'Agente non trovato' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.agenti.getById(tenantId, id)
  }

  @Post()
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un agente come ruolo su una ditta (nuova o già censita)' })
  @ApiResponse({ status: 400, description: 'Dati non validi o agente già presente per la ditta' })
  @ApiResponse({ status: 409, description: 'Codice già usato' })
  crea(@Req() req: any, @Body() dto: CreaAgenteDto) {
    const tenantId = requireRequestTenantId(req)
    const { indirizzo, ...resto } = dto
    // Come registry.controller: il DTO dice `comune`, il dominio `citta`.
    return this.agenti.crea(tenantId, req.user.id, {
      ...resto,
      indirizzo: {
        via: indirizzo.via,
        civico: indirizzo.civico,
        cap: indirizzo.cap,
        citta: indirizzo.comune,
        provincia: indirizzo.provincia,
        nazione: indirizzo.nazione,
      },
    })
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica, disattiva o riattiva un agente' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo o codice già usato' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaAgenteDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.agenti.modifica(tenantId, req.user.id, id, dto)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina un agente non citato da clienti o contratti' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'In uso o modificato nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.agenti.elimina(tenantId, req.user.id, id, versione)
  }
}
