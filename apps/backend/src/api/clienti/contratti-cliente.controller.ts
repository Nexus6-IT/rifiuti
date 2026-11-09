/**
 * Contratti cliente (4.1b, Task 18, D8, D11, D17, R37, R43). L'azienda e' quella SELEZIONATA
 * (`requireRequestTenantId`); `@Roles` esplicito su ogni rotta: letture a tutti i ruoli, scritture
 * a SUPER_ADMIN, ADMIN e OPERATOR. Elenco paginato lato server: `{ elementi, totale }`.
 *
 * Ordine dei metodi: `prossimo-numero` e `proroga-scadenze` stanno PRIMA di `:id`, cosi' non
 * vengono scambiate per un id. Le rotte degli allegati sono nel loro controller (R28).
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
  ContrattiClienteService,
  type DatiCreazioneContratto,
  type FiltroContratti,
  type FiltroProroga,
} from '../../application/contratti-cliente/contratti-cliente.service'
import type {
  ModificaContrattoCliente,
  StatoContrattoCliente,
} from '../../domain/contratti-cliente/regole-contratto-cliente'
import { RUOLI_LETTURA, RUOLI_SCRITTURA } from './ruoli'
import {
  CambiaStatoContrattoClienteDto,
  CreaContrattoClienteDto,
  ElencoContrattiClienteQueryDto,
  ModificaContrattoClienteDto,
  ProrogaScadenzeDto,
  RinnovaContrattoClienteDto,
} from './dto/contratto-cliente.dto'
import { RichiedeModulo } from '../../core/decorators/richiede-modulo.decorator'

@ApiTags('clienti')
@ApiBearerAuth()
@Controller('contratti-clienti')
@RichiedeModulo('contratti')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContrattiClienteController {
  constructor(private readonly contratti: ContrattiClienteService) {}

  @Get()
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Contratti cliente dell’azienda (paginato, filtrabile)' })
  list(@Req() req: any, @Query() query: ElencoContrattiClienteQueryDto) {
    const tenantId = requireRequestTenantId(req)
    const filtro: FiltroContratti = {
      ...(query.stato !== undefined ? { stato: query.stato as StatoContrattoCliente } : {}),
      ...(query.clienteId !== undefined ? { clienteId: query.clienteId } : {}),
      ...(query.categoriaId !== undefined ? { categoriaId: query.categoriaId } : {}),
      ...(query.tipoId !== undefined ? { tipoId: query.tipoId } : {}),
      ...(query.testo !== undefined ? { testo: query.testo } : {}),
      ...(query.inScadenzaEntroGiorni !== undefined
        ? { inScadenzaEntroGiorni: query.inScadenzaEntroGiorni }
        : {}),
      pagina: query.pagina ?? 1,
      dimensione: query.dimensione ?? 25,
    }
    return this.contratti.list(tenantId, filtro)
  }

  @Get('prossimo-numero')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Numero proposto `CC-<anno>-<NNN>` (informativo, non riserva nulla)' })
  async prossimoNumero(@Req() req: any): Promise<{ numero: string }> {
    const tenantId = requireRequestTenantId(req)
    return { numero: await this.contratti.prossimoNumero(tenantId) }
  }

  @Post('proroga-scadenze')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Proroga di un anno le scadenze dei contratti attivi (e sospesi se richiesto)',
  })
  @ApiResponse({ status: 400, description: 'Data o filtri non validi' })
  prorogaScadenze(@Req() req: any, @Body() dto: ProrogaScadenzeDto) {
    const tenantId = requireRequestTenantId(req)
    const filtro: FiltroProroga = {
      scadutiEntro: dto.scadutiEntro,
      // Default di D11: solo rinnovo automatico, sospesi esclusi.
      soloRinnovoAutomatico: dto.soloRinnovoAutomatico ?? true,
      ancheSospesi: dto.ancheSospesi ?? false,
      ...(dto.clienteId ? { clienteId: dto.clienteId } : {}),
      ...(dto.categoriaId ? { categoriaId: dto.categoriaId } : {}),
    }
    return this.contratti.prorogaScadenze(tenantId, req.user.id, filtro)
  }

  @Get(':id')
  @Roles(...RUOLI_LETTURA)
  @ApiOperation({ summary: 'Dettaglio di un contratto cliente' })
  @ApiResponse({ status: 404, description: 'Contratto non trovato' })
  getById(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    const tenantId = requireRequestTenantId(req)
    return this.contratti.getById(tenantId, id)
  }

  @Post()
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crea un contratto cliente (nasce in bozza)' })
  @ApiResponse({ status: 400, description: 'Dati non validi' })
  @ApiResponse({ status: 409, description: 'Numero già usato' })
  crea(@Req() req: any, @Body() dto: CreaContrattoClienteDto) {
    const tenantId = requireRequestTenantId(req)
    return this.contratti.crea(tenantId, req.user.id, dto as unknown as DatiCreazioneContratto)
  }

  @Patch(':id')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Modifica parziale: campo assente = invariato, null = svuota' })
  @ApiResponse({ status: 409, description: 'Modificato nel frattempo o campi non ammessi' })
  modifica(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaContrattoClienteDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.contratti.modifica(
      tenantId,
      req.user.id,
      id,
      dto as unknown as ModificaContrattoCliente & { versione: number }
    )
  }

  @Patch(':id/stato')
  @Roles(...RUOLI_SCRITTURA)
  @ApiOperation({ summary: 'Cambia lo stato (l’annullo richiede un motivo)' })
  @ApiResponse({ status: 409, description: 'Transizione non ammessa o modificato nel frattempo' })
  cambiaStato(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiaStatoContrattoClienteDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.contratti.cambiaStato(
      tenantId,
      req.user.id,
      id,
      dto.stato as StatoContrattoCliente,
      dto.versione,
      {
        ...(dto.motivoAnnulloId !== undefined ? { motivoAnnulloId: dto.motivoAnnulloId } : {}),
        ...(dto.motivo !== undefined ? { motivo: dto.motivo } : {}),
      }
    )
  }

  @Post(':id/rinnova')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rinnova il contratto: data di fine + 1 anno' })
  @ApiResponse({ status: 409, description: 'Non rinnovabile o modificato nel frattempo' })
  rinnova(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RinnovaContrattoClienteDto
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.contratti.rinnova(tenantId, req.user.id, id, dto.versione)
  }

  @Delete(':id')
  @Roles(...RUOLI_SCRITTURA)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina (logicamente) un contratto in bozza' })
  @ApiQuery({ name: 'versione', required: true, type: Number })
  @ApiResponse({ status: 409, description: 'Non eliminabile o modificato nel frattempo' })
  async elimina(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.contratti.elimina(tenantId, req.user.id, id, versione)
  }
}
