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
import { IsString, IsNotEmpty, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
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
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'

// Firma "applicativa" (firmatario + certificato): NON è la firma qualificata a
// norma (blocco separato). Le proprietà richiedono decoratori class-validator,
// altrimenti il ValidationPipe (whitelist + forbidNonWhitelisted) le rifiuta
// ("property ... should not exist").
export class FirmaDto {
  @IsString()
  @IsNotEmpty()
  firmatario: string

  @IsString()
  @IsNotEmpty()
  certificato: string
}

export class EmettiFIRDto {
  @ValidateNested()
  @Type(() => FirmaDto)
  firmaProduttore: FirmaDto
}

export class PresaInCaricoFIRDto {
  @ValidateNested()
  @Type(() => FirmaDto)
  firmaTrasportatore: FirmaDto
}

export class ConfermaConsegnaFIRDto {
  @IsNumber()
  @Min(0.01)
  pesoEffettivo: number

  @ValidateNested()
  @Type(() => FirmaDto)
  firmaDestinatario: FirmaDto
}

export class AnnullaFIRDto {
  @IsString()
  @IsOptional()
  motivo?: string
}

@ApiTags('fir')
@Controller('fir')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FIRControllerV2 {
  constructor(
    private readonly createFIRUseCase: CreateFIRUseCase,
    private readonly emettiFIRUseCase: EmettiFIRUseCase,
    private readonly presaInCaricoFIRUseCase: PresaInCaricoFIRUseCase,
    private readonly confermaConsegnaFIRUseCase: ConfermaConsegnaFIRUseCase,
    private readonly annullaFIRUseCase: AnnullaFIRUseCase,
    private readonly getFIRByIdHandler: GetFIRByIdQueryHandler,
    private readonly listFIRsHandler: ListFIRsQueryHandler
  ) {}

  @Post()
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
    const command = new CreateFIRCommand(
      dto.produttoreId,
      dto.rifiuto,
      dto.trasportatoreId,
      dto.destinatarioId,
      user.id,
      user.tenantId,
      dto.trasportatoriAggiuntivi ?? []
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
    @Body() dto: EmettiFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    const command = new EmettiFIRCommand(id, dto.firmaProduttore, user.id)

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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Presa in carico FIR',
    description: 'Presa in carico FIR da parte del trasportatore (EMESSO → IN_TRANSITO)',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR da prendere in carico' })
  @ApiResponse({ status: 200, description: 'FIR preso in carico con successo', type: FIRResponseDto })
  @ApiResponse({ status: 400, description: 'Stato non valido o dati mancanti' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async presaInCarico(
    @Param('id') id: string,
    @Body() dto: PresaInCaricoFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    const command = new PresaInCaricoFIRCommand(id, dto.firmaTrasportatore, user.id)

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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Conferma consegna FIR',
    description: 'Conferma consegna FIR da parte del destinatario (IN_TRANSITO → CONSEGNATO)',
  })
  @ApiParam({ name: 'id', description: 'ID del FIR da confermare' })
  @ApiResponse({ status: 200, description: 'Consegna FIR confermata con successo', type: FIRResponseDto })
  @ApiResponse({ status: 400, description: 'Stato non valido, peso fuori tolleranza o dati mancanti' })
  @ApiResponse({ status: 404, description: 'FIR non trovato' })
  async confermaConsegna(
    @Param('id') id: string,
    @Body() dto: ConfermaConsegnaFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    const command = new ConfermaConsegnaFIRCommand(
      id,
      dto.pesoEffettivo,
      dto.firmaDestinatario,
      user.id
    )

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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Annulla FIR',
    description: 'Annulla un FIR non ancora consegnato (qualsiasi stato tranne CONSEGNATO → ANNULLATO)',
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
    const command = new AnnullaFIRCommand(id, dto?.motivo ?? '', user.id)

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
