/**
 * FIR Controller - REST API
 * Gestione Formulari Identificazione Rifiuti
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UseGuards,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { CreateFIRDto } from './dtos/create-fir.dto'
import { ListFIRsDto } from './dtos/list-firs.dto'
import { FIRResponseDto } from './dtos/fir-response.dto'
import { PaginatedFIRResponseDto } from './dtos/paginated-fir-response.dto'
import { CreateFIRUseCase } from '../../application/fir/use-cases/create-fir.use-case'
import { ListFIRsQueryHandler } from '../../application/fir/queries/list-firs.handler'
import { CreateFIRCommand } from '../../application/fir/commands/create-fir.command'
import { ListFIRsQuery } from '../../application/fir/queries/list-firs.query'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { CurrentUser, CurrentUserPayload } from '../../auth/decorators/current-user.decorator'

@ApiTags('fir')
@Controller('fir')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FIRController {
  constructor(
    private readonly createFIRUseCase: CreateFIRUseCase,
    private readonly listFIRsHandler: ListFIRsQueryHandler
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crea nuovo FIR in stato BOZZA',
    description: 'Crea un nuovo Formulario Identificazione Rifiuti in stato bozza',
  })
  @ApiResponse({
    status: 201,
    description: 'FIR creato con successo',
    type: FIRResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Dati non validi (CER code non trovato, quantità negativa, etc.)',
  })
  @ApiResponse({ status: 401, description: 'Non autenticato' })
  async create(
    @Body() dto: CreateFIRDto,
    @CurrentUser() user: CurrentUserPayload
  ): Promise<FIRResponseDto> {
    const command = new CreateFIRCommand(
      dto.produttoreId,
      dto.rifiuto,
      dto.trasportatoreId,
      dto.destinatarioId,
      user.id
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
}
