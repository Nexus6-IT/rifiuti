/**
 * FIR Controller - REST API (Extended)
 * Gestione completa Formulari Identificazione Rifiuti
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger'
import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator'
import { CreateFIRDto } from './dtos/create-fir.dto'
import { ListFIRsDto } from './dtos/list-firs.dto'
import { FIRResponseDto } from './dtos/fir-response.dto'
import { PaginatedFIRResponseDto } from './dtos/paginated-fir-response.dto'
import { CreateFIRUseCase } from '../../application/fir/use-cases/create-fir.use-case'
import { EmettiFIRUseCase } from '../../application/fir/use-cases/emetti-fir.use-case'
import { PresaInCaricoFIRUseCase } from '../../application/fir/use-cases/presa-in-carico-fir.use-case'
import { ConfermaConsegnaFIRUseCase } from '../../application/fir/use-cases/conferma-consegna-fir.use-case'
import { AnnullaFIRUseCase } from '../../application/fir/use-cases/annulla-fir.use-case'
import { GetFIRByIdQueryHandler } from '../../application/fir/queries/get-fir-by-id.handler'
import { ListFIRsQueryHandler } from '../../application/fir/queries/list-firs.handler'
import { CreateFIRCommand } from '../../application/fir/commands/create-fir.command'
import { EmettiFIRCommand } from '../../application/fir/commands/emetti-fir.command'
import { PresaInCaricoFIRCommand } from '../../application/fir/commands/presa-in-carico-fir.command'
import { ConfermaConsegnaFIRCommand } from '../../application/fir/commands/conferma-consegna-fir.command'
import { AnnullaFIRCommand } from '../../application/fir/commands/annulla-fir.command'
import { GetFIRByIdQuery } from '../../application/fir/queries/get-fir-by-id.query'
import { ListFIRsQuery } from '../../application/fir/queries/list-firs.query'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { RolesGuard } from '../../auth/guards/roles.guard'
import { Roles } from '../../auth/decorators/roles.decorator'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'
import { SubscriptionEnforcementService } from '../../application/billing/subscription-enforcement.service'

// La firma (produttore/trasportatore/destinatario) NON è più fornita dal
// client (Task 4, pipeline P3): il frontend non costruisce firme, chiede al
// backend di firmare e riceve l'esito. Emetti/PresaInCarico non richiedono
// più alcun body; ConfermaConsegna richiede solo il peso effettivo rilevato.
export class EmettiFIRDto {}

export class PresaInCaricoFIRDto {}

export class ConfermaConsegnaFIRDto {
  @IsNumber()
  @Min(0.01)
  pesoEffettivo: number
}

export class AnnullaFIRDto {
  // Un FIR è un documento legale: l'annullamento richiede sempre una motivazione
  // (tracciabilità/audit). Campo obbligatorio non vuoto.
  @IsString()
  @IsNotEmpty()
  motivo: string
}

@ApiTags('fir')
@Controller('fir')
// RolesGuard oltre a JwtAuthGuard: le scritture (create/emetti/presa-in-carico/
// conferma-consegna/annulla) richiedono un ruolo operativo tramite @Roles; le
// letture (list/get) restano accessibili a qualsiasi utente autenticato (il
// RolesGuard lascia passare i metodi privi di @Roles).
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class FIRControllerV2 {
  constructor(
    private readonly createFIRUseCase: CreateFIRUseCase,
    private readonly emettiFIRUseCase: EmettiFIRUseCase,
    private readonly presaInCaricoFIRUseCase: PresaInCaricoFIRUseCase,
    private readonly confermaConsegnaFIRUseCase: ConfermaConsegnaFIRUseCase,
    private readonly annullaFIRUseCase: AnnullaFIRUseCase,
    private readonly getFIRByIdHandler: GetFIRByIdQueryHandler,
    private readonly listFIRsHandler: ListFIRsQueryHandler,
    private readonly enforcement: SubscriptionEnforcementService
  ) {}

  @Post()
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea nuovo FIR in stato BOZZA',
    description: 'Crea un nuovo Formulario Identificazione Rifiuti in stato bozza',
  })
  @ApiResponse({ status: 201, description: 'FIR creato con successo', type: FIRResponseDto })
  @ApiResponse({ status: 400, description: 'Dati non validi' })
  async create(
    @Body() dto: CreateFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    // Enforcement abbonamento: blocca se tenant sospeso/scaduto o FIR limit raggiunto.
    await this.enforcement.assertNotSuspended(user.tenantId)
    await this.enforcement.assertFirLimitNotReached(user.tenantId)

    const command = new CreateFIRCommand(
      dto.produttoreId,
      dto.rifiuto,
      dto.trasportatoreId,
      dto.destinatarioId,
      user.id,
      user.tenantId,
      dto.provenienza,
      dto.tipoTrattaPrincipale,
      dto.trasportatoriAggiuntivi ?? [],
      dto.annotazioni
    )

    const result = await this.createFIRUseCase.execute(command)

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Lista FIR del tenant',
    description: 'Restituisce lista paginata di FIR con filtri opzionali',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista FIR restituita con successo',
    type: PaginatedFIRResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Parametri non validi' })
  async list(
    @Query() dto: ListFIRsDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<PaginatedFIRResponseDto> {
    // Build filters object
    const filters: any = {}
    if (dto.stato) {
      filters.stato = dto.stato
    }
    if (dto.cerCode) {
      filters.cerCode = dto.cerCode
    }
    if (dto.dataFrom) {
      filters.dataFrom = new Date(dto.dataFrom)
    }
    if (dto.dataTo) {
      filters.dataTo = new Date(dto.dataTo)
    }

    // Build pagination object
    const pagination = {
      page: dto.page ? parseInt(dto.page, 10) : 1,
      limit: dto.limit ? parseInt(dto.limit, 10) : 10,
    }

    const query = new ListFIRsQuery(
      user.tenantId,
      user.id,
      Object.keys(filters).length > 0 ? filters : undefined,
      pagination
    )

    const result = await this.listFIRsHandler.execute(query)

    if (result.isFailure) {
      throw new BadRequestException(result.error)
    }

    // Map domain FIRs to response DTOs
    return {
      items: result.value.items.map(fir => FIRResponseDto.fromDomain(fir)),
      total: result.value.total,
      page: result.value.page,
      limit: result.value.limit,
      totalPages: result.value.totalPages,
    }
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recupera FIR per ID',
    description: 'Restituisce i dettagli di un FIR specifico',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR' })
  @ApiResponse({ status: 200, description: 'FIR trovato', type: FIRResponseDto })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  @ApiResponse({ status: 403, description: 'Non autorizzato' })
  async getById(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    const query = new GetFIRByIdQuery(id, user.id, user.tenantId)

    const result = await this.getFIRByIdHandler.execute(query)

    if (result.isFailure) {
      if (result.error.includes('not found')) {
        throw new NotFoundException(result.error)
      }
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }

  @Post(':id/emetti')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Emetti FIR',
    description: 'Emette un FIR in stato BOZZA con numero progressivo e firma digitale',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR da emettere' })
  @ApiResponse({ status: 200, description: 'FIR emesso con successo', type: FIRResponseDto })
  @ApiResponse({ status: 400, description: 'Stato non valido o dati mancanti' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async emetti(
    @Param('id') id: string,
    @Body() _dto: EmettiFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    // La firma del produttore è prodotta dal sottosistema crittografico
    // dentro lo use-case (Task 4): qui si passa solo l'identità di chi esegue
    // l'operazione (tracciabilità), non un valore costruito dal client.
    const command = new EmettiFIRCommand(id, user.id, user.email)

    const result = await this.emettiFIRUseCase.execute(command)

    if (result.isFailure) {
      if (result.error.includes('not found')) {
        throw new NotFoundException(result.error)
      }
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }

  @Post(':id/presa-in-carico')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Presa in carico FIR',
    description: 'Presa in carico FIR da parte del trasportatore (EMESSO → IN_TRANSITO)',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR da prendere in carico' })
  @ApiResponse({
    status: 200,
    description: 'FIR preso in carico con successo',
    type: FIRResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Stato non valido o dati mancanti' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async presaInCarico(
    @Param('id') id: string,
    @Body() _dto: PresaInCaricoFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    // La firma del trasportatore è prodotta dal sottosistema crittografico
    // dentro lo use-case (Task 4).
    const command = new PresaInCaricoFIRCommand(id, user.id, user.email)

    const result = await this.presaInCaricoFIRUseCase.execute(command)

    if (result.isFailure) {
      if (result.error.includes('not found')) {
        throw new NotFoundException(result.error)
      }
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }

  @Post(':id/conferma-consegna')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Conferma consegna FIR',
    description: 'Conferma consegna FIR da parte del destinatario (IN_TRANSITO → CONSEGNATO)',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR da confermare' })
  @ApiResponse({
    status: 200,
    description: 'Consegna FIR confermata con successo',
    type: FIRResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Stato non valido, peso fuori tolleranza o dati mancanti',
  })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async confermaConsegna(
    @Param('id') id: string,
    @Body() dto: ConfermaConsegnaFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    // La firma del destinatario è prodotta dal sottosistema crittografico
    // dentro lo use-case (Task 4).
    const command = new ConfermaConsegnaFIRCommand(id, dto.pesoEffettivo, user.id, user.email)

    const result = await this.confermaConsegnaFIRUseCase.execute(command)

    if (result.isFailure) {
      if (result.error.includes('not found')) {
        throw new NotFoundException(result.error)
      }
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }

  @Post(':id/annulla')
  @Roles('SUPER_ADMIN', 'ADMIN', 'OPERATOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Annulla FIR',
    description:
      'Annulla un FIR non ancora consegnato (qualsiasi stato tranne CONSEGNATO → ANNULLATO)',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR da annullare' })
  @ApiResponse({ status: 200, description: 'FIR annullato con successo', type: FIRResponseDto })
  @ApiResponse({ status: 400, description: 'Stato non valido (FIR già consegnato)' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async annulla(
    @Param('id') id: string,
    @Body() dto: AnnullaFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    const command = new AnnullaFIRCommand(id, dto.motivo, user.id)

    const result = await this.annullaFIRUseCase.execute(command)

    if (result.isFailure) {
      if (result.error.includes('not found')) {
        throw new NotFoundException(result.error)
      }
      throw new BadRequestException(result.error)
    }

    return FIRResponseDto.fromDomain(result.value)
  }
}
