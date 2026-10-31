import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { requireRequestTenantId } from '../../core/context/resolve-request-tenant'
import { ContractService, ContractStatus } from './contract.service'
import { CreateContractDto, ChangeContractStatusDto } from './dto/create-contract.dto'
import { ModificaContrattoDto } from './dto/modifica-contratto.dto'

/** Data da stringa ISO: `null` (svuota) e `undefined` (non cambia) restano tali. */
const comeData = (v: string | null | undefined): Date | null | undefined =>
  v === null || v === undefined ? v : new Date(v)

/**
 * Contract Controller — gestione contratti e auto-compilazione FIR.
 */
@ApiTags('contracts')
@Controller('contracts')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Crea un contratto (stato iniziale DRAFT)' })
  @ApiResponse({ status: 201, description: 'Contratto creato' })
  async create(@Body() dto: CreateContractDto, @Req() req: any) {
    return this.contractService.create(requireRequestTenantId(req), {
      ...dto,
      startDate: new Date(dto.startDate),
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
    })
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lista contratti del tenant (filtro per stato)' })
  async list(@Req() req: any, @Query('status') status?: ContractStatus) {
    return this.contractService.list(requireRequestTenantId(req), status)
  }

  @Get('auto-fill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Suggerimento auto-compilazione FIR da contratto attivo',
    description: 'Dato produttore + CER, ritorna la controparte e il pricing dal contratto attivo.',
  })
  async autoFill(
    @Req() req: any,
    @Query('producerId') producerId: string,
    @Query('cerCode') cerCode: string
  ) {
    return this.contractService.getAutoFillForFir(requireRequestTenantId(req), producerId, cerCode)
  }

  // ATTENZIONE: deve restare PRIMA di `@Get(':id')`, altrimenti la rotta
  // parametrica cattura "next-number" trattandolo come un id.
  @Get('next-number')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Prossimo numero contratto suggerito',
    description: 'Formato CTR-<anno>-<progressivo>. Suggerimento, non prenotazione.',
  })
  async nextNumber(@Req() req: any) {
    return {
      contractNumber: await this.contractService.nextContractNumber(requireRequestTenantId(req)),
    }
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dettaglio contratto' })
  async getById(@Param('id') id: string, @Req() req: any) {
    return this.contractService.getById(requireRequestTenantId(req), id)
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @ApiOperation({
    summary: 'Modifica un contratto: solo i campi inviati; `null` svuota un campo facoltativo',
    description:
      'Richiede la `versione` letta (lock ottimistico). In un contratto attivo o sospeso si modificano solo i termini; in uno in approvazione, scaduto o cessato nessun campo.',
  })
  @ApiResponse({ status: 200, description: 'Contratto aggiornato (o invariato se nulla cambia)' })
  @ApiResponse({ status: 400, description: 'CONTRATTO_NON_VALIDO: dati non validi' })
  @ApiResponse({ status: 403, description: 'Ruolo non autorizzato o azienda non determinabile' })
  @ApiResponse({ status: 404, description: 'Contratto non trovato' })
  @ApiResponse({
    status: 409,
    description:
      'CONTRATTO_NON_MODIFICABILE, CONTRATTO_MODIFICATO_NEL_FRATTEMPO o CONTRATTO_NUMERO_DUPLICATO',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModificaContrattoDto,
    @Req() req: any
  ) {
    const tenantId = requireRequestTenantId(req)
    return this.contractService.update(tenantId, req.user?.id, id, {
      ...dto,
      startDate: comeData(dto.startDate),
      endDate: comeData(dto.endDate),
    })
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @ApiOperation({
    summary: 'Elimina un contratto in bozza o in approvazione (cancellazione logica)',
    description: 'La `versione` letta arriva in query: `?versione=<n>`.',
  })
  @ApiResponse({ status: 204, description: 'Contratto eliminato' })
  @ApiResponse({ status: 400, description: 'Id o versione non validi' })
  @ApiResponse({ status: 403, description: 'Ruolo non autorizzato o azienda non determinabile' })
  @ApiResponse({ status: 404, description: 'Contratto non trovato' })
  @ApiResponse({
    status: 409,
    description: 'CONTRATTO_NON_ELIMINABILE o CONTRATTO_MODIFICATO_NEL_FRATTEMPO',
  })
  async elimina(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('versione', ParseIntPipe) versione: number,
    @Req() req: any
  ): Promise<void> {
    const tenantId = requireRequestTenantId(req)
    await this.contractService.elimina(tenantId, req.user?.id, id, versione)
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Cambia stato del contratto (workflow di approvazione)' })
  @ApiResponse({ status: 400, description: 'Transizione di stato non ammessa' })
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeContractStatusDto,
    @Req() req: any
  ) {
    return this.contractService.changeStatus(
      requireRequestTenantId(req),
      id,
      dto.status as ContractStatus
    )
  }
}
