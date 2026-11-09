/**
 * Clienti (4.1b, D3, D13, D17, R37). L'azienda e' quella SELEZIONATA (`requireRequestTenantId`); `@Roles`
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
import {
  ClientiService,
  type DatiCreazioneCliente,
  type ModificaCliente,
} from '../../application/clienti/clienti.service'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'
import { CreaClienteDto, ElencoClientiQueryDto, ModificaClienteDto } from './dto/cliente.dto'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

@ApiTags('clienti')
@ApiBearerAuth()
@Controller('clienti')
@RichiedeModulo('contratti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClientiController {
  constructor(private readonly clienti: ClientiService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Clienti dell’azienda (paginato)' })
  list(@Req() req: any, @Query() query: ElencoClientiQueryDto) {
    const tenantId = requireRequestTenantId(req)
    return this.clienti.list(tenantId, {
      ...(query.testo !== undefined ? { testo: query.testo } : {}),
      ...(query.soloAttivi !== undefined ? { soloAttivi: query.soloAttivi === 'true' } : {}),
      pagina: query.pagina ?? 1,
      dimensione: query.dimensione ?? 25,
    })
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un cliente' })
  @ApiResponse({ status: 404, description: 'Cliente non trovato' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.clienti.getById(tenantId, id)
  }

  @Post()
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un cliente come ruolo su una ditta (nuova o già censita)' })
  @ApiResponse({ status: 400, description: 'Dati non validi o cliente già presente per la ditta' })
  @ApiResponse({ status: 409, description: 'Codice già usato' })
  crea(@Req() req: any, @Body() dto: CreaClienteDto) {
    const tenantId = requireRequestTenantId(req)
    const { indirizzo, ...resto } = dto
    // Come registry.controller: il DTO dice `comune`, il dominio `citta`.
    return this.clienti.crea(tenantId, req.user.id, {
      ...(resto as Omit<DatiCreazioneCliente, 'indirizzo'>),
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
  @ApiOperation({ summary: 'Modifica, disattiva o riattiva un cliente' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo o codice già usato' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaClienteDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.clienti.modifica(tenantId, req.user.id, id, dto as ModificaCliente)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina un cliente senza contratti (altrimenti si disattiva)' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'In uso o modificato nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.clienti.elimina(tenantId, req.user.id, id, versione)
  }
}
